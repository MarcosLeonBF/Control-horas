# Horas históricas (A): tabla + carga desde la hoja de cierres mensuales

**Fecha:** 2026-07-21
**Estado:** aprobado
**Alcance:** pieza **A** de 4. B (banco/carry), C (reportes) y D (vista) van aparte.

## Objetivo

Cargar en la plataforma el histórico de horas que hoy vive en la hoja
`HorasHistoricas_CONTROLHORAS` (Google Sheets, 17 pestañas = 17 personas), para
que más adelante alimente el banco de horas, los reportes y una vista propia.

## Hallazgos del análisis (fuente: la propia hoja + BD de producción)

**Volumen:** 1.967 filas, 17 pestañas, 153 proyectos distintos, rango
2024-11-30 → 2026-06-30.

**Lo que encaja sin fricción:**
- Los **17 nombres** de las pestañas coinciden exactamente con perfiles
  existentes (`Alberto Sánchez Rivera` y `Antonela Guadalupe Machado` están
  `inactivo`, pero existen).
- Las **11 posiciones** y los **5 departamentos** de la hoja existen en catálogo.
- **Cero** fechas inválidas y **cero** horas ≤ 0.
- La posición de la hoja coincide con la posición actual del perfil en **las 17
  personas**: la elección "usar la actual" no altera ningún número.

**El hallazgo determinante:** las 20 fechas distintas son **todas el último día
de su mes**. La hoja **no son registros diarios: son cierres mensuales**. Por eso
el 30/06/2026 hay personas con 190,5h "en un día". La plataforma modela
`time_logs.entry_date` como día real de trabajo, así que el histórico **no puede
entrar en `time_logs`** sin corromper esa semántica.

**Incompatibilidades con `time_log_lines`** (motivo adicional para tabla aparte):
- `Área` viene **vacía en el 100%** de las filas, pero `area_id` es NOT NULL. La
  posición no determina un área única (`position_areas` es N:M; CRM → {CRM,
  Dirección, Growth}), así que rellenarla sería inventar el dato.
- `Descripción` viene **vacía en el 100%**, pero la columna es NOT NULL con
  CHECK de no-vacío.
- Etapas `Otros` (4 filas) y `Otros (sin G/G)` (2) **no existen** en catálogo;
  `Servicios mensuales` (1.331) difiere en mayúscula de `Servicios Mensuales`.
- La RPC `guardar_registro` **no sirve** para la carga: bloquea fechas de más de
  14 días atrás, valida área/etapa/departamento contra la posición y rechaza
  líneas duplicadas (la hoja las tiene a montones, legítimamente).

## Decisiones cerradas

- **Tabla aparte**, no `time_logs`. Preserva el modelo diario intacto.
- **`month` como `'YYYY-MM'`**, no como fecha: el dato *es* un mes. Guardar un
  día concreto reintroduciría la confusión que motivó la tabla.
- **`etapa` y `area` como TEXTO**, no FK. Dar de alta `Otros` y `Otros (sin
  G/G)` en el catálogo los metería en los desplegables que ven hoy todos los
  usuarios al registrar horas: ensuciar la app viva por 6 filas de 2025 no
  compensa. El match de etapa contra catálogo se hace **case-insensitive**.
- **`area` y `description` nulables**: vienen vacías; se guardan como nulas en
  vez de fabricar un relleno.
- **Posición**: no se persiste; se resuelve desde el perfil al consultar, igual
  que hace el banco con los registros normales. (Coincide en las 17 personas.)
- **Carry forward**: los meses históricos se tratan **igual que el resto**
  (corte 75/25 y excesos). Decisión del usuario, tomada con el riesgo expuesto:
  si un mes histórico tiene consumo pero el Excel no le asigna horas, todo ese
  consumo se vuelve `exceso` y descuenta del `carryNeto`.

## Modelo de datos

Migración `0037_horas_historicas.sql`:

```sql
create table public.horas_historicas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete restrict,
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  project     text not null,
  department  text not null,
  etapa       text not null,
  area        text,
  hours       numeric(6,2) not null check (hours > 0),
  description text,
  source      text not null,
  created_at  timestamptz not null default now()
);
create index horas_historicas_project_month_idx on public.horas_historicas(project, month);
create index horas_historicas_user_idx on public.horas_historicas(user_id);

alter table public.horas_historicas enable row level security;
-- Lectura: manager/admin (mismo criterio que el banco). Escritura: solo service role.
create policy horas_historicas_select on public.horas_historicas for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
);
```

Sin policies de insert/update/delete: la carga va con service role, que salta RLS.

## Script de carga

`scripts/import-horas-historicas.mjs`. Lee `.env.local` con `dotenv` (ya es
dependencia) y usa `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

**Modos:**
- **`--dry-run` (por defecto):** no escribe nada. Descarga, parsea, valida e
  imprime el informe.
- **`--apply`:** `delete from horas_historicas where source = <source>` y luego
  inserta por lotes. Re-ejecutable: corriges la hoja, relanzas, mismo resultado.
  Nunca duplica.

**Origen:** las pestañas se descubren desde el HTML publicado de la hoja
(`gid=\d+`) y se descargan por `export?format=csv&gid=…`. Al descubrirlas en
vez de fijarlas, una pestaña nueva se recoge sola.

**Validaciones que ABORTAN** (no se adivina ningún dato):
- Usuario de la hoja sin perfil en BD.
- Horas ≤ 0 o no numéricas; fecha ilegible.
- Fecha que **no sea el último día de su mes**: protege la premisa del diseño.

**Validaciones que AVISAN** (no paran): etapa o departamento fuera de catálogo.
Hoy deben salir exactamente `Otros` y `Otros (sin G/G)`.

**Informe del dry-run:** filas por persona, horas por mes, valores no
reconocidos y total general, para cuadrarlo contra la hoja antes de escribir.

## Fuera de alcance (piezas siguientes)

- **B — Banco y carry:** unir `horas_historicas` al mapa `consumedMes` de
  `lib/horas/bancos.ts` (agrupa por `(project, position)` y mes, y salta
  `project = 'Departamento'`). `carrySplit` recalcula solo: el carry es derivado,
  no se persiste.
- **C — Reportes:** fusionar las dos fuentes en `/reportes`.
- **D — Vista propia** de histórico (solo lectura).

## Riesgo abierto que debe resolverse en B

Existe un registro real de **Arturo Rodríguez, 30/06/2026, 37h** en `time_logs`,
y la hoja imputa **167,5h** a ese mismo junio-2026. Al unir ambas fuentes,
junio-2026 **contaría de más**. No afecta a la carga (son tablas distintas),
pero hay que decidir la regla de corte antes de tocar el banco.

## Verificación

- `npx tsc --noEmit` (gate del repo; lint está roto repo-wide desde Next 16).
- Ejecutar el script en **dry-run** y cuadrar totales contra la hoja **antes** de
  `--apply`. La carga a producción requiere visto bueno explícito del usuario.
- Testing funcional a cargo del usuario.

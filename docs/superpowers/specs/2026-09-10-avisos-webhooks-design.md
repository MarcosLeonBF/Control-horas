# Diseño — Avisos automáticos para Zapier / n8n

**Fecha:** 2026-09-10
**Estado:** diseño aprobado por el usuario; pendiente de plan
**Origen:** ideas de negocio transmitidas por el jefe (2026-09-10). Reparto acordado:
Roberto (plataforma) programa los disparadores; Julián (automatización) monta los flujos en
Zapier o n8n y reparte por Slack. Objetivo: disparadores desplegados para la sesión del
**lunes 2026-09-14**, donde se conectan y revisan juntos.
**Contrato para Julián:** [docs/avisos/contrato-avisos-v1.md](../../avisos/contrato-avisos-v1.md)
(fuente de verdad de los campos; este spec cubre el interior de la plataforma).

## Problema

Negocio quiere avisos por Slack sobre la actividad diaria: pulso de cada registro enviado,
registros llamativos, bancos de horas por posición y por proyecto, proyecto al tope (para
vender más horas), HUCHA (proyecto nuevo, ampliación, agotada), un resumen quincenal de
capacidad y un recordatorio escalonado por días sin registrar.

La plataforma **no escribe en Slack**: detecta cada situación, arma los datos y los entrega
a los flujos de Julián por webhook. Lo que depende del calendario lo piden sus flujos con
consultas autenticadas.

Hoy existe la Fase 4 (`checkHorasAlertas`, `lib/horas/alertas.ts`) que avisa por proyecto a
un único webhook de Slack. Nunca se activó (no hay `SLACK_WEBHOOK_URL`), calcula con cifras
crudas (sin carry forward, sin provisionales, sin `horas_historicas`), graba el umbral antes
de enviar (20 filas "enviadas" de 8 proyectos que nunca salieron) y su `fetch` no tiene
timeout dentro del guardado (el patrón del incidente de Graph del 2026-08-31). Se sustituye.

## Alcance

### Entra
1. Bandeja de salida con firma, reintentos e historial.
2. Avisos: `registro.enviado`, `registro.llamativo`, `banco.nivel`, `banco.al_tope`,
   `hucha.proyecto_nuevo`, `hucha.ampliacion`, `hucha.nivel`.
3. Consultas: `resumen-capacidad` y `dias-sin-registrar`.
4. Revisión diaria por cron de Vercel.
5. Pantalla **Administración → Avisos** (`/admin/avisos`).
6. `profiles.manager_id` (manager directo) con selector en la edición de usuario.
7. Tabla `festivos` (se carga por SQL hasta que haya calendario decidido).
8. Retirada de la Fase 4.
9. Cambio de nombre visible "Control de Horas" → "Control de Rentabilidad".

### Queda fuera
- Slack, canales, textos de los mensajes y la escalera de recordatorios: son de Julián.
- Pantallas de festivos y de vacaciones. Las vacaciones se registran como una línea en
  Departamento (así el día cuenta como registrado).
- Reintentos más frecuentes que el cron diario (el plan de Vercel se asume Hobby; si es Pro,
  se sube la frecuencia del cron sin tocar el diseño).
- Borrar `horas_alertas`: queda sin uso; se decide aparte.
- Que la lista de `/bancos` no sume las ampliaciones al total del proyecto (hallazgo aparte;
  los avisos usan la cuenta del detalle, que sí las suma).

## Arquitectura

```
Server action (guardar, ampliar, HUCHA…) ─┐
Cron diario GET /api/avisos/cron ─────────┤→ detector → emitirAviso() → avisos_salientes
                                           │                               │ (pendiente)
                     after() / cron ───────┴──────→ despacharPendientes() ─┴→ POST firmado
                                                                              → flujo de Julián
Flujo de Julián ── GET /api/avisos/v1/<consulta> (Bearer AVISOS_API_KEY) → JSON
```

### Módulos (`lib/avisos/`)

| Archivo | Responsabilidad | IO |
|---|---|---|
| `contrato.ts` | Tipos del sobre y de cada `datos`; `TIPOS_AVISO`; un ejemplo por tipo (lo usa "Enviar prueba") | no |
| `reglas.ts` | Llamativo, orden y transición de niveles, días sin registrar, ranking de capacidad, backoff | no (tests node) |
| `firma.ts` | `firmar(cuerpo, secreto, t)` → cabecera `X-Avisos-Firma` | `node:crypto` |
| `entorno.ts` | `esProduccion()`, `appUrl()` | env |
| `personas.ts` | Persona por id, manager directo, manager del Excel por nombre, managers de HUCHA | Supabase |
| `bandeja.ts` | `emitirAviso()`, `despacharPendientes()`, `enviarPrueba()` | Supabase + fetch |
| `detectores.ts` | `alGuardarRegistro()`, `evaluarBancos()`, `evaluarHucha()`, `alAmpliarHucha()`, `alSincronizarHucha()` | Supabase + `getBancosHoras` |
| `consultas.ts` | `resumenCapacidad()`, `diasSinRegistrar()` | Supabase + reglas |

Rutas: `app/api/avisos/cron/route.ts`, `app/api/avisos/v1/resumen-capacidad/route.ts`,
`app/api/avisos/v1/dias-sin-registrar/route.ts`. Pantalla: `app/(horas)/admin/avisos/`
(página, `actions.ts`) + componente en `components/horas/`. `proxy.ts` ya excluye `/api` de
la sesión, así que cada ruta se autentica sola.

### Base de datos — `0045_avisos.sql`

```sql
-- Una sola fila: la URL del webhook de Julián y qué tipos están activos.
create table public.avisos_config (
  id             boolean primary key default true check (id),
  url            text,
  tipos_activos  text[] not null default '{}',
  updated_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now()
);
insert into public.avisos_config (id) values (true);

create table public.avisos_salientes (
  id               uuid primary key default gen_random_uuid(), -- = id del sobre
  tipo             text not null,
  datos            jsonb not null,
  clave            text unique,               -- deduplicación opcional (NULL no choca)
  prueba           boolean not null default false,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','enviando','enviado','fallido','descartado')),
  motivo_descarte  text,                      -- 'sin_destino'
  intentos         integer not null default 0,
  proximo_intento  timestamptz not null default now(),
  reclamado_at     timestamptz,
  ultimo_codigo    integer,
  ultimo_error     text,
  created_at       timestamptz not null default now(),
  enviado_at       timestamptz
);
create index avisos_salientes_cola on public.avisos_salientes (estado, proximo_intento);
create index avisos_salientes_recientes on public.avisos_salientes (created_at desc);

create table public.avisos_estado (
  clave       text primary key,   -- 'banco:<proyecto>:<posicion>' | 'banco:<proyecto>:*' | 'hucha:<project_id>'
  nivel       text not null,
  updated_at  timestamptz not null default now()
);

create table public.festivos (
  fecha   date primary key,
  nombre  text not null
);

alter table public.profiles
  add column manager_id uuid references public.profiles(id) on delete set null;

-- Reserva atómica de la cola: dos despachadores a la vez nunca toman la misma fila.
-- Recupera las que quedaron 'enviando' más de 10 min (función cortada a medias).
create or replace function public.avisos_reclamar(p_limite integer default 25)
returns setof public.avisos_salientes
language sql security definer set search_path = public as $$
  update public.avisos_salientes s
     set estado = 'enviando', intentos = s.intentos + 1, reclamado_at = now()
   where s.id in (
     select id from public.avisos_salientes
      where (estado = 'pendiente' and proximo_intento <= now())
         or (estado = 'enviando' and reclamado_at < now() - interval '10 minutes')
      order by created_at
      limit p_limite
      for update skip locked)
  returning s.*;
$$;
revoke all on function public.avisos_reclamar(integer) from public, anon, authenticated;
```

RLS activado en las cuatro tablas nuevas. `avisos_config`, `avisos_salientes` y
`avisos_estado`: solo lectura para admin (`public.is_admin()`); `avisos_config` también
escritura (update) para admin (la pantalla). El resto de escrituras las hace el servidor con
service role. `festivos`: lectura para `authenticated`, escritura admin.

### Entrega: bandeja, firma y reintentos

- **`emitirAviso(tipo, datos, { clave?, prueba? })`**
  - Fuera de producción y sin `prueba` → no hace nada (devuelve `null`).
  - Sin URL configurada o con el tipo fuera de `tipos_activos` → inserta con
    `estado='descartado'`, `motivo_descarte='sin_destino'`. Queda en el historial y consume la
    `clave`, así que al activar un tipo más tarde **no llega el acumulado**.
  - Con URL y el tipo activo → inserta `pendiente`.
  - Choque de `clave` (ya emitido) → no hace nada.
  - Con `prueba: true` basta con que haya URL, esté el tipo activo o no: se puede probar
    cada tipo antes de activarlo.
- **Siempre fuera del camino del usuario:** las server actions llaman a los detectores dentro
  de `after()` (`next/server`) y a continuación a `despacharPendientes()`. El guardado nunca
  espera a la red.
- **`despacharPendientes(limite = 25)`**: toma filas con `avisos_reclamar`; por cada una:
  - Relee `avisos_config`. Si ya no hay URL, o el tipo dejó de estar activo y la fila no es
    de prueba → `descartado` / `sin_destino`.
  - Cuerpo: `{ id, tipo, version: 1, fecha: created_at (ISO UTC), prueba, datos }`. La
    `fecha` es la del hecho y no cambia entre reintentos.
  - Cabeceras: `Content-Type: application/json`, `X-Avisos-Id`, `X-Avisos-Tipo`,
    `X-Avisos-Firma: t=<unix>,v1=<hex HMAC-SHA256(AVISOS_FIRMA_SECRETO, "<t>.<cuerpo>")>`.
  - `fetch` POST con `AbortSignal.timeout(5000)`.
  - 2xx → `enviado`, `enviado_at`, `ultimo_codigo`.
  - Otro código, timeout o error de red → si `intentos >= 5`, `fallido`; si no, vuelve a
    `pendiente` con `proximo_intento = now() + backoff(intentos)` (5 min, 30 min, 2 h, 12 h).
    Guarda `ultimo_codigo` y `ultimo_error` (recortado a 500 caracteres).
  - Sin `AVISOS_FIRMA_SECRETO` en producción → no envía; deja la fila `pendiente` con
    `ultimo_error='sin_secreto'` y registra `console.error`.
- **Nunca lanza:** detectores y despacho van en `try/catch` con `console.error('[avisos] …')`.
- **Semántica al menos una vez:** con reintentos puede llegar un aviso repetido; Julián
  deduplica por `id`.
- Con el cron diario, un reintento "a los 5 min" sale en el siguiente despacho: el próximo
  aviso que se emita (despacho oportunista) o la revisión diaria.

### Entorno

`esProduccion() = process.env.VERCEL_ENV === 'production'`. Solo hay una base Supabase y la
comparten el servidor local y los E2E, así que **fuera de producción los detectores y el
cron no hacen nada**: ni leen ni escriben `avisos_estado` ni la bandeja. Las consultas sí
funcionan (solo leen). "Enviar prueba" funciona en cualquier entorno y marca `prueba: true`.
Además, detectores y consultas excluyen perfiles con email `@horas.test` (los que siembran
los E2E).

`appUrl()` = `APP_URL` o, si falta, `https://${VERCEL_PROJECT_PRODUCTION_URL}`. Enlaces:
`/bancos/<encodeURIComponent(proyecto)>` y `/presupuestos/<project_id>`.

### Detectores y dónde se enganchan

| Punto de enganche | Qué dispara |
|---|---|
| `guardarRegistro` (`app/(horas)/registrar/actions.ts`) | `alGuardarRegistro` → `registro.enviado` (solo altas), `registro.llamativo`, `evaluarBancos(proyectos de las líneas)` |
| `ampliarHoras`, `anularAmpliacionHoras` | `evaluarBancos([proyecto])` (rearme) |
| `registrarConsumo` (HUCHA) | `evaluarHucha([project_id])` |
| `ampliarPresupuesto` (HUCHA) | `alAmpliarHucha(movimiento)` → `hucha.ampliacion` + `evaluarHucha` |
| `anularMovimiento` (HUCHA) | `evaluarHucha([project_id])` (rearme) |
| `sincronizarHucha` | `alSincronizarHucha(creados)` → `hucha.proyecto_nuevo` + `evaluarHucha()` |
| Cron diario | `evaluarBancos()` + `evaluarHucha()` + `despacharPendientes(100)` |

Anular un registro de horas no dispara nada: solo puede mejorar un banco y el rearme llega
con la revisión diaria.

**`alGuardarRegistro({ anclaId, lineas, idDevuelto })`**
- Dueño: `time_logs.user_id` del id que devuelve el RPC (vale para alta y para edición de
  admin sobre registros ajenos). Alta = `anclaId === null`.
- Fechas = fechas distintas de las líneas. Se consultan todas las líneas no anuladas del
  dueño en esas fechas (puede haber varios `time_logs` por día) → `horas_dia` y horas por
  proyecto del día.
- Alta: un `registro.enviado` **por fecha**, con las horas y proyectos de las líneas de este
  guardado (`horas_registro`) y el total del día (`horas_dia`). Las ediciones no envían pulso.
- Alta y edición: `motivosLlamativo(horasDia, horasPorProyecto)`; un `registro.llamativo`
  por motivo, con `clave = llamativo:<dueño>:<fecha>:<regla>[:<proyecto>]`.
- Después, `evaluarBancos(proyectos de las líneas sin 'Departamento')`.

**`evaluarBancos(proyectos?)`**
- Datos: `getBancosHoras({ role: 'admin' })`, ampliaciones activas (`horas_ampliaciones`),
  estado del proyecto (Excel `Clientes_Proyectos`). Solo proyectos con estado `Activo`.
- Niveles por **posición** (filas de `getBancosHoras`, solo con asignadas > 0) y por
  **proyecto** (total):
  - `asignadas = Σ posiciones + Σ ampliaciones activas`; `consumidas`, `inutilizables` = Σ;
  - `disponibles = asignadas − consumidas − inutilizables`;
  - `nivel = computeHorasStatus(asignadas − inutilizables, consumidas)`.
- `transicion(anterior, actual)` con orden `disponible < bajo < consumido < excedido`
  (`sin_asignacion` se ignora):
  - sin estado previo → guarda `actual` sin avisar (**línea base**, sin avalancha al encender);
  - empeora → `banco.nivel` y guarda; si el alcance es proyecto y cruza a `consumido` o más
    desde abajo → además `banco.al_tope`;
  - mejora → guarda sin avisar (**rearme**);
  - igual → nada.
- Clave de deduplicación de cada emisión: `banco:<proyecto>:<posicion|*>:<anterior>><actual>:<día Madrid>`
  (evita el doble aviso si dos `after()` evalúan a la vez).
- Manager del proyecto: nombre del Excel → perfil por `full_name` (sin mayúsculas ni
  espacios sobrantes). Sin coincidencia → `{ id: null, nombre: <Excel>, email: null }` y
  `console.warn`. Sin nombre → `null`.

**`evaluarHucha(projectIds?)`**: lee `hucha_banks` (`status`, `assigned_total`,
`consumed_total`, `remaining`) de proyectos `activo`, la misma `transicion` sobre
`hucha:<project_id>` con los niveles de `compute_hucha_status` (`sin_presupuesto` se
ignora). Empeora → `hucha.nivel`. Managers = `project_assignments` → perfiles.

**`alAmpliarHucha(mov)`**: `ampliarPresupuesto` pasa a leer la fila que ya devuelve
`registrar_movimiento_hucha`. Emite `hucha.ampliacion` con
`clave = hucha.ampliacion:<mov.id>` y luego `evaluarHucha([project_id])`.

**`alSincronizarHucha(creados)`**: `aplicarSync` añade al `SyncReport` la lista
`creados: { id, nombre, hucha }[]` (cambio aditivo). Un `hucha.proyecto_nuevo` por proyecto
con `clave = hucha.nuevo:<id>`; después `evaluarHucha()`.

### Reglas por defecto (constantes en `reglas.ts`)

| Regla | Valor |
|---|---|
| Llamativo `dia_largo` | `horas_dia > 10` |
| Llamativo `proyecto_largo` | horas a un mismo proyecto (≠ Departamento) en el día `>= 6` |
| Niveles de banco y HUCHA | los de `computeHorasStatus` / `compute_hucha_status` (bajo = queda menos del 20%) |
| Proyectos que avisan | bancos: estado `Activo` en el Excel; HUCHA: `projects.status = 'activo'` |
| Resumen de capacidad | top 10 (1–50 por parámetro); `porcentaje_consumido = consumidas / (asignadas − inutilizables)`; solo con base > 0 |
| Días sin registrar | laborables de lunes a viernes que no estén en `festivos`; población: perfiles `activo` con rol `operativo` o `manager`; tope 30 laborables; no cuenta días anteriores a `profiles.created_at`; cualquier `time_log` no anulado cuenta como registro (Departamento incluido) |
| Backoff | 5 min, 30 min, 2 h, 12 h; máximo 5 intentos |
| Timeout de envío | 5 s |

Cambiar una regla = deploy (mismo criterio que `CARRY_FORWARD_PCT` y los umbrales de status).

### Consultas

Autenticación: `Authorization: Bearer <AVISOS_API_KEY>`, comparada en tiempo constante;
401 si falta o no coincide. `Cache-Control: no-store`. Errores internos: 500 con `{ error }`.

- `GET /api/avisos/v1/resumen-capacidad?top=10` → `{ generado, top, con_mas_horas[], mas_libres[] }`.
  `con_mas_horas` ordena por `disponibles` descendente; `mas_libres` por
  `porcentaje_consumido` ascendente. Solo proyectos activos.
- `GET /api/avisos/v1/dias-sin-registrar?fecha=YYYY-MM-DD` (por defecto, hoy en Madrid) →
  `{ fecha, personas[] }`, solo con `dias >= 1`. Por persona: `dias` (laborables seguidos sin
  registro contando hacia atrás desde el día anterior a `fecha`), `desde` (el más antiguo),
  `ultimo_registro`, `dentro_de_plazo` (si `desde` aún se puede registrar según
  `registro_dias_atras` o 7) y `manager_directo`.

Formas exactas y ejemplos en el contrato.

### Cron

`vercel.json`: `{ "crons": [{ "path": "/api/avisos/cron", "schedule": "0 6 * * *" }] }`
(06:00 UTC = 08:00 en Madrid en verano, 07:00 en invierno). La ruta exige
`Authorization: Bearer <CRON_SECRET>` (Vercel lo envía solo si la variable existe) y declara
`maxDuration = 60`. Fuera de producción responde 200 sin hacer nada.

### Pantalla Administración → Avisos (`/admin/avisos`, solo admin)

- Un campo con la URL del webhook (una sola para todos los avisos) y **Guardar**.
- Lista de los 7 tipos: descripción corta, interruptor de activo y **Enviar prueba** (manda
  el ejemplo de ese tipo a la URL y muestra en línea el código HTTP o el error).
- Bloque de consultas: las dos URLs completas (la clave no se muestra; vive en Vercel).
- Últimos 50 envíos: fecha, tipo, estado (insignia), intentos, código, error y marca de prueba.
- Entrada "Avisos" en la sección Administración del menú (icono campana).
- Acciones: `guardarUrl(url)` (admin; URL `https://` válida, o vacía para cortar todo),
  `activarTipo(tipo, activo)` (admin) y
  `enviarPrueba(tipo)` (admin; emite el ejemplo de `contrato.ts` con `prueba: true`, lo
  despacha al momento y devuelve el resultado).
- Estilo: el de la app (shadcn, mismos patrones que `UsuariosPanel`).

### Manager directo

`EdicionUsuario` suma `manager_id: string | null`. En `UsuariosPanel`, al editar, un
`NativeSelect` con managers y admins activos, más "Sin manager directo". La acción rechaza
que alguien sea su propio manager.

### Retirada de la Fase 4

Se quita `checkHorasAlertas` de `registrar/actions.ts` y se borran `lib/horas/alertas.ts`,
`lib/horas/alertas-core.ts`, `e2e/horas-alertas.spec.ts` y su entrada en
`playwright.config.ts`. Nada más los usa. `horas_alertas` se queda (sin uso) y
`SLACK_WEBHOOK_URL` deja de leerse.

### Cambio de nombre

Título de sección en `components/AppShell.tsx` y antetítulo de `/mis-registros`:
"Control de Horas" → "Control de Rentabilidad". Rutas, carpetas y nombres internos no cambian.

### Variables de entorno (Vercel, producción)

| Variable | Uso |
|---|---|
| `AVISOS_FIRMA_SECRETO` | firma HMAC de cada envío (se la pasamos a Julián si verifica) |
| `AVISOS_API_KEY` | clave de las consultas |
| `CRON_SECRET` | autenticación del cron de Vercel |
| `APP_URL` | base de los enlaces (opcional) |

## Decisiones tomadas (y por qué)

| Decisión | Por qué |
|---|---|
| Avisos por webhook para lo que ocurre; consultas para lo que va por calendario | Julián controla horarios sin deploy y la plataforma no guarda el estado de la escalera |
| Una sola URL; el flujo separa por `tipo` | Lo pidió Julián (2026-09-11): un único webhook con un Switch (n8n) o Paths (Zapier). Cada tipo se activa o pausa por separado desde la pantalla |
| Bandeja en Postgres + `after()` | El guardado no espera; historial y reintentos |
| Solo producción envía | Única base compartida con el servidor local y los E2E |
| Línea base silenciosa | Al encender no salta de golpe todo lo que ya estaba bajo o excedido |
| `banco.al_tope` suma ampliaciones | Tras vender horas el proyecto no debe seguir "al tope" |
| Descartar si el tipo no está activo | Al activar un tipo no llega el acumulado |
| Posiciones sin asignación no avisan | Evita ruido; el total del proyecto ya lo recoge |
| Reglas fijas en código | Mismo criterio que el resto de umbrales de la app |

## Riesgos

- **Coste de `evaluarBancos` por guardado:** lee la tabla completa de líneas e histórico (el
  Excel sale de la caché de Graph). Corre en `after()`; si pesa, se acota por proyecto.
- **`after()` comparte el límite de duración** de la función que lo lanza.
- **Nombres de manager del Excel que no casan** con un perfil → aviso con `email: null`.
- **Cron diario:** sin actividad, un reintento puede esperar hasta la revisión del día siguiente.
- **Al menos una vez:** Julián debe deduplicar por `id`.

## Pruebas

- Tests de node (`e2e/avisos-reglas.spec.ts`, proyecto `node-avisos`): llamativo; transición
  (línea base, empeora, mejora, igual, cruce a al tope); días sin registrar (fin de semana,
  festivo, tope, alta reciente, un registro de Departamento cuenta); ranking; backoff; firma
  con un vector conocido. Se corren con una config temporal sin `globalSetup` (los E2E
  escriben en producción).
- Gate: `tsc --noEmit` + `next build` (el lint está roto en todo el repo).
- Verificación en producción: destino de prueba + botón "Enviar prueba"; un alta real →
  pulso; revisar el historial de la pantalla.

## Pendiente de negocio (se ajusta sin cambiar el diseño)

Umbrales definitivos, calendario de festivos, quién rellena el manager directo, qué pasa el
cuarto día sin registrar, si el primer encendido manda un resumen (hoy: línea base
silenciosa) y si Julián usa Zapier o n8n.

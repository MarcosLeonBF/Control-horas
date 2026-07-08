# Banco de horas: vista mensual y totales — Diseño

**Fecha:** 2026-07-08
**Estado:** aprobado (pendiente plan de implementación)

## 1. Objetivo

En el banco de horas se deben poder ver, por proyecto:

- **Horas mensuales**: las asignadas y consumidas en un mes concreto.
- **Horas totales**: la suma de todos los meses desde que el proyecto aparece
  en el Excel (comportamiento actual, con el asignado ahora sumando meses).

Para esto, el Excel "Banco de Horas CRM.xlsx" incorpora una **columna nueva
`Fecha`**: cada fila pasa a ser la asignación de horas de un proyecto en un
mes (las columnas de posiciones no cambian). Un proyecto puede aparecer en
tantas filas como meses tenga.

## 2. Decisiones de producto (cerradas con negocio)

| Tema | Decisión |
|---|---|
| Dónde se ve | Switch **Total \| Mensual** en la lista del banco de horas y en el detalle del proyecto. |
| Mes mostrado | Por defecto el mes en curso, con selector para navegar a meses anteriores. |
| Semáforo mensual | Sí: mismo cálculo de estado que hoy (`computeHorasStatus`), con asignadas y consumidas **del mes**. |
| Ampliaciones | Suman al asignado del **mes de su fecha** (además del total, como hoy). Son a nivel proyecto: se ven en el detalle, no en las filas por posición de la lista (igual que hoy). |
| Filas sin fecha | No habrá: el Excel se completa con fecha en todas las filas. Si aparece una, es error de datos (ver §6). |
| Arrastre de saldo | **Fuera de alcance.** La lógica de acumulación/arrastre entre meses no está definida por negocio. Cada mes se compara contra sí mismo. Cuando se defina, ver §8 (espejo Postgres). |

## 3. Enfoque elegido

**Enfoque A**: el servidor calcula el desglose mensual completo y lo envía al
cliente; el switch y el selector de mes son estado local del cliente (igual
que los filtros actuales de la lista). Cambiar de modo o de mes es
instantáneo, sin roundtrips.

Se evaluó y descartó por ahora la variante con carga por mes bajo demanda
(A′): el volumen actual no lo justifica. Queda documentada en §8 como ruta de
evolución, con umbrales concretos para saber cuándo migrar.

## 4. Datos

### 4.1 Lector del Excel (`lib/graph/client.ts`)

- La columna `Fecha` se detecta por nombre en la cabecera (comparación
  case-insensitive, con trim). Se excluye de la lista de posiciones.
- Cada fila se normaliza a mes `YYYY-MM`. Se aceptan los dos formatos que
  produce Excel: serial numérico y texto de fecha; cualquier día del mes
  representa ese mes.
- `BancoHorasProyecto` (en `lib/types.ts`) pasa de
  `{ project, positions }` a:

```ts
interface BancoHorasProyecto {
  project: string
  positions: { position: string; hours: number }[]   // totales = Σ de todas las filas (incluye filas sin fecha, §6)
  months: { month: string /* YYYY-MM */; positions: { position: string; hours: number }[] }[]
}
```

- `positions` (totales) se calcula como la suma de todas las filas del
  proyecto (las filas sin fecha cuentan aquí, §6), así los consumidores
  actuales de totales (**alertas**, **registrar**, **reportes**, API
  `/api/banco-horas`) no cambian de semántica ni de código.
- Filas duplicadas: la política defensiva actual de consolidación se aplica a
  granularidad `(proyecto, mes)` — dos filas del mismo proyecto en meses
  distintos son legítimas; dos filas del mismo proyecto y mes se consolidan
  como hoy se consolidan los proyectos repetidos.
- El cache no cambia: `unstable_cache` 5 min, tag `banco-horas`, refresco
  manual existente.

### 4.2 Consumo mensual (`lib/horas/bancos.ts`)

- La query de líneas de la lista incorpora `entry_date` (del `time_logs`
  padre, que ya se joinea para `status` y `user_id`).
- La agregación en Node agrupa el consumo por `(proyecto, posición, mes)`
  además del total (mes = `YYYY-MM` de `entry_date`; anulados excluidos, como
  hoy).
- `BancoHorasRow` gana:

```ts
monthly: { month: string; assigned: number; consumed: number }[]
```

  con la **unión** de: meses con asignación en el Excel y meses con consumo
  registrado. Orden descendente (más reciente primero).
- El estado mensual se calcula con el `computeHorasStatus` existente sobre
  las cifras del mes.

### 4.3 Detalle del proyecto

- El detalle gana el mismo desglose mensual por posición, más:
  - **Asignadas del mes (proyecto)** = Excel del mes + **ampliaciones cuya
    fecha cae en ese mes** (solo activas, como hoy).
  - Movimientos y ampliaciones se filtran al mes seleccionado en modo
    mensual.
- La vista Total del detalle queda como hoy; única diferencia semántica: el
  asignado base del Excel es la suma de todos los meses.

## 5. UI

### 5.1 Lista de bancos (`BancosHorasClient`)

- Control segmentado **Total | Mensual** junto a los filtros existentes
  (estado del cliente, como todos los filtros).
- En Mensual aparece el selector de mes: `‹ Julio 2026 ›`. Por defecto el mes
  en curso. Acotado entre el primer mes con datos y `max(mes actual, último
  mes con datos)`.
- Las columnas muestran asignadas / consumidas / restantes **del mes** y el
  badge de estado mensual. Las tarjetas de totales de la cabecera se
  recalculan para el mes.
- Los filtros existentes (búsqueda, estado, posición, manager, auditoría)
  siguen operando; el filtro de estado usa el estado del modo activo.
- Proyectos sin asignación **ni** consumo en el mes seleccionado se ocultan
  (evita filas de ceros).

### 5.2 Detalle

- Mismo control segmentado. En Mensual: tarjetas de cabecera con cifras del
  mes, tabla por posición del mes, movimientos y ampliaciones del mes.
- En Total: sin cambios visibles.

## 6. Errores y datos anómalos

| Caso | Comportamiento |
|---|---|
| Fila sin fecha o con fecha ilegible | Suma al **total** del proyecto (no se pierden horas en silencio), no aparece en ningún mes, `console.warn` con proyecto y fila. |
| Mes futuro en el Excel | Se muestra como dato (el selector extiende su cota superior). |
| Proyecto con consumo en un mes sin asignación Excel | Aparece en ese mes con asignadas 0 → estado excedido (consistente con el semáforo). |
| Excel caído (Graph falla) | Igual que hoy: la lista muestra el error existente; registrar sigue con "Departamento". |

## 7. Tests

El repo cubre esta zona con **e2e de Playwright** (sin framework de unit
tests; no se añade uno en este trabajo):

- Fixture del Graph extendida con la columna `Fecha` y varios meses por
  proyecto (incluye una fila sin fecha para el caso de error).
- Lista: el switch cambia cifras y badges; el selector navega meses; el mes
  sin datos oculta el proyecto; los totales de cabecera se recalculan.
- Detalle: cifras del mes; ampliación imputada a su mes; movimientos
  filtrados.
- Totales: los consumidores existentes (alertas, reportes) no cambian —
  cubierto por los specs actuales, que deben seguir en verde.
- Como siempre: Playwright **no** arranca el dev server (lo gestiona el
  usuario).

## 8. Escalabilidad futura (A′) — documentado, no construido

Dos dimensiones crecen con el tiempo y tienen ruta de evolución preparada:

### 8.1 Payload de la página de bancos

Hoy: filas (proyectos × posiciones) × meses de historia. Estimación: con
~300 proyectos, ~8 posiciones y 36 meses ≈ 2–4 MB de payload RSC sin
comprimir.

**Umbral de migración:** cuando el payload RSC de `/bancos` supere ~1 MB
(medible en la pestaña Network) o la historia supere ~24 meses, migrar a
carga por mes bajo demanda:

1. Endpoint `GET /api/banco-horas/mensual?mes=YYYY-MM` que devuelve solo
   `{ proyecto, posición, asignadas, consumidas }` del mes (~O(filas),
   constante en el tiempo), con el mismo cache y tag.
2. La página sirve totales + mes en curso; el cliente memoriza meses
   visitados en un `Map`. El switch sigue siendo instantáneo para el caso
   común; navegar a un mes viejo cuesta un fetch la primera vez.

### 8.2 Agregación del consumo

Hoy `getBancosHoras` trae **todas** las `time_log_lines` de la historia a
Node y suma en JS; crece sin límite.

**Umbral de migración:** cuando `time_log_lines` supere ~100k filas o el
tiempo de servidor de `/bancos` se degrade visiblemente, mover la agregación
a Postgres con una RPC (`security definer`, como las existentes):

```sql
-- banco_consumo(p_mes text default null): agrupa en SQL
select l.project, po.name as position,
       to_char(t.entry_date, 'YYYY-MM') as mes, sum(l.hours) as consumed
from time_log_lines l
join time_logs t   on t.id = l.log_id and t.status <> 'anulado'
join profiles pr   on pr.id = t.user_id
join positions po  on po.id = pr.position_id
where p_mes is null or to_char(t.entry_date, 'YYYY-MM') = p_mes
group by 1, 2, 3;
```

(Índice de apoyo si hiciera falta: `time_logs(entry_date)` ya está cubierto
por `time_logs_user_date_idx` solo parcialmente; evaluar índice por fecha.)

### 8.3 Espejo Postgres del Excel (cuando llegue el arrastre de saldo)

La lógica de arrastre/acumulación de saldo entre meses (pendiente de
negocio) va a necesitar consultas SQL sobre asignaciones mensuales. En ese
momento, espejar el Excel a una tabla en cada refresh del cache:

```
banco_asignaciones(project text, position text, mes text, hours numeric)
```

y calcular saldos/arrastres con SQL (window functions sobre meses). Hasta
entonces, el Excel cacheado es la única fuente y no se duplica estado.

## 9. Fuera de alcance

- Arrastre de saldo entre meses (lógica de negocio sin definir).
- Cualquier cambio en HUCHA.
- Añadir framework de unit tests.
- Implementar A′ (§8): solo documentado.

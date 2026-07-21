# Reportes: filas clickeables con desglose (drill-down)

**Fecha:** 2026-07-21
**Estado:** aprobado

## Objetivo

Mejorar la pantalla `/reportes`: que cada fila de la tabla agrupada sea
clickeable y abra un modal con el desglose de esas horas. Pedido a raíz de
un manager que quiere, de un vistazo, "ver quién/qué hay dentro" de cada fila
(p. ej. pinchar el proyecto "Departamento" y ver qué personas aportaron esas
horas, y luego en qué las gastaron).

## Decisiones cerradas

- **Intención:** drill-down jerárquico ("ver quién/qué hay dentro"), no matriz
  cruzada ni salto directo a registros.
- **Sub-desglose (nivel 1):** siempre por **Usuario**. Excepción: cuando la
  agrupación principal ya es por Usuario, el nivel 1 se desglosa por **Proyecto**
  (desglosar usuario dentro de usuario no tiene sentido).
- **Presentación:** un **Dialog** (modal centrado), el mismo componente que ya
  usa `RegistroForm`. No es acordeón en línea en la tabla principal.
- **Profundidad:** dos niveles dentro del modal. Nivel 1 = desglose (usuarios o
  proyectos); nivel 2 = las **líneas de registro** de cada uno.
- **Sin cambios de servidor:** todo se calcula en cliente desde las líneas ya
  cargadas y filtradas (`filtered`). No hay nuevas queries ni migraciones.

## UX / comportamiento

**Filas clickeables:** cada `<li>` de datos pasa a ser un `<button>` que ocupa la
fila entera (cursor de mano, resalte al pasar, foco y `Enter`/`Espacio` por ser
botón nativo). La fila de **Total** no es clickeable.

**Modal — cabecera:** la etiqueta de la fila + su total, p. ej.
*"Departamento — 332,74h"*. Si la agrupación es por Fecha, la cabecera lleva la
fecha formateada (DD/MM/AAAA); si es por Usuario, el nombre de la persona (con
email si hay homónimos, igual que la tabla).

**Modal — nivel 1 (desglose):** lista de usuarios (o proyectos, en el caso
especial) que componen esas horas, cada uno con su barra de reparto, sus horas y
su %, ordenados de mayor a menor. Mismo maquetado visual que la tabla principal.

**Modal — nivel 2 (registros):** cada fila del nivel 1 se puede abrir (acordeón
con chevron) para ver sus **líneas de registro** dentro de ese grupo:
- **Fecha** (DD/MM/AAAA), **Descripción** (o "—" si vacía) y **Horas**.
- Ordenadas de más reciente a más antigua (mismo criterio que el resto de la app
  y que el export "Registros").
- Se pueden abrir varios usuarios a la vez; abrir/cerrar es independiente por fila.

**Cierre:** X, `Escape` o clic fuera (comportamiento estándar del Dialog).

**Filtros:** el desglose sale de las mismas líneas ya filtradas
(proyecto/usuario/área/posición + rango), así que es coherente con lo que el
manager ve en pantalla.

## Implementación

### `lib/horas/reportes-types.ts`

Exponer la identidad de grupo de una línea, reutilizando el `KEY` interno que ya
existe (evita duplicar la lógica; clave de Usuario = id, no nombre):

```ts
export function groupKeyOf(line: ReporteLine, groupBy: GroupBy): string
// = KEY[groupBy](line).key
```

### `components/horas/ReportesView.tsx`

- Estado `selected: AggRow | null`; el Dialog se controla con `open={!!selected}`
  y se limpia a `null` al cerrar.
- Estado `expandedUsers: Set<string>` para el acordeón de nivel 2 dentro del
  modal; se reinicia al abrir/cerrar el modal.
- Cada fila de datos se envuelve en `<button onClick={() => setSelected(row)}>`.
  La fila de Total queda intacta.
- Al abrir el modal:
  - `subGroupBy = groupBy === 'user' ? 'project' : 'user'`
  - `subLines = filtered.filter(l => groupKeyOf(l, groupBy) === selected.key)`
  - `subRows = aggregate(subLines, subGroupBy)` (se reutiliza `aggregate`).
- Nivel 2 de una sub-fila con clave `subKey`:
  - `lines = subLines.filter(l => groupKeyOf(l, subGroupBy) === subKey)`
  - se ordenan por fecha desc y se muestran fecha/descripción/horas.
- **Refactor mínimo:** extraer el maquetado de "fila con barra + horas + %"
  (hoy repetido) a un pequeño componente `RankRow`, reutilizado por la tabla
  principal y por el nivel 1 del modal. Los nombres de usuario salen del
  `userLabel` que ya existe.

### Estética

Dialog de shadcn ya montado (`components/ui/dialog.tsx`); respeta el diseño
corporativo existente. El desglose calca colores, barra y tipografía de la tabla.

## Fuera de alcance (YAGNI)

- **Exportar el desglose del modal:** el modal es solo de lectura; las descargas
  existentes (Resumen / Detalle / Registros) no cambian.
- **Desglose configurable:** el nivel 1 es siempre por Usuario (automático); sin
  selector de sub-dimensión dentro del modal.
- **Matriz cruzada** y **salto directo a registros** (descartados en las preguntas).

## Verificación

- `npx tsc --noEmit` (gate de tipos; lint está roto repo-wide desde Next 16).
- `e2e/horas-reportes.spec.ts`: caso nuevo que pincha la primera fila de datos,
  comprueba que el Dialog abre con la cabecera correcta, que muestra ≥1 usuario
  en el nivel 1, y que al abrir un usuario aparecen sus líneas de registro.

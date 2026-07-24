# Tres pedidos: /equipo restringido, desglose con proyecto y etapa, orden por columna

**Fecha:** 2026-07-24
**Estado:** aprobado
**Pedido por:** reunión con los stakeholders.

## Objetivo

Tres cambios independientes, pequeños y sobre la misma zona (`/equipo` y `/reportes`).
Van en un solo spec y un solo plan porque partirlos en tres ciclos sería ceremonia sin
beneficio; cada uno es una tarea aparte y se puede aprobar o descartar por separado.

1. `/equipo` deja de ser de managers y pasa a ser una pantalla de administración.
2. El desglose de `/reportes` muestra también **proyecto** y **etapa**.
3. La tabla de `/reportes` se puede ordenar pinchando la cabecera.

---

## 1. `/equipo` solo para el admin

**Hallazgo que simplifica el pedido:** en producción hay **un solo admin**, Marcos Leon
(`dpo@bastidafarina.com`); los otros diez perfiles con acceso son managers. El pedido
"que solo lo vea Marcos" se cumple exigiendo `role === 'admin'`, sin nombrar a nadie.
Hardcodear un id o un email sería más frágil y diría algo falso: la regla real es que
esta pantalla es de administración.

### Decisiones cerradas

- **La pantalla entera**, no solo los registros. Los managers pierden también la
  estructura por área. Confirmado explícitamente: les quedan Bancos, Reportes e
  Histórico.
- **La URL no cambia**: sigue siendo `/equipo`. Solo se mueve el enlace del menú, del
  grupo "Control de Horas" al grupo "Administración". Se descartó mover la carpeta a
  `/admin/equipo` por no arrastrar redirecciones ni tocar dos specs e2e.

### Cambios

- **`app/(horas)/equipo/page.tsx`**: el guard pasa de `role !== 'manager' && role !== 'admin'`
  a `role !== 'admin'`.
- **`components/AppShell.tsx`**: la entrada `/equipo` sale del grupo "Control de Horas"
  y entra en "Administración" con `show: isAdmin`.

### Lo que no hay que tocar

- **`app/(horas)/registrar/page.tsx:84`** (`returnTo = ownerName ? '/equipo' : '/mis-registros'`):
  sigue siendo correcto. Editar un registro ajeno ya era exclusivo del admin, así que
  quien llega por ahí puede volver.
- **`e2e/horas-equipo.spec.ts` y `e2e/horas-registros-editar.spec.ts`**: corren en el
  proyecto `chromium-horas-admin`, con sesión de admin. Siguen pasando sin cambios.

---

## 2. Proyecto y etapa en el desglose de /reportes

Hoy el nivel 2 del modal (registros de una sub-fila) muestra fecha, motivo y horas.
Piden ver también proyecto y etapa. `ReporteLine` ya trae los dos campos: es trabajo
de maquetación, no de datos.

### Decisiones cerradas

- **Dos líneas por registro, no cinco columnas.** El diálogo mide 42rem y, descontando
  sangrías, quedan ~600px. Con cinco columnas cada una se queda en ~136px y todo sale
  truncado. Arriba va lo que identifica el registro (fecha, proyecto, horas); abajo,
  atenuado, etapa y motivo separados por `·`.
- **La segunda línea se alinea con el proyecto**, no con el borde: sangría de
  `6rem + 0.75rem` = `pl-27`, que es el ancho de la columna de fecha más el hueco.
- **Sin separador colgando.** Se construye una lista de partes y se descartan las
  vacías **y las que valen `'—'`** (`getReporteLines` rellena `etapa` con `'—'` cuando
  falta, no con cadena vacía). Si no queda ninguna parte, la segunda línea no se
  renderiza.
- **El histórico sigue diciendo "Histórico"** donde iría el motivo, coherente con lo
  decidido el 2026-07-24 y con lo que ya hace la descarga de Detalle.

### Cambios

- **`components/horas/ReportesView.tsx`**, el `<li>` de `registrosDe(sr.key).map(...)`:
  el `<li>` deja de ser la rejilla y pasa a contener un `<div>` con la rejilla de tres
  columnas (fecha / proyecto / horas) y un `<p>` con el detalle.

El detalle se arma así:

```tsx
const motivo = l.description || (l.historico ? 'Histórico' : '')
const detalle = [l.etapa, motivo].filter((p) => p && p !== '—').join(' · ')
```

---

## 3. Orden por columna en la tabla de /reportes

### De las cinco columnas, solo dos son ordenables

| Columna | Ordenable | Por qué |
|---|---|---|
| `#` | No | Es la posición en la lista. Ordenar por ella no significa nada. |
| Dimensión | **Sí** | Alfabético. Sirve para encontrar un nombre en una lista larga. |
| Reparto | No | Es el ancho proporcional a las horas: ordenar por ella *es* ordenar por horas. |
| Horas | **Sí** | Numérico. Es lo que se pidió. |
| % | No | Es horas ÷ total. Mismo orden que horas, siempre. |

Ofrecer cinco cabeceras pinchables sería dar tres botones que no hacen nada distinto.

### Decisiones cerradas

- **El orden por defecto no cambia** y solo se vuelve explícito al pinchar. Cada
  dimensión ya tiene el suyo: horas descendente, salvo Mes y Día que van cronológicos.
- **Cambiar de dimensión resetea el orden** al default de la nueva. "Ordenar por horas"
  no significa lo mismo en Proyecto que en Mes, y arrastrarlo sorprendería.
- **Primer clic según el tipo de dato**, convención de hoja de cálculo: en la dimensión,
  A→Z; en Horas, de mayor a menor. El segundo clic invierte.
- **Cabeceras como `<button>`**, no `<div onClick>`: foco y Enter salen gratis.
  Indicador ▲/▼ solo en la columna activa.
- **Las descargas heredan el orden de la pantalla.** Sale gratis porque `buildResumen()`
  lee las mismas filas, y evita bajar un Excel ordenado distinto de lo que se veía. Es
  intencionado, no un efecto colateral.
- **El ordinal `#` aparece solo cuando la tabla es el ranking que el número dice ser**:
  `orden === null` y dimensión no temporal. Es la misma regla que ya se aplicó a Mes y
  Día el 2026-07-24, extendida al orden manual.
- **El modal de desglose no se ordena.** Es otra tabla con su propia lógica; meterlo
  dobla el alcance sin que nadie lo haya pedido.

### Cambios

Todo en **`components/horas/ReportesView.tsx`**:

- Estado `orden: { col: 'label' | 'hours'; dir: 'asc' | 'desc' } | null`, inicial `null`.
- Las pastillas de "Agrupar por" pasan a `onClick={() => { setGroupBy(g); setOrden(null) }}`.
- `rows` aplica el orden **después** de `conMesesVacios`, sobre una copia. El orden
  alfabético usa **la etiqueta que se ve**, `labelDe(groupBy, r)`, no `r.label`: en la
  dimensión Usuario la tabla muestra el nombre con el email añadido cuando hay
  homónimos, y ordenar por una cadena distinta de la visible se lee como un fallo.

```tsx
    if (!orden) return conHuecos
    const factor = orden.dir === 'asc' ? 1 : -1
    return [...conHuecos].sort((a, b) =>
      orden.col === 'hours'
        ? factor * (a.hours - b.hours)
        : factor * labelDe(groupBy, a).localeCompare(labelDe(groupBy, b)),
    )
```

  `labelDe` depende de `userLabel`, así que ese `useMemo` lleva `userLabel` en las
  dependencias además de `orden`.

- Handler del toggle:

```tsx
  function ordenarPor(col: 'label' | 'hours') {
    setOrden((prev) =>
      prev?.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: col === 'label' ? 'asc' : 'desc' },
    )
  }
```

- La cabecera: los `<span>` de la dimensión y de Horas pasan a `<button>` con el
  indicador. Los de `#`, Reparto y % se quedan como están.
- `const mostrarOrdinal = !esTiempo && orden === null`, y `leading={mostrarOrdinal ? i + 1 : ''}`.
  La cabecera `#` usa la misma condición.

---

## Verificación

- `npx tsc --noEmit` y `npm run build` (gate del repo; lint roto repo-wide desde Next 16).
- `npx playwright test --project=node-horas` (funciones puras) y
  `npx playwright test --project=chromium-horas-admin horas-equipo horas-registros-editar horas-reportes`.
  **Requieren el dev server levantado por el usuario**: `globalSetup` hace login por
  navegador antes de cualquier proyecto.
- Comprobación manual del usuario:
  - Con sesión de manager, "Equipo" no aparece en el menú y entrar a `/equipo` a mano
    redirige a `/registrar`.
  - Con sesión de admin, "Equipo" aparece bajo Administración y la pantalla funciona.
  - En el desglose de Reportes, cada registro muestra proyecto arriba y etapa · motivo
    debajo; un registro sin etapa ni motivo no deja una segunda línea vacía.
  - Pinchar la cabecera de Horas y la de la dimensión ordena en ambos sentidos; el `#`
    desaparece al ordenar a mano y vuelve al cambiar de pastilla.

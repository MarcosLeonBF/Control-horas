# Tres pedidos (Equipo + Reportes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restringir `/equipo` al admin, mostrar proyecto y etapa en el desglose de `/reportes`, y permitir ordenar la tabla de `/reportes` pinchando la cabecera.

**Architecture:** Tres cambios independientes. El primero son dos líneas (un guard y una entrada de menú). Los otros dos siguen el patrón que ya usa la pantalla: la lógica pura vive en `lib/horas/reportes-types.ts` con tests propios, y `ReportesView.tsx` solo la consume. Así el armado del texto del desglose y el comparador del orden se prueban sin montar React.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, Playwright como único runner de tests.

**Spec:** `docs/superpowers/specs/2026-07-24-reportes-equipo-tres-pedidos-design.md`

## Global Constraints

- **Gate de verificación del repo: `npx tsc --noEmit` y `npm run build`.** `npm run lint` está roto repo-wide desde Next 16 — no lo uses como señal.
- **Nunca arranques ni pares el dev server.** Lo gestiona el usuario. `playwright.config.ts` no tiene bloque `webServer` a propósito.
- **Los tests de Playwright necesitan el dev server ya levantado en `http://localhost:3000`**, incluso los del proyecto `node-horas` que son funciones puras: `globalSetup` hace login por navegador antes de cualquier proyecto. Si falla ahí, el dev server no está arriba: pídeselo al usuario.
- **Playwright no hace type-check** (transpila con esbuild). Un import inexistente no da error de tipos: llega a ejecución como `undefined` y revienta con `TypeError: X is not a function`. Los errores de tipos los da `npx tsc --noEmit`.
- **Sin identidad visual nueva.** Ni paleta, ni tipografías, ni componentes nuevos.
- **No nombres a Marcos en el código.** La regla es `role === 'admin'`; que hoy Marcos sea el único admin es un dato, no la regla.

---

### Task 1: `/equipo` solo para el admin

**Files:**
- Modify: `app/(horas)/equipo/page.tsx:56`
- Modify: `components/AppShell.tsx:27` y `:43-47`

**Interfaces:**
- Consumes: `getViewerScope()` y su campo `role`; `isAdmin` en `buildSections`. Ambos ya existen.
- Produces: nada que consuman otras tasks.

- [ ] **Step 1: Endurecer el guard de la página**

En `app/(horas)/equipo/page.tsx`, sustituye la línea del guard:

```tsx
  if (viewer.role !== 'admin') redirect('/registrar')
```

Queda justo debajo de `if (!viewer) redirect('/login')`. Con esto un manager que escriba `/equipo` a mano acaba en `/registrar`.

- [ ] **Step 2: Mover la entrada del menú**

En `components/AppShell.tsx`, **quita** la línea 27 del grupo "Control de Horas":

```tsx
        { href: '/equipo', label: 'Equipo', icon: Users, show: isMgr },
```

y **añádela** como primera del grupo "Administración", con `isAdmin`:

```tsx
    {
      title: 'Administración',
      items: [
        { href: '/equipo', label: 'Equipo', icon: Users, show: isAdmin },
        { href: '/admin/usuarios', label: 'Usuarios', icon: UserCog, show: isAdmin || canCreateUsers },
        { href: '/admin/catalogos', label: 'Catálogos', icon: Tags, show: isAdmin },
        { href: '/admin/auditoria', label: 'Auditoría', icon: History, show: isAdmin },
      ],
    },
```

No quites el import de `Users`: solo se mueve la entrada. `isMgr` sigue en uso para Bancos, Reportes e Histórico, así que tampoco sobra.

- [ ] **Step 3: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin salida.

Run: `npm run build`
Expected: `✓ Compiled successfully`, con `/equipo` todavía listada como `ƒ`.

- [ ] **Step 4: Correr los e2e que tocan /equipo**

Los dos specs corren con sesión de admin, así que **deben seguir pasando sin tocarlos**. Si alguno falla, el guard está mal.

Run: `npx playwright test --project=chromium-horas-admin horas-equipo horas-registros-editar --reporter=line`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(horas)/equipo/page.tsx" components/AppShell.tsx
git commit -m "feat(equipo): la pantalla pasa a ser de administracion, solo admin"
```

---

### Task 2: `detalleDeLinea` — el texto de etapa y motivo

**Files:**
- Modify: `lib/horas/reportes-types.ts` (añadir al final)
- Test: `e2e/horas-reportes-mes.spec.ts` (añadir)

**Interfaces:**
- Consumes: el tipo `ReporteLine`, ya definido en el mismo archivo.
- Produces: `detalleDeLinea(line: ReporteLine): string` — la segunda línea del desglose, `"Etapa · Motivo"`, sin partes vacías. Lo usa la Task 3.

- [ ] **Step 1: Escribir los tests que fallan**

Añade al final de `e2e/horas-reportes-mes.spec.ts`, y amplía el import de `reportes-types` a `{ aggregate, conMesesVacios, detalleDeLinea }`. El helper `linea(date, hours)` que ya existe en ese archivo no sirve aquí porque fija `etapa` y `description`: estos tests construyen la línea a mano.

```ts
// Línea completa a medida: aquí lo que importa son `etapa`, `description` e `historico`.
const conDetalle = (etapa: string, description: string, historico = false): ReporteLine => ({
  date: '2026-07-15', project: 'Vancubic', area: 'Área', etapa, department: 'Clientes',
  userId: 'u1', user: 'Usuario', position: 'Posición', hours: 1, description,
  isInternal: false, historico,
})

test('detalleDeLinea junta etapa y motivo con un punto medio', () => {
  expect(detalleDeLinea(conDetalle('Servicios Mensuales', 'Ajustes del CRM')))
    .toBe('Servicios Mensuales · Ajustes del CRM')
})

// getReporteLines rellena `etapa` con '—' cuando falta, no con cadena vacía.
test('detalleDeLinea descarta la etapa cuando vale la raya', () => {
  expect(detalleDeLinea(conDetalle('—', 'Ajustes del CRM'))).toBe('Ajustes del CRM')
})

test('detalleDeLinea sin motivo deja solo la etapa, sin separador colgando', () => {
  expect(detalleDeLinea(conDetalle('Desarrollo', ''))).toBe('Desarrollo')
})

test('detalleDeLinea rotula el historico donde iria el motivo', () => {
  expect(detalleDeLinea(conDetalle('Servicios Mensuales', '', true)))
    .toBe('Servicios Mensuales · Histórico')
})

test('detalleDeLinea sin nada que decir devuelve cadena vacia', () => {
  expect(detalleDeLinea(conDetalle('—', ''))).toBe('')
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx playwright test --project=node-horas horas-reportes-mes --reporter=line`
Expected: FAIL en los 5 tests nuevos con `TypeError: (0 , _reportesTypes.detalleDeLinea) is not a function`. Los 9 anteriores siguen en verde.

- [ ] **Step 3: Implementar**

Al final de `lib/horas/reportes-types.ts`:

```ts
// Segunda línea del desglose de /reportes: "Etapa · Motivo". Se descartan las partes
// vacías y las que valen '—' (getReporteLines rellena así la etapa que falta), para que
// no quede un separador colgando. El histórico no trae motivo: se rotula "Histórico",
// igual que en la descarga de Detalle.
export function detalleDeLinea(line: ReporteLine): string {
  const motivo = line.description || (line.historico ? 'Histórico' : '')
  return [line.etapa, motivo].filter((p) => p && p !== '—').join(' · ')
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx playwright test --project=node-horas horas-reportes-mes --reporter=line`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/horas/reportes-types.ts e2e/horas-reportes-mes.spec.ts
git commit -m "feat(reportes): detalleDeLinea arma etapa y motivo del desglose"
```

---

### Task 3: Proyecto y etapa en el desglose

**Files:**
- Modify: `components/horas/ReportesView.tsx` (el `<li>` dentro de `registrosDe(sr.key).map(...)`, y el import)

**Interfaces:**
- Consumes: `detalleDeLinea(line)` (Task 2).
- Produces: nada que consuman otras tasks.

- [ ] **Step 1: Ampliar el import**

En `components/horas/ReportesView.tsx:6`:

```ts
import { GROUP_LABELS, GROUP_ORDER, aggregate, conMesesVacios, detalleDeLinea, groupKeyOf } from '@/lib/horas/reportes-types'
```

- [ ] **Step 2: Pasar el registro a dos líneas**

Reemplaza el `<li>` completo dentro de `registrosDe(sr.key).map((l, i) => (...))`. El `<li>` deja de ser la rejilla: ahora contiene la rejilla de tres columnas y, debajo, el detalle.

```tsx
                        {registrosDe(sr.key).map((l, i) => {
                          const detalle = detalleDeLinea(l)
                          return (
                            <li key={`${l.date}-${i}`} className="py-1.5 pr-5 pl-13 text-xs">
                              <div className="grid grid-cols-[6rem_1fr_4.5rem] items-baseline gap-3">
                                <span className="tabular-money text-muted-foreground">{formatFechaISO(l.date)}</span>
                                <span className="truncate text-foreground/80" title={l.project}>{l.project}</span>
                                <span className="text-right tabular-money font-medium">{formatHoras(l.hours)}</span>
                              </div>
                              {/* Sangría = ancho de la columna de fecha (6rem) + el hueco
                                  de la rejilla (gap-3 = 0.75rem), para alinear con el proyecto. */}
                              {detalle && (
                                <p className="truncate pl-27 text-muted-foreground" title={detalle}>{detalle}</p>
                              )}
                            </li>
                          )
                        })}
```

Fíjate en que el `.map` pasa de devolver JSX directo (`=> (`) a tener cuerpo (`=> {` … `return`), porque hace falta calcular `detalle` antes.

- [ ] **Step 3: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin salida.

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add components/horas/ReportesView.tsx
git commit -m "feat(reportes): el desglose muestra proyecto y etapa"
```

---

### Task 4: `ordenarFilas` — el comparador del orden manual

**Files:**
- Modify: `lib/horas/reportes-types.ts` (añadir al final)
- Test: `e2e/horas-reportes-mes.spec.ts` (añadir)

**Interfaces:**
- Consumes: el tipo `AggRow`, ya definido en el mismo archivo.
- Produces:
  - `export type OrdenTabla = { col: 'label' | 'hours'; dir: 'asc' | 'desc' } | null`
  - `ordenarFilas(rows: AggRow[], orden: OrdenTabla, etiqueta: (row: AggRow) => string): AggRow[]`

  La etiqueta llega como callback en vez de leer `row.label`: la tabla muestra `labelDe()`, que añade el email a los usuarios homónimos, y ordenar por una cadena distinta de la visible se lee como un fallo. Ambos los usa la Task 5.

- [ ] **Step 1: Escribir los tests que fallan**

Añade al final de `e2e/horas-reportes-mes.spec.ts`, y amplía el import a `{ aggregate, conMesesVacios, detalleDeLinea, ordenarFilas }`:

```ts
const FILAS = [
  { key: 'b', label: 'Bravo', hours: 5 },
  { key: 'a', label: 'Alfa', hours: 20 },
  { key: 'c', label: 'Charlie', hours: 12 },
]
const porLabel = (r: { label: string }) => r.label

test('ordenarFilas sin orden devuelve las filas tal cual', () => {
  expect(ordenarFilas(FILAS, null, porLabel)).toEqual(FILAS)
})

test('ordenarFilas por horas descendente', () => {
  expect(ordenarFilas(FILAS, { col: 'hours', dir: 'desc' }, porLabel).map((r) => r.hours)).toEqual([20, 12, 5])
})

test('ordenarFilas por horas ascendente', () => {
  expect(ordenarFilas(FILAS, { col: 'hours', dir: 'asc' }, porLabel).map((r) => r.hours)).toEqual([5, 12, 20])
})

test('ordenarFilas alfabetico usa la etiqueta que recibe, no row.label', () => {
  // La tabla muestra el nombre con email en los homónimos: el orden debe seguir a eso.
  const visible = (r: { key: string }) => ({ a: 'Zeta', b: 'Alfa', c: 'Mike' })[r.key] ?? ''
  expect(ordenarFilas(FILAS, { col: 'label', dir: 'asc' }, visible).map((r) => r.key)).toEqual(['b', 'c', 'a'])
})

test('ordenarFilas no muta el array que recibe', () => {
  const original = [...FILAS]
  ordenarFilas(FILAS, { col: 'hours', dir: 'asc' }, porLabel)
  expect(FILAS).toEqual(original)
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx playwright test --project=node-horas horas-reportes-mes --reporter=line`
Expected: FAIL en los 5 tests nuevos con `TypeError: (0 , _reportesTypes.ordenarFilas) is not a function`. Los 14 anteriores siguen en verde.

- [ ] **Step 3: Implementar**

Al final de `lib/horas/reportes-types.ts`:

```ts
// Orden manual de la tabla de /reportes. `null` = el orden por defecto de cada
// dimensión (horas descendente, o cronológico en Mes y Día).
export type OrdenTabla = { col: 'label' | 'hours'; dir: 'asc' | 'desc' } | null

// Ordena una copia, nunca el array que recibe. `etiqueta` llega como callback porque la
// tabla no muestra siempre `row.label`: en la dimensión Usuario añade el email a los
// homónimos, y el orden tiene que seguir a lo que se ve.
export function ordenarFilas(rows: AggRow[], orden: OrdenTabla, etiqueta: (row: AggRow) => string): AggRow[] {
  if (!orden) return rows
  const factor = orden.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) =>
    orden.col === 'hours' ? factor * (a.hours - b.hours) : factor * etiqueta(a).localeCompare(etiqueta(b)),
  )
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx playwright test --project=node-horas horas-reportes-mes --reporter=line`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/horas/reportes-types.ts e2e/horas-reportes-mes.spec.ts
git commit -m "feat(reportes): ordenarFilas para el orden manual de la tabla"
```

---

### Task 5: Cabeceras pinchables en la tabla

**Files:**
- Modify: `components/horas/ReportesView.tsx` (imports, orden de declaraciones, estado, `rows`, pastillas, cabecera, `leading`)

**Interfaces:**
- Consumes: `ordenarFilas(rows, orden, etiqueta)` y el tipo `OrdenTabla` (Task 4).
- Produces: nada que consuman otras tasks.

- [ ] **Step 1: Ampliar los imports**

Línea 4, los iconos — hacen falta los dos chevrones verticales para el indicador:

```ts
import { ChevronDown, ChevronRight, ChevronUp, Download, Filter, X } from 'lucide-react'
```

Línea 5-6, los tipos y funciones:

```ts
import type { ReporteLine, ReporteFilterOptions, GroupBy, AggRow, OrdenTabla } from '@/lib/horas/reportes-types'
import { GROUP_LABELS, GROUP_ORDER, aggregate, conMesesVacios, detalleDeLinea, groupKeyOf, ordenarFilas } from '@/lib/horas/reportes-types'
```

- [ ] **Step 2: Mover `labelDe` por encima de `rows`**

**Esto no es cosmético: sin ello la app revienta en render.** `labelDe` se declara con `const` hacia el final del componente, y el `useMemo` de `rows` se ejecuta antes; usarlo desde ahí daría `ReferenceError: Cannot access 'labelDe' before initialization`.

Borra la declaración de donde está ahora (justo debajo de `toggleSubFila`, con su comentario):

```tsx
  // Etiqueta a mostrar de una clave (los usuarios llevan email si hay homónimos).
  const labelDe = (dim: GroupBy, row: AggRow) => (dim === 'user' ? (userLabel.get(row.key) ?? row.label) : row.label)
```

y pégala **inmediatamente después** del `useMemo` de `userLabel` (del que depende) y **antes** del `useMemo` de `filtered`.

- [ ] **Step 3: Añadir el estado del orden**

Junto al resto de estado del componente, después de `const [conHistorico, setConHistorico] = useState(true)`:

```tsx
  // Orden manual de la tabla. null = el orden por defecto de la dimensión activa.
  const [orden, setOrden] = useState<OrdenTabla>(null)
```

- [ ] **Step 4: Aplicar el orden al construir las filas**

Reemplaza el `useMemo` de `rows` entero:

```tsx
  const rows = useMemo(() => {
    const base = aggregate(filtered, groupBy)
    // Solo Mes rellena huecos. Rellenar días vacíos metería cada fin de semana y cada
    // festivo como fila: ruido, no información.
    const conHuecos = groupBy === 'month' ? conMesesVacios(base, from, to) : base
    return ordenarFilas(conHuecos, orden, (r) => labelDe(groupBy, r))
  }, [filtered, groupBy, from, to, orden, labelDe])
```

`labelDe` entra en las dependencias porque se lee dentro. Es una función que se recrea en cada render, así que el `useMemo` recalcula siempre; con estas listas (decenas de filas) no importa, y la alternativa —envolverla en `useCallback`— añade ruido para nada.

- [ ] **Step 5: Resetear el orden al cambiar de dimensión**

"Ordenar por horas" no significa lo mismo en Proyecto que en Mes. En el `GROUP_ORDER.map`, el `onClick` de la pastilla:

```tsx
                onClick={() => { setGroupBy(g); setOrden(null) }}
```

- [ ] **Step 6: Declarar el indicador y la condición del ordinal**

Junto a `const esTiempo = ...`:

```tsx
  // El ordinal solo se muestra cuando la tabla es el ranking que el número dice ser:
  // orden por defecto y dimensión no temporal.
  const mostrarOrdinal = !esTiempo && orden === null

  function ordenarPor(col: 'label' | 'hours') {
    // Primer clic según el tipo de dato, como en una hoja de cálculo: texto A→Z,
    // números de mayor a menor. El segundo invierte.
    setOrden((prev) =>
      prev?.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: col === 'label' ? 'asc' : 'desc' },
    )
  }

  const caret = (col: 'label' | 'hours') =>
    orden?.col !== col ? null : orden.dir === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />
```

- [ ] **Step 7: Convertir las dos cabeceras en botones**

En la cabecera de la tabla, reemplaza los cinco `<span>`. `#`, Reparto y % se quedan como texto; la dimensión y Horas pasan a `<button>`. Sin `<div onClick>`: el botón trae foco y Enter de serie.

```tsx
          {/* La columna no se colapsa: ROW_GRID la comparten esta tabla y el nivel 1
              del modal, y estrecharla desalinearía el modal. */}
          <span className="text-right">{mostrarOrdinal ? '#' : ''}</span>
          <button
            type="button"
            onClick={() => ordenarPor('label')}
            title={`Ordenar por ${dimLabel.toLowerCase()}`}
            className="inline-flex items-center gap-1 text-left uppercase tracking-[0.12em] transition-colors hover:text-foreground focus:outline-none focus-visible:text-foreground"
          >
            {dimLabel}{caret('label')}
          </button>
          <span>Reparto</span>
          <button
            type="button"
            onClick={() => ordenarPor('hours')}
            title="Ordenar por horas"
            className="inline-flex items-center justify-end gap-1 uppercase tracking-[0.12em] transition-colors hover:text-foreground focus:outline-none focus-visible:text-foreground"
          >
            Horas{caret('hours')}
          </button>
          <span className="text-right">%</span>
```

- [ ] **Step 8: Usar la nueva condición en el ordinal de cada fila**

En el `rows.map`, `leading` pasa de `esTiempo` a `mostrarOrdinal`:

```tsx
                  leading={mostrarOrdinal ? i + 1 : ''}
```

`esTiempo` sigue usándose dentro de `mostrarOrdinal`, así que no lo borres.

- [ ] **Step 9: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin salida.

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 10: Correr el e2e de reportes**

El spec pincha la pastilla "Día" y descarga el resumen. Nada de eso cambia, pero la cabecera sí: conviene confirmar que no se rompió nada.

Run: `npx playwright test --project=chromium-horas-admin horas-reportes --reporter=line`
Expected: PASS, 2 tests.

- [ ] **Step 11: Commit**

```bash
git add components/horas/ReportesView.tsx
git commit -m "feat(reportes): ordenar la tabla pinchando la cabecera"
```

---

## Verificación final

- [ ] `npx tsc --noEmit` sin salida y `npm run build` compilando.
- [ ] `npx playwright test --project=node-horas` en verde (34 tests: 15 previos + 9 de Mes + 10 nuevos).
- [ ] `npx playwright test --project=chromium-horas-admin horas-equipo horas-registros-editar horas-reportes` en verde.
- [ ] Comprobación manual del usuario:
  - Con sesión de **manager**: "Equipo" no aparece en el menú, y entrar a `/equipo` a mano lleva a `/registrar`.
  - Con sesión de **admin**: "Equipo" aparece bajo Administración y la pantalla funciona igual que antes.
  - En el desglose de Reportes: cada registro muestra el proyecto arriba y "etapa · motivo" debajo, alineado con el proyecto. Un registro sin etapa ni motivo no deja una segunda línea vacía.
  - Pinchar "Horas" ordena de mayor a menor y, al segundo clic, al revés. Pinchar la cabecera de la dimensión ordena A→Z y Z→A.
  - El `#` desaparece al ordenar a mano y vuelve al cambiar de pastilla.
  - Descargar el Resumen tras ordenar: el Excel sale en el mismo orden que la pantalla.

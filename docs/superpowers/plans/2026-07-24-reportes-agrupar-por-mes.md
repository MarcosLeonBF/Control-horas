# Reportes: agrupar por Mes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir la dimensión **Mes** a "Agrupar por" en `/reportes`, para que un manager lea la actividad del equipo mes a mes.

**Architecture:** La pantalla ya agrupa por 7 dimensiones a través de un mapa `KEY: Record<GroupBy, (l: ReporteLine) => {key, label}>` en `lib/horas/reportes-types.ts`. Añadir una dimensión es añadir una entrada a ese mapa, a `GROUP_LABELS` y a `GROUP_ORDER`; la pastilla y el modal de desglose salen gratis. Lo único que no encaja en lo existente es el relleno de meses vacíos, porque `aggregate()` solo ve líneas y un mes sin líneas no existe para ella: se resuelve con una función aparte que recibe el rango.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind v4, Playwright como único runner de tests.

**Spec:** `docs/superpowers/specs/2026-07-24-reportes-agrupar-por-mes-design.md`

## Global Constraints

- **Gate de verificación del repo: `npx tsc --noEmit` y `npm run build`.** `npm run lint` está roto repo-wide desde Next 16 — no lo uses como señal.
- **Nunca arranques ni pares el dev server.** Lo gestiona el usuario. `playwright.config.ts` no tiene bloque `webServer` a propósito.
- **Los tests de Playwright necesitan el dev server ya levantado en `http://localhost:3000`**, incluso los del proyecto `node-horas` que son funciones puras: `globalSetup` hace login por navegador antes de cualquier proyecto. Si el dev server no está arriba, los tests fallan en el setup, no en tu código.
- **Sin identidad visual nueva.** Ni paleta, ni tipografías, ni componentes nuevos. Todo reutiliza lo que ya hay en la pantalla.
- **Copy exacto, literal:** pastilla `Mes`; pastilla `Día` (sustituye a `Fecha`); aviso `Solo hay un mes en el rango. Amplía las fechas para comparar mes a mes.`
- **Etiqueta del mes: `mesCorto()` → "Jul 2026".** No uses `formatMes()`: en es-ES devuelve "Julio **de** 2026".
- **No cambies claves internas.** La dimensión `date` sigue llamándose `date` aunque su etiqueta pase a "Día"; los nombres de descarga (`reporte-horas-por-date`) dependen de ello.

---

### Task 1: `mesesEnRango` en format.ts

**Files:**
- Modify: `lib/horas/format.ts` (añadir `mesesEnRango` tras `addMonths` ~línea 64; corregir el comentario de `formatMes` en 26-27)
- Modify: `playwright.config.ts` (proyectos `node-horas` y `chromium-horas`)
- Test: `e2e/horas-reportes-mes.spec.ts` (crear)

**Interfaces:**
- Consumes: `addMonths(month: string, delta: number): string` — ya existe en el mismo archivo.
- Produces: `mesesEnRango(from: string, to: string): string[]` — los `'YYYY-MM'` que toca un rango de fechas ISO, en orden ascendente, con los dos extremos incluidos. Lo usa la Task 3.

- [ ] **Step 1: Registrar el nuevo spec en el proyecto de tests puros**

`e2e/horas-reportes-mes.spec.ts` no usa navegador. Debe correr en `node-horas`, igual que `horas-carry.spec.ts`. Sin esto, el patrón `**/horas-*.spec.ts` lo arrastraría al proyecto `chromium-horas`, que le montaría un navegador y una sesión para nada.

En `playwright.config.ts`, añade el archivo al `testMatch` de `node-horas`:

```ts
    {
      name: 'node-horas',
      testMatch: ['**/horas-alertas.spec.ts', '**/horas-carry.spec.ts', '**/horas-reportes-mes.spec.ts'],
    },
```

y al `testIgnore` de `chromium-horas` (donde ya están `horas-alertas` y `horas-carry` por el mismo motivo):

```ts
      testIgnore: ['**/horas-alta-usuario.spec.ts', '**/horas-equipo.spec.ts', '**/horas-bancos*.spec.ts', '**/horas-reportes.spec.ts', '**/horas-alertas.spec.ts', '**/horas-usuarios-editar.spec.ts', '**/horas-usuarios-alta-delegada.spec.ts', '**/horas-auditoria.spec.ts', '**/horas-registros-editar.spec.ts', '**/horas-carry.spec.ts', '**/horas-reportes-mes.spec.ts'],
```

- [ ] **Step 2: Escribir el test que falla**

Crea `e2e/horas-reportes-mes.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { mesesEnRango } from '../lib/horas/format'

test('mesesEnRango incluye el mes de los dos extremos', () => {
  expect(mesesEnRango('2026-06-15', '2026-08-03')).toEqual(['2026-06', '2026-07', '2026-08'])
})

test('mesesEnRango de un rango dentro del mismo mes da un solo mes', () => {
  expect(mesesEnRango('2026-07-01', '2026-07-24')).toEqual(['2026-07'])
})

test('mesesEnRango cruza el cambio de año', () => {
  expect(mesesEnRango('2025-11-20', '2026-02-05')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
})

test('mesesEnRango con hasta anterior a desde no da meses', () => {
  expect(mesesEnRango('2026-08-01', '2026-06-01')).toEqual([])
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx playwright test --project=node-horas horas-reportes-mes`

Expected: FAIL en los 4 tests con `TypeError: mesesEnRango is not a function`. Playwright transpila con esbuild y **no hace type-check**, así que un import inexistente no da error de tipos: llega a ejecución como `undefined`.

Si en cambio falla con un timeout o un error de login en `globalSetup`, el dev server no está levantado. Pídeselo al usuario; no lo arranques.

- [ ] **Step 4: Implementar**

En `lib/horas/format.ts`, justo después de `addMonths`:

```ts
// Los meses ('YYYY-MM') que toca un rango de fechas ISO, en orden y con los dos
// extremos incluidos ('2026-06-15' → '2026-08-03' da junio, julio y agosto). La
// vista por mes de /reportes lo usa para rellenar los meses del rango que no tienen
// ni una línea. Si `to` es anterior a `from`, no hay meses.
export function mesesEnRango(from: string, to: string): string[] {
  const fin = to.slice(0, 7)
  const meses: string[] = []
  for (let m = from.slice(0, 7); m <= fin; m = addMonths(m, 1)) meses.push(m)
  return meses
}
```

La comparación `m <= fin` es de cadenas: `'YYYY-MM'` ordena lexicográficamente igual que cronológicamente, así que no hace falta pasar por `Date`.

- [ ] **Step 5: Corregir el comentario de `formatMes`**

En el mismo archivo, `formatMes` dice devolver "Julio 2026" y devuelve **"Julio de 2026"**: en es-ES `Intl` mete el "de". Verificado en Node 22. El comentario engaña a quien busque un formateador de mes, que es exactamente lo que pasó al diseñar esta feature. En `lib/horas/format.ts:26-27`:

```ts
// 'YYYY-MM' → "Julio de 2026" (es-ES, inicial mayúscula; el "de" lo pone Intl). Si no
// es un mes válido, devuelve la entrada tal cual. timeZone UTC para no deslizarse de mes.
```

No toques la función: el month-picker la usa así y ahí el "de" lee bien.

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx playwright test --project=node-horas horas-reportes-mes`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add lib/horas/format.ts e2e/horas-reportes-mes.spec.ts playwright.config.ts
git commit -m "feat(format): mesesEnRango devuelve los meses que toca un rango ISO"
```

---

### Task 2: La dimensión `month`

**Files:**
- Modify: `lib/horas/reportes-types.ts` (`GroupBy`, `GROUP_LABELS`, `GROUP_ORDER`, `KEY`, `aggregate`)
- Modify: `components/horas/HistoricoMatriz.tsx:12`
- Test: `e2e/horas-reportes-mes.spec.ts` (añadir)

**Interfaces:**
- Consumes: `mesCorto(month: string): string` de `lib/horas/format.ts` — ya existe, `'2026-07'` → `"Jul 2026"`.
- Produces: el valor `'month'` del tipo `GroupBy`, y `aggregate(lines, 'month')` devolviendo `AggRow[]` con `key = 'YYYY-MM'`, `label = "Jul 2026"`, orden cronológico descendente. Lo usan las Tasks 3, 4 y 5.

- [ ] **Step 1: Escribir los tests que fallan**

Añade al final de `e2e/horas-reportes-mes.spec.ts`. Fíjate en el import: crece con `aggregate` y el tipo `ReporteLine`.

```ts
import type { ReporteLine } from '../lib/horas/reportes-types'
import { aggregate } from '../lib/horas/reportes-types'

// Línea mínima: solo `date` y `hours` importan para agrupar por mes.
const linea = (date: string, hours: number): ReporteLine => ({
  date, project: 'Proyecto', area: 'Área', etapa: 'Etapa', department: 'Clientes',
  userId: 'u1', user: 'Usuario', position: 'Posición', hours, description: '',
  isInternal: false, historico: false,
})

test('aggregate por mes suma las líneas de cada mes', () => {
  const rows = aggregate([linea('2026-07-01', 2), linea('2026-07-24', 3), linea('2026-06-30', 4)], 'month')
  expect(rows).toEqual([
    { key: '2026-07', label: 'Jul 2026', hours: 5 },
    { key: '2026-06', label: 'Jun 2026', hours: 4 },
  ])
})

test('aggregate por mes ordena cronológico descendente, no por horas', () => {
  const rows = aggregate([linea('2026-06-10', 100), linea('2026-07-10', 1)], 'month')
  expect(rows.map((r) => r.key)).toEqual(['2026-07', '2026-06'])
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx playwright test --project=node-horas horas-reportes-mes`
Expected: FAIL en los 2 tests nuevos con `TypeError: keyOf is not a function`, lanzado dentro de `aggregate`: no existe la entrada `'month'` en el mapa `KEY`, así que `KEY[groupBy]` es `undefined`. Los 4 de la Task 1 siguen en verde.

(Sí, `'month'` no es un `GroupBy` válido todavía y `npx tsc --noEmit` lo diría; Playwright no, porque no hace type-check.)

- [ ] **Step 3: Añadir la dimensión**

En `lib/horas/reportes-types.ts`, el import pasa a traer `mesCorto`:

```ts
import { formatFechaISO, mesCorto } from '@/lib/horas/format'
```

El tipo, las etiquetas y el orden de las pastillas. `'month'` va entre `'position'` y `'date'`: de escala gruesa a fina.

```ts
export type GroupBy = 'project' | 'user' | 'area' | 'department' | 'etapa' | 'position' | 'month' | 'date'

export const GROUP_LABELS: Record<GroupBy, string> = {
  project: 'Proyecto',
  user: 'Usuario',
  area: 'Área',
  department: 'Departamento',
  etapa: 'Etapa',
  position: 'Posición',
  month: 'Mes',
  date: 'Fecha',
}

export const GROUP_ORDER: GroupBy[] = ['project', 'user', 'area', 'department', 'etapa', 'position', 'month', 'date']
```

La entrada del mapa `KEY`, junto a `date`:

```ts
  // Clave = 'YYYY-MM' (ordena cronológicamente sola, sin pasar por Date);
  // etiqueta = "Jul 2026", como rotula meses el resto de la app.
  month: (l) => ({ key: l.date ? l.date.slice(0, 7) : '—', label: l.date ? mesCorto(l.date.slice(0, 7)) : '—' }),
```

Y el orden en `aggregate`, que hasta ahora solo trataba `date` como tiempo:

```ts
  // Dimensiones de tiempo: orden cronológico descendente (la clave es ISO, así que
  // lo más reciente queda arriba). Resto de dimensiones: por horas descendente.
  return groupBy === 'date' || groupBy === 'month'
    ? rows.sort((a, b) => b.key.localeCompare(a.key))
    : rows.sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label))
```

- [ ] **Step 4: Sacar "Mes" de la matriz de histórico**

`HistoricoMatriz` construye sus pastillas de dimensión desde `GROUP_ORDER`, así que "Mes" aparecería ahí sola. Esa matriz **ya tiene un mes por columna**: ofrecerlo también como dimensión de fila daría meses contra meses.

En `components/horas/HistoricoMatriz.tsx:11-12`, reemplaza el comentario y la constante:

```ts
// El tiempo son las columnas: ni "Día" ni "Mes" tienen sentido como dimensión de
// fila (esta matriz ya tiene un mes por columna).
const DIMENSIONES = GROUP_ORDER.filter((g) => g !== 'date' && g !== 'month')
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx playwright test --project=node-horas horas-reportes-mes`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin salida.

`GROUP_LABELS` y `KEY` son `Record<GroupBy, …>`, así que si te falta una entrada, TypeScript lo dice aquí.

- [ ] **Step 7: Commit**

```bash
git add lib/horas/reportes-types.ts components/horas/HistoricoMatriz.tsx e2e/horas-reportes-mes.spec.ts
git commit -m "feat(reportes): dimension Mes en la agregacion"
```

---

### Task 3: `conMesesVacios`

**Files:**
- Modify: `lib/horas/reportes-types.ts` (añadir tras `aggregate`)
- Test: `e2e/horas-reportes-mes.spec.ts` (añadir)

**Interfaces:**
- Consumes: `mesesEnRango(from, to): string[]` (Task 1), `mesCorto(month): string`, el tipo `AggRow` (ya existe: `{ key: string; label: string; hours: number }`).
- Produces: `conMesesVacios(rows: AggRow[], from: string, to: string): AggRow[]`. La usa la Task 4.

- [ ] **Step 1: Escribir los tests que fallan**

Añade a `e2e/horas-reportes-mes.spec.ts`, y amplía el import de `reportes-types` a `{ aggregate, conMesesVacios }`:

```ts
test('conMesesVacios rellena a 0h el mes sin registros', () => {
  const rows = [
    { key: '2026-08', label: 'Ago 2026', hours: 10 },
    { key: '2026-06', label: 'Jun 2026', hours: 20 },
  ]
  expect(conMesesVacios(rows, '2026-06-01', '2026-08-31')).toEqual([
    { key: '2026-08', label: 'Ago 2026', hours: 10 },
    { key: '2026-07', label: 'Jul 2026', hours: 0 },
    { key: '2026-06', label: 'Jun 2026', hours: 20 },
  ])
})

test('conMesesVacios no duplica un mes que ya venía', () => {
  const rows = [{ key: '2026-07', label: 'Jul 2026', hours: 5 }]
  expect(conMesesVacios(rows, '2026-07-01', '2026-07-24')).toEqual(rows)
})

// Sin ninguna línea, la tabla debe seguir mostrando su estado vacío. Un rango de tres
// años daría 36 filas huecas que no dicen nada.
test('conMesesVacios sin filas no inventa meses', () => {
  expect(conMesesVacios([], '2024-01-01', '2026-12-31')).toEqual([])
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx playwright test --project=node-horas horas-reportes-mes`
Expected: FAIL en los 3 tests nuevos con `TypeError: conMesesVacios is not a function`. Los 6 anteriores siguen en verde.

- [ ] **Step 3: Implementar**

En `lib/horas/reportes-types.ts`, después de `aggregate`. El import de `format` pasa a traer también `mesesEnRango`:

```ts
import { formatFechaISO, mesCorto, mesesEnRango } from '@/lib/horas/format'
```

```ts
// Completa los meses del rango que la agregación no produjo, a 0 h, en orden
// cronológico descendente. Un mes sin registros es información —el manager ve el
// hueco—, así que la vista por mes sí muestra ceros; el resto de dimensiones no
// (un proyecto sin horas simplemente no existe).
//
// Con `rows` vacío devuelve vacío a propósito: si no hay ni una línea, la tabla debe
// seguir mostrando su estado vacío en vez de una pared de meses a cero.
export function conMesesVacios(rows: AggRow[], from: string, to: string): AggRow[] {
  if (rows.length === 0) return []
  const presentes = new Set(rows.map((r) => r.key))
  const vacios = mesesEnRango(from, to)
    .filter((m) => !presentes.has(m))
    .map((m) => ({ key: m, label: mesCorto(m), hours: 0 }))
  return [...rows, ...vacios].sort((a, b) => b.key.localeCompare(a.key))
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx playwright test --project=node-horas horas-reportes-mes`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/horas/reportes-types.ts e2e/horas-reportes-mes.spec.ts
git commit -m "feat(reportes): conMesesVacios completa los meses sin registros a 0h"
```

---

### Task 4: Mes en la tabla de Reportes

Aquí la pastilla "Mes" ya aparece y funciona (sale de `GROUP_ORDER`, Task 2). Esta tarea añade lo que la vista por mes necesita y que ninguna otra dimensión pide: los meses vacíos, su tratamiento visual y el aviso de rango corto.

**Files:**
- Modify: `components/horas/ReportesView.tsx` (import, `RankRow`, `rows`, el bloque de la tabla, el aviso)

**Interfaces:**
- Consumes: `conMesesVacios(rows, from, to)` (Task 3). `from` y `to` ya llegan como props al componente.
- Produces: nada que consuman otras tasks.

- [ ] **Step 1: Ampliar el import de `reportes-types`**

En `components/horas/ReportesView.tsx:6`:

```ts
import { GROUP_LABELS, GROUP_ORDER, aggregate, conMesesVacios, groupKeyOf } from '@/lib/horas/reportes-types'
```

- [ ] **Step 2: Rellenar los meses vacíos al construir las filas**

Reemplaza `const rows = useMemo(() => aggregate(filtered, groupBy), [filtered, groupBy])` (~línea 131):

```tsx
  const rows = useMemo(() => {
    const base = aggregate(filtered, groupBy)
    // Solo Mes rellena huecos. Rellenar días vacíos metería cada fin de semana y
    // cada festivo como fila: ruido, no información.
    return groupBy === 'month' ? conMesesVacios(base, from, to) : base
  }, [filtered, groupBy, from, to])
```

`max`, `totals` y el porcentaje no necesitan cambios: una fila a 0 h no mueve el máximo ni el total, y su `%` sale 0.

- [ ] **Step 3: Dar a `RankRow` una variante atenuada**

Un mes vacío tiene que leerse como hueco, no como fila rota. En la firma de `RankRow` (~línea 56) añade `muted`:

```tsx
function RankRow({
  leading, label, hours, pct, barW, onClick, muted = false,
}: {
  leading: ReactNode
  label: string
  hours: number
  pct: number
  barW: number
  onClick?: () => void
  muted?: boolean
}) {
```

Y en `inner`, la etiqueta y las horas pierden el peso y bajan a color secundario. El carril de la barra se queda visible: con `barW = 0` el relleno mide cero y el hueco se ve solo.

```tsx
      <span className={cn('truncate text-left', muted ? 'text-muted-foreground' : 'font-medium text-foreground')} title={label}>{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-(--muted-surface)">
        <span className="block h-full rounded-full bg-(--brand)" style={{ width: `${barW}%` }} />
      </span>
      <span className={cn('text-right tabular-money', muted ? 'text-muted-foreground' : 'font-medium')}>{formatHoras(hours)}</span>
```

- [ ] **Step 4: Atenuar la fila vacía y no dejar que se abra**

En el `rows.map` de la tabla principal (~línea 321), `onClick` solo si hay horas: abrir el modal sobre un mes sin líneas daría un panel de desglose vacío. `RankRow` ya renderiza un `<div>` en vez de un `<button>` cuando no recibe `onClick`, así que pierde foco y cursor sin más trabajo.

```tsx
            {rows.map((r, i) => (
              <li key={r.key} className="border-b border-border/60 last:border-0">
                <RankRow
                  leading={i + 1}
                  label={labelDe(groupBy, r)}
                  hours={r.hours}
                  pct={totals.total > 0 ? (r.hours / totals.total) * 100 : 0}
                  barW={max > 0 ? (r.hours / max) * 100 : 0}
                  onClick={r.hours > 0 ? () => abrirFila(r) : undefined}
                  muted={r.hours === 0}
                />
              </li>
            ))}
```

- [ ] **Step 5: Añadir el aviso de rango de un solo mes**

Agrupando por Mes con un rango dentro del mismo mes sale una única fila al 100%, que se lee como un fallo. El aviso va **entre** el cierre del bloque "Agrupar por + descargas" (línea 307, el `</div>`) y el comentario `{/* Tabla */}` (línea 309):

```tsx
      {groupBy === 'month' && from.slice(0, 7) === to.slice(0, 7) && (
        <p className="text-sm text-muted-foreground">
          Solo hay un mes en el rango. Amplía las fechas para comparar mes a mes.
        </p>
      )}
```

No toques `from` ni `to`: son del manager.

- [ ] **Step 6: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin salida.

Run: `npm run build`
Expected: `✓ Compiled successfully`, y `/reportes` sigue listada como `ƒ` (dinámica).

- [ ] **Step 7: Commit**

```bash
git add components/horas/ReportesView.tsx
git commit -m "feat(reportes): la vista por mes muestra los meses sin registros a 0h"
```

---

### Task 5: Sin ordinal en las dimensiones de tiempo

La tabla es un ranking: `#` = puesto, orden por horas descendente. Al agrupar por tiempo el orden pasa a cronológico y el `#` afirma algo falso —"Julio es el nº 1" cuando julio solo es el más reciente—. Esto **ya pasa hoy con Día**; se corrige para las dos.

**Files:**
- Modify: `components/horas/ReportesView.tsx` (cabecera de la tabla y `rows.map`)

**Interfaces:**
- Consumes: el valor `'month'` de `GroupBy` (Task 2).
- Produces: nada que consuman otras tasks.

- [ ] **Step 1: Declarar la condición**

Junto a `const dimLabel = GROUP_LABELS[groupBy]` (~línea 146):

```tsx
  // La tabla es un ranking, pero las dimensiones de tiempo van en orden cronológico:
  // ahí el ordinal afirmaría un puesto que no existe.
  const esTiempo = groupBy === 'month' || groupBy === 'date'
```

- [ ] **Step 2: Vaciar la cabecera `#`**

En la cabecera de la tabla (~línea 309), el primer `<span>`:

```tsx
          <span className="text-right">{esTiempo ? '' : '#'}</span>
```

No quites la columna de `ROW_GRID`: esa rejilla la comparten la tabla principal y el nivel 1 del modal, y estrecharla desalinearía el modal.

- [ ] **Step 3: Vaciar el ordinal de cada fila**

En el `rows.map`, `leading` pasa de `i + 1` a condicional. Deja el resto de props como quedaron en la Task 4:

```tsx
                  leading={esTiempo ? '' : i + 1}
```

- [ ] **Step 4: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add components/horas/ReportesView.tsx
git commit -m "fix(reportes): sin ordinal de ranking en las vistas por tiempo"
```

---

### Task 6: "Fecha" pasa a "Día"

Con "Mes" en la lista, "Fecha" es ambiguo: un mes también es una fecha.

**Files:**
- Modify: `lib/horas/reportes-types.ts` (`GROUP_LABELS.date`)
- Modify: `e2e/horas-reportes.spec.ts:41`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: nada que consuman otras tasks.

- [ ] **Step 1: Cambiar la etiqueta**

En `lib/horas/reportes-types.ts`, dentro de `GROUP_LABELS`, **solo** la etiqueta. La clave sigue siendo `date`:

```ts
  date: 'Día',
```

Arrastra dos sitios más, y los dos mejoran solos: el texto del modal ("Desglose por día") y la cabecera de la columna en el Excel/CSV de Resumen, que salen de `GROUP_LABELS`. El Excel de Detalle tiene su propia columna `Fecha` con la fecha real de cada línea; esa no se toca.

- [ ] **Step 2: Arreglar el test e2e que se rompe**

`e2e/horas-reportes.spec.ts:41` busca el botón por su texto. En `e2e/horas-reportes.spec.ts`, líneas 40-41:

```ts
  // agrupar por Día (día a día)
  await page.getByRole('button', { name: 'Día' }).click()
```

La aserción de la línea 50 (`reporte-horas-por-date`) **se queda como está**: la clave interna no cambió, y por eso mismo ese test sigue probando lo que decía probar.

- [ ] **Step 3: Verificar el gate del repo**

Run: `npx tsc --noEmit`
Expected: sin salida.

- [ ] **Step 4: Correr el test e2e de reportes**

Requiere el dev server levantado por el usuario.

Run: `npx playwright test --project=chromium-horas-admin horas-reportes`
Expected: PASS. Si falla con `getByRole('button', { name: 'Día' })` no encontrado, la etiqueta del Step 1 no se guardó.

- [ ] **Step 5: Commit**

```bash
git add lib/horas/reportes-types.ts e2e/horas-reportes.spec.ts
git commit -m "feat(reportes): la dimension date se llama Dia, no Fecha"
```

---

## Verificación final

- [ ] `npx tsc --noEmit` sin salida y `npm run build` compilando.
- [ ] `npx playwright test --project=node-horas horas-reportes-mes` en verde (9 tests).
- [ ] Contrastar por SQL el total de un mes contra la fila que muestre la pantalla, con el interruptor de histórico encendido y apagado.
- [ ] Comprobación manual del usuario en `/reportes`:
  - Rango 01/06 → 24/07, pastilla Mes: dos filas, "Jul 2026" arriba.
  - Un rango con un mes intermedio sin registros: ese mes sale a 0,00 h, atenuado y sin abrirse al pincharlo.
  - Rango dentro de un solo mes + pastilla Mes: aparece el aviso.
  - Pastillas Mes y Día: sin número de orden. El resto de dimensiones lo conservan.

## Nota para quien revise los totales

Agrupar por mes junta en la misma fila los registros de la plataforma y el cierre del histórico de ese mes, que va fechado a fin de mes. Junio 2026 suma las 350 filas históricas más lo registrado en la plataforma en junio; si esas horas se solapan, esa fila saldrá inflada. **No es un fallo de la agrupación** y no se corrige en este plan: el interruptor "Incluir histórico" permite verlo sin el histórico.

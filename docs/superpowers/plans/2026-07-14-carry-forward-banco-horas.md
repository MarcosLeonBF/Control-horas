# Carry forward del banco de horas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al cerrar cada mes del banco, el 25% del sobrante se conserva como horas libres (carry forward) y el 75% se inutiliza; el disponible real del proyecto lo refleja, distinguiendo disponibles normales de carry, con charts shadcn por posición en el detalle.

**Architecture:** Todo derivado on-read (patrón de la app): una función pura `carrySplit` sobre el `monthly[]` por posición que ya existe. Sin migraciones, sin estado guardado. El servidor (`bancos.ts`) puebla los campos; el cliente agrupa/suma. Status y restante pasan a cifras efectivas (`asignado − inutilizables`).

**Tech Stack:** Next.js App Router, TypeScript estricto, Tailwind v4 (tokens CSS), shadcn charts (`components/ui/chart.tsx` + `recharts`), Playwright (tests node puros + e2e UI).

## Global Constraints

- **Gate real = `npx tsc --noEmit`** (+ build en Vercel). `npm run lint` está roto repo-wide; no es gate.
- **El dev server es del usuario (user-managed).** No arrancarlo ni pararlo; los e2e UI corren contra `http://localhost:3000` ya levantado. Los tests node (`--project=node-horas`) NO necesitan server.
- **Sin migraciones ni cambios de RPC/Excel.**
- `CARRY_FORWARD_PCT = 0.25` constante en código (spec §Decisiones 1).
- Estética: tokens existentes (`--brand` carmín, `--status-excedido`, `--status-disponible`, `--muted-surface`); charts con esos colores.
- Convención e2e: `horas-carry.spec.ts` → proyecto `node-horas` (agregar a su `testMatch` y al `testIgnore` de `chromium-horas`); `horas-bancos-carry.spec.ts` matchea `horas-bancos*.spec.ts` → corre solo en `chromium-horas-admin` (ya cableado).
- Fixture canónica de tests = tabla enero–julio de la spec (`docs/superpowers/specs/2026-07-14-carry-forward-banco-horas-design.md`).

---

### Task 1: Función pura `carrySplit` + tests node (TDD)

**Files:**
- Create: `lib/horas/carry-forward.ts`
- Create: `e2e/horas-carry.spec.ts`
- Modify: `playwright.config.ts:17` (testMatch de `node-horas`) y `:24` (testIgnore de `chromium-horas`)

**Interfaces:**
- Consumes: `BancoMensual` de `lib/horas/bancos-status.ts` (`{ month, assigned, consumed, provisional? }`).
- Produces: `CARRY_FORWARD_PCT = 0.25`; `carrySplit(monthly: BancoMensual[], mesActual: string): { porMes: CarryMes[]; totales: CarryTotales }` con `CarryMes = { month: string; libres: number; inutilizables: number; exceso: number }` y `CarryTotales = { inutilizables: number; carryBruto: number; carryNeto: number }`. Tasks 2–4 dependen de estos nombres exactos.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `e2e/horas-carry.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { carrySplit, CARRY_FORWARD_PCT } from '../lib/horas/carry-forward'

const MES_ACTUAL = '2026-07'
// Tabla de referencia de la spec (hoja del usuario, enero–julio).
const TABLA = [
  { month: '2026-01', assigned: 5, consumed: 2 },
  { month: '2026-02', assigned: 5, consumed: 2 },
  { month: '2026-03', assigned: 5, consumed: 0 },
  { month: '2026-04', assigned: 5, consumed: 1 },
  { month: '2026-05', assigned: 5, consumed: 0 },
  { month: '2026-06', assigned: 0, consumed: 3 },
  { month: '2026-07', assigned: 5, consumed: 0 },
]

test('la tabla de referencia da inutilizables 15, carry bruto 5 y neto 2', () => {
  const { totales } = carrySplit(TABLA, MES_ACTUAL)
  expect(totales.inutilizables).toBeCloseTo(15)
  expect(totales.carryBruto).toBeCloseTo(5)
  expect(totales.carryNeto).toBeCloseTo(2)
})

test('el mes en curso no sufre el corte (julio no aparece en porMes)', () => {
  const { porMes } = carrySplit(TABLA, MES_ACTUAL)
  expect(porMes.map((m) => m.month)).not.toContain('2026-07')
  expect(porMes).toHaveLength(6)
})

test('enero: sobrante 3 → 0.75 libres y 2.25 inutilizables', () => {
  const { porMes } = carrySplit(TABLA, MES_ACTUAL)
  const enero = porMes.find((m) => m.month === '2026-01')!
  expect(enero.libres).toBeCloseTo(0.75)
  expect(enero.inutilizables).toBeCloseTo(2.25)
  expect(enero.exceso).toBe(0)
})

test('junio excedido: sobrante 0, sin libres, exceso 3', () => {
  const { porMes } = carrySplit(TABLA, MES_ACTUAL)
  const junio = porMes.find((m) => m.month === '2026-06')!
  expect(junio.libres).toBe(0)
  expect(junio.inutilizables).toBe(0)
  expect(junio.exceso).toBe(3)
})

test('el ejemplo de abril: 16 asignadas y 8 consumidas → 6 inútiles y 2 libres', () => {
  const { porMes } = carrySplit([{ month: '2026-04', assigned: 16, consumed: 8 }], '2026-05')
  expect(porMes[0].libres).toBeCloseTo(2)
  expect(porMes[0].inutilizables).toBeCloseTo(6)
})

test('sin meses: todo en cero', () => {
  const { porMes, totales } = carrySplit([], MES_ACTUAL)
  expect(porMes).toEqual([])
  expect(totales).toEqual({ inutilizables: 0, carryBruto: 0, carryNeto: 0 })
})

test('los excesos nunca dejan el carry negativo', () => {
  const { totales } = carrySplit(
    [
      { month: '2026-01', assigned: 4, consumed: 0 }, // libres 1
      { month: '2026-02', assigned: 0, consumed: 9 }, // exceso 9
    ],
    MES_ACTUAL,
  )
  expect(totales.carryNeto).toBe(0)
})

test('la constante del corte es 25%', () => {
  expect(CARRY_FORWARD_PCT).toBe(0.25)
})
```

Cablear el archivo en `playwright.config.ts`. En el proyecto `node-horas` (línea 17):

```ts
      testMatch: ['**/horas-alertas.spec.ts', '**/horas-carry.spec.ts'],
```

Y en el `testIgnore` de `chromium-horas` (línea 24), agregar `'**/horas-carry.spec.ts'` al final del array existente:

```ts
      testIgnore: ['**/horas-alta-usuario.spec.ts', '**/horas-equipo.spec.ts', '**/horas-bancos*.spec.ts', '**/horas-reportes.spec.ts', '**/horas-alertas.spec.ts', '**/horas-usuarios-editar.spec.ts', '**/horas-auditoria.spec.ts', '**/horas-registros-editar.spec.ts', '**/horas-carry.spec.ts'],
```

- [ ] **Step 2: Correr los tests → deben FALLAR**

Run: `npx playwright test horas-carry --project=node-horas --reporter=list`
Expected: FAIL — `Cannot find module '../lib/horas/carry-forward'` (el módulo no existe).

- [ ] **Step 3: Implementar `carrySplit`**

Crear `lib/horas/carry-forward.ts`:

```ts
import type { BancoMensual } from '@/lib/horas/bancos-status'

// Carry forward del banco (spec 2026-07-14): al cerrar un mes, el 25% de su sobrante se
// conserva como horas libres y el 75% se inutiliza; los excesos de meses cerrados
// descuentan del carry acumulado. El mes en curso no sufre el corte. Aplica a TODO mes
// cerrado sin distinción de origen (real, provisional o setup): recalculable siempre.
export const CARRY_FORWARD_PCT = 0.25

export interface CarryMes {
  month: string
  libres: number
  inutilizables: number
  exceso: number
}

export interface CarryTotales {
  inutilizables: number
  carryBruto: number // Σ libres de meses cerrados (sin netear excesos)
  carryNeto: number // max(carryBruto − Σ excesos, 0): lo realmente arrastrable
}

export function carrySplit(
  monthly: Pick<BancoMensual, 'month' | 'assigned' | 'consumed'>[],
  mesActual: string,
): { porMes: CarryMes[]; totales: CarryTotales } {
  const porMes: CarryMes[] = []
  let inutilizables = 0
  let carryBruto = 0
  let excesos = 0
  for (const m of monthly) {
    if (m.month >= mesActual) continue // mes en curso (o futuro): sin corte
    const sobrante = Math.max(m.assigned - m.consumed, 0)
    const exceso = Math.max(m.consumed - m.assigned, 0)
    const libres = CARRY_FORWARD_PCT * sobrante
    const inutil = sobrante - libres // complemento exacto (evita drift de flotantes)
    porMes.push({ month: m.month, libres, inutilizables: inutil, exceso })
    inutilizables += inutil
    carryBruto += libres
    excesos += exceso
  }
  return { porMes, totales: { inutilizables, carryBruto, carryNeto: Math.max(carryBruto - excesos, 0) } }
}
```

- [ ] **Step 4: Correr los tests → deben PASAR**

Run: `npx playwright test horas-carry --project=node-horas --reporter=list`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (exit 0). Si aparecen errores en `.next/**`, son artefactos stale del dev server: borrar `.next/types` y `.next/dev/types/*` y reintentar.

- [ ] **Step 6: Commit**

```bash
git add lib/horas/carry-forward.ts e2e/horas-carry.spec.ts playwright.config.ts
git commit -m "feat(bancos): carrySplit — corte 75/25 del sobrante de meses cerrados"
```

---

### Task 2: Tipos + cálculo en servidor + cifras efectivas

**Files:**
- Modify: `lib/horas/bancos-status.ts` (BancoMensual, BancoHorasRow, BancoHorasDetalle, BancoHorasProyecto, groupBancosByProject)
- Modify: `lib/horas/bancos.ts` (getBancosHoras y getBancoHorasDetalle)

**Interfaces:**
- Consumes: `carrySplit`/`CarryTotales` de Task 1 (import `{ carrySplit } from '@/lib/horas/carry-forward'`).
- Produces: `BancoMensual` gana `libres?: number` e `inutilizables?: number`; `BancoHorasRow`, `BancoHorasDetalle` y `BancoHorasProyecto` ganan `inutilizables: number` y `carryNeto: number`; `remaining` pasa a ser el disponible real (`assigned − consumed − inutilizables`); `status` se calcula con `computeHorasStatus(assigned − inutilizables, consumed)`. Tasks 3–4 dependen de estos campos.

- [ ] **Step 1: Extender los tipos en `bancos-status.ts`**

En `BancoMensual` (líneas 6-11), agregar los dos opcionales:

```ts
export interface BancoMensual {
  month: string // 'YYYY-MM'
  assigned: number
  consumed: number
  provisional?: boolean // true si `assigned` es un estimado provisional (no confirmado)
  libres?: number // carry forward: 25% del sobrante (solo meses cerrados)
  inutilizables?: number // 75% del sobrante que se pierde al cerrar el mes
}
```

En `BancoHorasRow` (líneas 13-24), después de `remaining: number`:

```ts
  remaining: number // disponible real: assigned − consumed − inutilizables
  inutilizables: number // Σ 75% de sobrantes de meses cerrados (carry forward)
  carryNeto: number // Σ libres − Σ excesos de meses cerrados, con piso en 0
```

En `BancoHorasDetalle` (líneas 58-70), después de `remaining: number`:

```ts
  remaining: number // disponible real del proyecto (assigned − consumed − inutilizables)
  inutilizables: number // Σ de las posiciones visibles
  carryNeto: number // Σ de las posiciones visibles
```

En `BancoHorasProyecto` (líneas 106-117), después de `remaining: number`:

```ts
  remaining: number
  inutilizables: number
  carryNeto: number
```

- [ ] **Step 2: Actualizar `groupBancosByProject`**

Reemplazar la función completa (líneas 132-162) por:

```ts
// Agrupa las filas (proyecto+posición) por proyecto, sumando el banco total y
// calculando el estado a nivel proyecto. Las posiciones quedan ordenadas por nombre.
export function groupBancosByProject(rows: BancoHorasRow[]): BancoHorasProyecto[] {
  const map = new Map<string, BancoHorasProyecto>()
  for (const r of rows) {
    let g = map.get(r.project)
    if (!g) {
      g = { project: r.project, projectEstado: r.projectEstado, manager: r.manager, fechaAuditoria: r.fechaAuditoria, positions: [], assigned: 0, consumed: 0, remaining: 0, inutilizables: 0, carryNeto: 0, status: 'sin_asignacion', monthly: [] }
      map.set(r.project, g)
    }
    g.positions.push(r)
    g.assigned += r.assigned
    g.consumed += r.consumed
    g.inutilizables += r.inutilizables
    g.carryNeto += r.carryNeto
  }
  for (const g of map.values()) {
    // Cifras efectivas: el disponible real descuenta los inutilizables del carry forward.
    g.remaining = g.assigned - g.consumed - g.inutilizables
    g.status = computeHorasStatus(g.assigned - g.inutilizables, g.consumed)
    g.positions.sort((a, b) => a.position.localeCompare(b.position))
    // Mensual del proyecto = suma de lo mensual de sus posiciones.
    const byMonth = new Map<string, BancoMensual>()
    for (const p of g.positions) {
      for (const m of p.monthly) {
        const acc = byMonth.get(m.month) ?? { month: m.month, assigned: 0, consumed: 0 }
        acc.assigned += m.assigned
        acc.consumed += m.consumed
        if (m.provisional) acc.provisional = true
        if (m.libres) acc.libres = (acc.libres ?? 0) + m.libres
        if (m.inutilizables) acc.inutilizables = (acc.inutilizables ?? 0) + m.inutilizables
        byMonth.set(m.month, acc)
      }
    }
    g.monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
  }
  return [...map.values()]
}
```

- [ ] **Step 3: Poblar el carry en `getBancosHoras` (bancos.ts)**

Agregar el import (línea 6, junto a los de provisionales):

```ts
import { carrySplit } from '@/lib/horas/carry-forward'
```

En el loop de posiciones, reemplazar el cierre (líneas 156-166, desde `const monthly = ...` hasta el `rows.push({...})` inclusive) por:

```ts
      const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))

      // Carry forward (spec 2026-07-14): corte 75/25 de meses cerrados; el disponible
      // real y el status descuentan los inutilizables. Anota el desglose en cada mes.
      const carry = carrySplit(monthly, currentMonth())
      for (const cm of carry.porMes) {
        const m = byMonth.get(cm.month)
        if (m && (cm.libres > 0 || cm.inutilizables > 0)) { m.libres = cm.libres; m.inutilizables = cm.inutilizables }
      }

      rows.push({
        project, position, assigned, consumed: cons,
        remaining: assigned - cons - carry.totales.inutilizables,
        inutilizables: carry.totales.inutilizables,
        carryNeto: carry.totales.carryNeto,
        status: computeHorasStatus(assigned - carry.totales.inutilizables, cons),
        monthly,
        projectEstado: meta?.estado,
        manager: meta?.manager,
        fechaAuditoria: meta?.fechaAuditoria,
      })
```

(Los objetos de `byMonth` son las mismas referencias que `monthly`, así que la anotación llega a la fila.)

- [ ] **Step 4: Poblar el carry en `getBancoHorasDetalle` (bancos.ts)**

En el map de `posiciones` (líneas 253-272), reemplazar el cierre del callback (desde `const monthly = ...` hasta el `return {...}`) por:

```ts
      const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
      const carry = carrySplit(monthly, currentMonth())
      for (const cm of carry.porMes) {
        const m = byMonth.get(cm.month)
        if (m && (cm.libres > 0 || cm.inutilizables > 0)) { m.libres = cm.libres; m.inutilizables = cm.inutilizables }
      }
      return {
        project: name, position, assigned, consumed,
        remaining: assigned - consumed - carry.totales.inutilizables,
        inutilizables: carry.totales.inutilizables,
        carryNeto: carry.totales.carryNeto,
        status: computeHorasStatus(assigned - carry.totales.inutilizables, consumed),
        monthly,
      }
```

Y en los totales del proyecto (líneas 277-284 y el `return` final, líneas 313-326): después de `const consumed = ...` agregar:

```ts
  const inutilizables = posiciones.reduce((s, p) => s + p.inutilizables, 0)
  const carryNeto = posiciones.reduce((s, p) => s + p.carryNeto, 0)
```

y en el objeto devuelto, reemplazar `remaining` y `status` y agregar los campos nuevos:

```ts
    assigned,
    consumed,
    remaining: assigned - consumed - inutilizables,
    inutilizables,
    carryNeto,
    status: computeHorasStatus(assigned - inutilizables, consumed),
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (Los componentes cliente compilan sin cambios: `viewRows` esparce `...r` y conserva los campos nuevos.)

- [ ] **Step 6: Regresión e2e de bancos (server del usuario levantado)**

Run: `npx playwright test horas-bancos.spec --project=chromium-horas-admin --reporter=list`
Expected: PASS (7 tests; validan que la lista/detalle siguen funcionando con las cifras efectivas).

- [ ] **Step 7: Commit**

```bash
git add lib/horas/bancos-status.ts lib/horas/bancos.ts
git commit -m "feat(bancos): disponible real y status con carry forward (cifras efectivas)"
```

---

### Task 3: Charts shadcn + KPI "Disponible real" en el detalle

**Files:**
- Create: `components/ui/chart.tsx` (vía CLI shadcn) + dependencia `recharts`
- Create: `components/horas/CarryForwardCharts.tsx`
- Modify: `components/horas/BancoDetalleView.tsx` (KPI + sección nueva)
- Create: `e2e/horas-bancos-carry.spec.ts`

**Interfaces:**
- Consumes: `BancoHorasRow.monthly` con `libres?/inutilizables?` (Task 2); `BancoHorasDetalle.inutilizables/carryNeto` (Task 2); `mesCorto`/`currentMonth`/`formatHoras` de `lib/horas/format.ts`.
- Produces: `<CarryForwardCharts posiciones={BancoHorasRow[]} />` (default export).

- [ ] **Step 1: Instalar el componente chart de shadcn**

Run: `npx shadcn@latest add chart --yes`
Expected: crea `components/ui/chart.tsx` e instala `recharts` en package.json. Verificar con `npx tsc --noEmit` que compila (el proyecto usa style base-nova, components.json ya existe).

- [ ] **Step 2: Escribir el e2e que falla**

Crear `e2e/horas-bancos-carry.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('el detalle muestra Disponible real y el cierre de mes por posición', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()
  const primera = page.locator('a[href^="/bancos/"]').first()
  if (!(await primera.isVisible().catch(() => false))) return // sin proyectos visibles
  // Navegación con reintento: la lista se re-ordena al hidratar y el clic puede perderse.
  await expect(async () => {
    await primera.click()
    await page.waitForURL(/\/bancos\/.+/, { timeout: 2500 })
  }).toPass({ timeout: 15000 })
  // KPI nuevo (vista Total).
  await expect(page.getByText('Disponible real')).toBeVisible()
  // La sección de charts existe solo si el proyecto tiene datos mensuales (tolerante).
  const cierre = page.getByRole('heading', { name: 'Cierre de mes por posición' })
  if ((await cierre.count()) > 0) await expect(cierre.first()).toBeVisible()
})
```

- [ ] **Step 3: Correr el e2e → debe FALLAR**

Run: `npx playwright test horas-bancos-carry --project=chromium-horas-admin --reporter=list`
Expected: FAIL — el KPI se llama "Restante", no existe "Disponible real".

- [ ] **Step 4: Crear `CarryForwardCharts.tsx`**

Crear `components/horas/CarryForwardCharts.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import type { BancoHorasRow } from '@/lib/horas/bancos-status'
import { currentMonth, mesCorto } from '@/lib/horas/format'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'

// Series del cierre de mes, con los tokens de la app (estética existente).
const config = {
  consumido: { label: 'Consumido', color: 'var(--brand)' },
  inutilizables: { label: 'Inutilizables', color: 'var(--status-excedido)' },
  libres: { label: 'Libres (carry)', color: 'var(--status-disponible)' },
  restante: { label: 'Restante (mes en curso)', color: 'var(--muted-foreground)' },
} satisfies ChartConfig

// "Cierre de mes por posición": un stacked bar por posición. La barra de cada mes
// cerrado queda llena (consumido + inutilizables + libres = asignado del mes); el mes
// en curso muestra su restante sin corte. Los meses provisionales van marcados.
export default function CarryForwardCharts({ posiciones }: { posiciones: BancoHorasRow[] }) {
  const cm = currentMonth()
  const charts = useMemo(
    () =>
      posiciones
        .filter((p) => p.monthly.length > 0)
        .map((p) => ({
          position: p.position,
          data: p.monthly.map((m) => ({
            mes: mesCorto(m.month) + (m.provisional ? ' ·prov' : ''),
            consumido: Math.min(m.consumed, m.assigned),
            inutilizables: m.inutilizables ?? 0,
            libres: m.libres ?? 0,
            restante: m.month >= cm ? Math.max(m.assigned - m.consumed, 0) : 0,
          })),
        })),
    [posiciones, cm],
  )

  if (charts.length === 0) return null

  return (
    <section className="mb-10">
      <h2 className="font-display mb-1 text-xl font-semibold">Cierre de mes por posición</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Cada mes cerrado queda contabilizado por completo: consumido, inutilizables (75% del sobrante) y libres (25%, arrastran como carry forward). El mes en curso aún no sufre el corte.
      </p>
      <div className={charts.length > 1 ? 'grid gap-4 md:grid-cols-2' : ''}>
        {charts.map((c) => (
          <div key={c.position} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="mb-3 text-sm font-medium">{c.position}</p>
            <ChartContainer config={config} className="h-48 w-full">
              <BarChart data={c.data} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="consumido" stackId="a" fill="var(--color-consumido)" />
                <Bar dataKey="inutilizables" stackId="a" fill="var(--color-inutilizables)" />
                <Bar dataKey="libres" stackId="a" fill="var(--color-libres)" />
                <Bar dataKey="restante" stackId="a" fill="var(--color-restante)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: KPI "Disponible real" + sección en `BancoDetalleView.tsx`**

Agregar el import:

```tsx
import CarryForwardCharts from '@/components/horas/CarryForwardCharts'
```

Reemplazar la línea `const restante = cab.assigned - cab.consumed` (línea 38) por:

```tsx
  // Disponible real (vista Total): descuenta los inutilizables del carry forward y
  // desglosa normales vs carry (spec 2026-07-14). En Mensual no aplica el corte.
  const inutil = esMensual ? 0 : d.inutilizables
  const restante = cab.assigned - cab.consumed - inutil
  const carryNeto = esMensual ? 0 : d.carryNeto
  const normalMostrado = Math.max(restante - carryNeto, 0)
  const carryMostrado = Math.max(restante - normalMostrado, 0)
```

Reemplazar la card "Restante" (líneas 115-120) por:

```tsx
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs text-foreground/50">{esMensual ? 'Restante' : 'Disponible real'}</p>
          <p className={`tabular-money mt-1 text-2xl font-semibold ${restante < 0 ? 'text-(--status-excedido)' : ''}`}>
            {formatHoras(restante)}
          </p>
          {!esMensual && restante >= 0 && (
            <p className="mt-1 text-xs text-foreground/45">
              {[
                normalMostrado > 0 && `${formatHoras(normalMostrado)} del mes`,
                carryMostrado > 0 && `${formatHoras(carryMostrado)} carry forward`,
                inutil > 0 && `${formatHoras(inutil)} inutilizables`,
              ].filter(Boolean).join(' · ') || 'Sin horas disponibles'}
            </p>
          )}
        </div>
```

Insertar la sección de charts entre la sección "Por posición" (cierra en línea 195 `</section>`) y la sección "Ampliaciones", solo en vista Total:

```tsx
      {!esMensual && <CarryForwardCharts posiciones={d.posiciones} />}
```

- [ ] **Step 6: Typecheck + e2e → deben PASAR**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npx playwright test horas-bancos-carry --project=chromium-horas-admin --reporter=list`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/ui/chart.tsx components/horas/CarryForwardCharts.tsx components/horas/BancoDetalleView.tsx e2e/horas-bancos-carry.spec.ts package.json package-lock.json
git commit -m "feat(bancos): charts de cierre de mes por posición + KPI Disponible real"
```

---

### Task 4: Marca «CF» y columnas de export en la lista

**Files:**
- Modify: `components/horas/BancosHorasClient.tsx` (viewRows mensual, marca CF, buildRows)
- Modify: `e2e/horas-bancos-carry.spec.ts` (test de la marca)

**Interfaces:**
- Consumes: `BancoHorasRow.inutilizables/carryNeto`, `BancoMensual.libres?/inutilizables?`, `BancoHorasProyecto.carryNeto` (Task 2).

- [ ] **Step 1: Agregar el test e2e de la marca (tolerante)**

Añadir al final de `e2e/horas-bancos-carry.spec.ts`:

```ts
test('la lista marca CF cuando hay carry forward', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()
  // Tolerante: solo exige la marca si el dato produce carry (sobrantes en meses cerrados).
  const marca = page.getByText('CF', { exact: true })
  if ((await marca.count()) > 0) await expect(marca.first()).toBeVisible()
})
```

- [ ] **Step 2: viewRows Mensual con carry de los meses elegidos**

En `BancosHorasClient.tsx`, reemplazar la rama mensual de `viewRows` (líneas 92-100) por:

```tsx
    return rows.map((r) => {
      let assigned = 0, consumed = 0, provisional = false, inutilizables = 0, libres = 0
      for (const m of r.monthly) {
        if (!selSet.has(m.month)) continue
        assigned += m.assigned; consumed += m.consumed
        inutilizables += m.inutilizables ?? 0; libres += m.libres ?? 0
        if (m.provisional) provisional = true
      }
      // En Mensual el restante/status del mes se mantienen crudos (el corte se ve en el
      // detalle); inutilizables/carryNeto llevan lo de los meses elegidos para el export.
      return { ...r, assigned, consumed, remaining: assigned - consumed, status: computeHorasStatus(assigned, consumed), provisional, inutilizables, carryNeto: libres }
    })
```

- [ ] **Step 3: Marca «CF» en la fila**

En el bloque de marcas de la fila (líneas 346-360), reemplazar el IIFE por:

```tsx
                    {(() => {
                      const marcaProv = vista === 'mensual'
                        ? g.monthly.some((m) => selSet.has(m.month) && m.provisional)
                        : g.monthly.some((m) => m.provisional)
                      const marcaCF = vista === 'mensual'
                        ? g.monthly.some((m) => selSet.has(m.month) && (m.libres ?? 0) > 0)
                        : g.carryNeto > 0
                      return (
                        <span className="flex w-32 shrink-0 items-center justify-end gap-1.5">
                          {marcaProv && (
                            <span className="rounded-full bg-(--brand)/10 px-1.5 py-px text-[0.62rem] font-medium text-(--brand)">Prov.</span>
                          )}
                          {marcaCF && (
                            <span title="Incluye horas libres de carry forward" className="rounded-full bg-(--status-disponible)/12 px-1.5 py-px text-[0.62rem] font-medium text-(--status-disponible)">CF</span>
                          )}
                          {vista === 'mensual' && g.assigned === 0 && g.consumed === 0 && !marcaProv
                            ? <span aria-label="Sin datos este mes" className="text-sm text-muted-foreground/50">—</span>
                            : <HorasStatusBadge status={g.status} />}
                        </span>
                      )
                    })()}
```

- [ ] **Step 4: Columnas de export**

En `buildRows()` (líneas 150-158), reemplazar la línea de `Consumido/Restante` por:

```tsx
      Consumido: r.consumed, Restante: r.remaining,
      Inutilizables: r.inutilizables, 'Libres (carry)': r.carryNeto,
      'Estado banco': HORAS_STATUS_LABELS[r.status],
```

- [ ] **Step 5: Typecheck + e2e completos de bancos**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npx playwright test horas-bancos --project=chromium-horas-admin --reporter=list`
Expected: PASS (los specs `horas-bancos*` completos: lista, detalle, ampliar, carry).

- [ ] **Step 6: Commit**

```bash
git add components/horas/BancosHorasClient.tsx e2e/horas-bancos-carry.spec.ts
git commit -m "feat(bancos): marca CF en la lista + columnas Inutilizables/Libres en el export"
```

---

## Self-Review

**1. Spec coverage:**
- Fórmula del corte (25/75, sobrante con piso 0, exceso, mes en curso intacto, sin distinción de origen) → Task 1 `carrySplit`. ✓
- Tabla de referencia como fixture canónica → Task 1 tests (15/5/2 + abril 6/2). ✓
- Por posición, proyecto agrega → Task 2 (rows por posición, `groupBancosByProject`, detalle Σ posiciones). ✓
- Disponible real y status con cifras efectivas (lista, detalle, aviso al registrar vía `getBancosHoras`) → Task 2. ✓
- Distinción normales vs carry siempre visible → Task 3 KPI (desglose `del mes · carry forward · inutilizables`). ✓
- Charts shadcn stacked por posición, tokens de la app, mes en curso sin corte, marca provisional → Task 3 (`·prov` en la etiqueta del mes). ✓
- Marca «CF» (Total: `carryNeto > 0`; Mensual: mes elegido con `libres > 0`) → Task 4. ✓
- CSV `Inutilizables` + `Libres (carry)` → Task 4. ✓
- Borde "mes en curso sobre-consumido" (piso 0 en el desglose, cifra grande = verdad) → Task 3 Step 5 (`normalMostrado`/`carryMostrado` con `Math.max`). ✓
- Alertas Slack fuera de alcance (spec corregida) → sin task, correcto. ✓
- Ledger de Movimientos sin cambios → ningún task lo toca. ✓

**2. Placeholder scan:** sin TBD/TODO; todos los pasos con código completo. El único paso no determinista es `npx shadcn@latest add chart --yes` (genera `components/ui/chart.tsx`); su verificación es tsc. ✓

**3. Type consistency:**
- `carrySplit(monthly, mesActual)` → `{ porMes: CarryMes[]; totales: CarryTotales }` usado idéntico en Tasks 2. ✓
- Campos `inutilizables`/`carryNeto` (Row/Detalle/Proyecto) y `libres?/inutilizables?` (Mensual) consistentes en Tasks 2-4. ✓
- `CarryForwardCharts({ posiciones: BancoHorasRow[] })` default export, importado así en Task 3 Step 5. ✓
- `mesCorto`/`currentMonth`/`formatHoras` existen en `lib/horas/format.ts` (verificado). ✓

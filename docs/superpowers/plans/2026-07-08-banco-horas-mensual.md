# Banco de Horas: Vista Mensual/Total — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch Total|Mensual en la lista y el detalle del banco de horas, alimentado por la nueva columna `Fecha` del Excel (una fila = asignación de un proyecto en un mes).

**Architecture:** El lector de Graph agrupa las filas del Excel por (proyecto, mes) y expone totales (Σ de todas las filas — los consumidores actuales no cambian) más el desglose mensual. `getBancosHoras`/`getBancoHorasDetalle` agregan también el consumo por mes (en Node, enfoque A del spec). El cliente recibe todo y el switch + selector de mes son estado local (como los filtros existentes). Spec: `docs/superpowers/specs/2026-07-08-banco-horas-mensual-design.md`.

**Tech Stack:** Next.js App Router (RSC + client components), TypeScript, Supabase (supabase-js), Microsoft Graph (Excel), Tailwind v4 + shadcn/ui, Playwright.

## Global Constraints

- **UI**: seguir la identidad visual existente (tokens `--brand`, `--muted-surface`, `--status-*`; tipografía `font-display`; componentes de `components/ui`). Copy en español, sentence case, mismos términos que la UI actual ("Asignado", "Consumido", "Restante").
- **Dev server**: lo gestiona el usuario; **nunca** arrancarlo ni pararlo. Playwright no lo auto-lanza. Si `http://localhost:3000` no responde, saltar los pasos de e2e y dejarlos anotados.
- **Sin framework de unit tests** (spec §9): la puerta de calidad por tarea es `npx tsc --noEmit` + e2e (Tarea 5) + verificación manual final.
- **Arrastre de saldo entre meses: FUERA DE ALCANCE.** Cada mes se compara contra sí mismo.
- Mes = string `'YYYY-MM'` en todo el código. Mes "sin fecha" = string vacío `''` (solo interno del lector; nunca llega a la UI).
- Commits frecuentes, mensajes en español estilo repo (`feat(bancos): …`), con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Lector del Excel — columna Fecha y desglose mensual

**Files:**
- Modify: `lib/types.ts:24-33`
- Modify: `lib/graph/client.ts` (función `readBancoHorasTable`, líneas 58-108; mover `norm` y `excelDateToISO` a nivel de módulo)

**Interfaces:**
- Consumes: nada nuevo (Graph API existente).
- Produces: `BancoHorasProyecto` (en `lib/types.ts`) con campo nuevo `months: BancoMes[]`, donde `BancoMes = { month: string; positions: BancoPosicion[] }`, orden ascendente por mes. `positions` (totales) pasa a ser la **suma** de todas las filas del proyecto (antes: primera aparición gana). Tareas 2-4 dependen de esta forma exacta.

- [ ] **Step 1: Tipos en `lib/types.ts`**

Reemplazar el bloque de líneas 24-33 por:

```ts
// Banco de horas por POSICIÓN: cada columna del Excel (CRM, SEO, Growth Strategists…)
// es una posición con sus horas asignadas por proyecto.
export interface BancoPosicion {
  position: string
  hours: number
}
// Asignación de un mes concreto (fila del Excel con columna Fecha).
export interface BancoMes {
  month: string // 'YYYY-MM'
  positions: BancoPosicion[]
}
export interface BancoHorasProyecto {
  project: string
  positions: BancoPosicion[] // totales = Σ de todas las filas (incluye filas sin fecha)
  months: BancoMes[] // orden ascendente; las filas sin fecha NO aparecen en ningún mes
}
```

- [ ] **Step 2: Hoist de helpers en `lib/graph/client.ts`**

`excelDateToISO` (líneas 139-148) y el normalizador de cabeceras `norm` (línea 169, hoy local a `readClientesProyectosSheet`) se necesitan en `readBancoHorasTable`, que está antes en el archivo. Moverlos a nivel de módulo, justo después de `encodeShareUrl` (línea 9):

```ts
// Normaliza nombres de cabecera: minúsculas y sin acentos (casa "Fecha", "Fecha Auditoría"…).
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Celda de fecha del Excel → ISO "YYYY-MM-DD". Acepta serial numérico o texto
// tipo "12/31/2023". Vacío si no hay fecha o no se puede interpretar.
function excelDateToISO(cell: unknown): string {
  if (cell == null || cell === '') return ''
  if (typeof cell === 'number') {
    const ms = Math.round((cell - 25569) * 86400000) // 25569 = días de 1899-12-30 a 1970-01-01
    const d = new Date(ms)
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  }
  const t = Date.parse(String(cell).trim())
  return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10)
}
```

Borrar las copias originales (la definición de `excelDateToISO` en 139-148 y la const `norm` dentro de `readClientesProyectosSheet`; en esa función usar el `norm` de módulo — mismo nombre, sin más cambios). Ojo: la regex original del repo usa los caracteres combinantes literales (`[̀-ͯ]`); al moverla, escribirla como `[̀-ͯ]` (equivalente y sin caracteres invisibles).

- [ ] **Step 3: Reescribir el cuerpo de `readBancoHorasTable`**

Reemplazar desde `const header = …` (línea 79) hasta el `return` (línea 107) por:

```ts
  const header = (await headerRes.json() as { values: unknown[][] }).values[0] ?? []
  // Columna "Fecha" (opcional, case/acentos-insensitive): mes de la asignación.
  // El resto de columnas 1..n son posiciones. Col 0 = proyecto.
  const fechaIdx = header.findIndex((h) => norm(h) === 'fecha')
  const posCols = header
    .map((h, col) => ({ position: String(h ?? '').trim(), col }))
    .filter((c) => c.col !== 0 && c.col !== fechaIdx && c.position !== '')
  const rows = (await rowsRes.json() as { value: Array<{ values: unknown[][] }> }).value

  // project → month ('' = sin fecha) → position → hours.
  // Dentro de un mismo (proyecto, mes), fila/columna repetida = bug de datos:
  // la primera aparición gana (misma política defensiva que antes por proyecto).
  const byProject = new Map<string, Map<string, Map<string, number>>>()
  for (const row of rows) {
    const cells = row.values[0]
    const project = String(cells[0] ?? '').trim()
    if (project === '') continue
    const month = fechaIdx === -1 ? '' : excelDateToISO(cells[fechaIdx]).slice(0, 7)
    if (fechaIdx !== -1 && month === '') {
      // Error de datos (spec §6): cuenta en totales, no aparece en ningún mes.
      console.warn(`[banco-horas] fila sin fecha válida en el Excel: "${project}"`)
    }
    let months = byProject.get(project)
    if (!months) { months = new Map(); byProject.set(project, months) }
    let bucket = months.get(month)
    if (!bucket) { bucket = new Map(); months.set(month, bucket) }
    for (const { position, col } of posCols) {
      const hours = Number(cells[col] ?? 0)
      if (isNaN(hours)) continue
      if (!bucket.has(position)) bucket.set(position, hours)
    }
  }

  // Totales por posición = Σ de todos los meses (incluida la clave '' sin fecha).
  const result: BancoHorasProyecto[] = []
  for (const [project, months] of byProject) {
    const totals = new Map<string, number>()
    for (const bucket of months.values()) {
      for (const [position, hours] of bucket) totals.set(position, (totals.get(position) ?? 0) + hours)
    }
    const monthList = [...months.entries()]
      .filter(([month]) => month !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, bucket]) => ({
        month,
        positions: [...bucket.entries()].map(([position, hours]) => ({ position, hours })),
      }))
    result.push({
      project,
      positions: [...totals.entries()].map(([position, hours]) => ({ position, hours })),
      months: monthList,
    })
  }
  return result
```

Nota semántica (deliberada, spec §4.1): antes dos filas del mismo proyecto se consolidaban con "la primera gana"; ahora filas en **meses distintos** son legítimas y **suman** en el total. "La primera gana" se conserva solo dentro del mismo (proyecto, mes).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores. (Los consumidores de `positions` — alertas, registrar, reportes, bancos — no cambian: el campo conserva nombre y tipo.)

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/graph/client.ts
git commit -m "feat(bancos): lector del Excel con columna Fecha y desglose mensual"
```

---

### Task 2: Agregación mensual en servidor (lista y detalle)

**Files:**
- Modify: `lib/horas/bancos-status.ts` (tipos `BancoHorasRow`, `BancoHorasDetalle`, `BancoHorasProyecto`, función `groupBancosByProject`)
- Modify: `lib/horas/bancos.ts` (`getBancosHoras`, `getBancoHorasDetalle`)

**Interfaces:**
- Consumes: `BancoHorasProyecto.months` de Task 1 (`{ month, positions: { position, hours }[] }[]`).
- Produces (los componentes de Tasks 3-4 dependen de esto, exacto):
  - `BancoMensual = { month: string; assigned: number; consumed: number }` exportado de `lib/horas/bancos-status.ts`.
  - `BancoHorasRow.monthly: BancoMensual[]` (orden ascendente por mes; presente en lista Y detalle).
  - `BancoHorasProyecto.monthly: BancoMensual[]` (agregado por `groupBancosByProject`).
  - `BancoDetalleMensual = { month: string; excelAssigned: number; ampliado: number; consumed: number }` y `BancoHorasDetalle.monthly: BancoDetalleMensual[]`.

- [ ] **Step 1: Tipos en `lib/horas/bancos-status.ts`**

Después de `HorasStatus` (línea 3) añadir:

```ts
// Cifras de un mes para una fila del banco (asignado Excel vs consumido del mes).
export interface BancoMensual {
  month: string // 'YYYY-MM'
  assigned: number
  consumed: number
}
```

En `BancoHorasRow` (líneas 5-15) añadir el campo:

```ts
  monthly: BancoMensual[] // desglose mensual (ascendente); [] si no hay datos por mes
```

En `BancoHorasDetalle` (líneas 39-49) añadir:

```ts
  monthly: BancoDetalleMensual[] // cifras del proyecto por mes (ascendente)
```

y encima de `BancoHorasDetalle` definir:

```ts
// Cifras mensuales del proyecto en el detalle: asignado Excel del mes + ampliaciones
// del mes (a nivel proyecto, spec §4.3) frente al consumido del mes.
export interface BancoDetalleMensual {
  month: string // 'YYYY-MM'
  excelAssigned: number
  ampliado: number // Σ ampliaciones ACTIVAS con entry_date en ese mes
  consumed: number
}
```

En `BancoHorasProyecto` (líneas 85-95) añadir `monthly: BancoMensual[]`.

- [ ] **Step 2: `groupBancosByProject` agrega lo mensual**

En la creación del grupo (línea 115) inicializar `monthly: []`; tras el bucle de filas, fusionar. Cuerpo completo nuevo:

```ts
export function groupBancosByProject(rows: BancoHorasRow[]): BancoHorasProyecto[] {
  const map = new Map<string, BancoHorasProyecto>()
  for (const r of rows) {
    let g = map.get(r.project)
    if (!g) {
      g = { project: r.project, projectEstado: r.projectEstado, manager: r.manager, fechaAuditoria: r.fechaAuditoria, positions: [], assigned: 0, consumed: 0, remaining: 0, status: 'sin_asignacion', monthly: [] }
      map.set(r.project, g)
    }
    g.positions.push(r)
    g.assigned += r.assigned
    g.consumed += r.consumed
  }
  for (const g of map.values()) {
    g.remaining = g.assigned - g.consumed
    g.status = computeHorasStatus(g.assigned, g.consumed)
    g.positions.sort((a, b) => a.position.localeCompare(b.position))
    // Mensual del proyecto = suma de lo mensual de sus posiciones.
    const byMonth = new Map<string, BancoMensual>()
    for (const p of g.positions) {
      for (const m of p.monthly) {
        const acc = byMonth.get(m.month) ?? { month: m.month, assigned: 0, consumed: 0 }
        acc.assigned += m.assigned
        acc.consumed += m.consumed
        byMonth.set(m.month, acc)
      }
    }
    g.monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
  }
  return [...map.values()]
}
```

- [ ] **Step 3: `getBancosHoras` — consumo por mes**

En `lib/horas/bancos.ts`:

a) Importar el tipo del Excel y usarlo (línea 52): cambiar

```ts
  let excel: { project: string; positions: { position: string; hours: number }[] }[] = []
```

por

```ts
  let excel: BancoHorasProyecto[] = []
```

añadiendo arriba `import type { BancoHorasProyecto } from '@/lib/types'` y `type BancoMensual` al import de `bancos-status`.

b) La query de líneas (línea 62) incorpora la fecha:

```ts
    .select('project, hours, time_logs!inner(status, user_id, entry_date)')
```

y el tipo del cast en el bucle (línea 78) pasa a `{ project: string; hours: number; time_logs: { user_id: string; entry_date: string } }[]`.

c) Junto al mapa `consumed` (línea 77), acumular también por mes:

```ts
  const consumed = new Map<string, number>()
  const consumedMes = new Map<string, Map<string, number>>() // key(project, position) → mes → horas
  for (const l of (lines ?? []) as unknown as { project: string; hours: number; time_logs: { user_id: string; entry_date: string } }[]) {
    if (l.project.trim() === 'Departamento') continue // horas internas: no consumen banco
    const position = userPosition.get(l.time_logs.user_id)
    if (!position) continue // usuario sin posición: no se atribuye a ningún banco
    const k = key(l.project.trim(), position)
    consumed.set(k, (consumed.get(k) ?? 0) + Number(l.hours))
    const month = l.time_logs.entry_date.slice(0, 7)
    let porMes = consumedMes.get(k)
    if (!porMes) { porMes = new Map(); consumedMes.set(k, porMes) }
    porMes.set(month, (porMes.get(month) ?? 0) + Number(l.hours))
  }
```

d) Al construir cada fila (bucle de línea 87), calcular `monthly` como unión de meses del Excel (para esa posición) y meses con consumo:

```ts
  const rows: BancoHorasRow[] = []
  for (const proj of excel) {
    const project = proj.project.trim()
    if (project === 'Departamento') continue // proyecto interno: sin banco
    for (const { position, hours } of proj.positions) {
      if (!visible(allowed, position)) continue
      const assigned = Number(hours)
      const k = key(project, position)
      const cons = consumed.get(k) ?? 0
      if (assigned === 0 && cons === 0) continue // banco vacío: no lo listamos
      const meta = metaByProject.get(project)

      // Desglose mensual: Excel del mes ∪ consumo del mes (spec §4.2).
      const byMonth = new Map<string, BancoMensual>()
      for (const m of proj.months) {
        const h = m.positions.find((p) => p.position === position)?.hours ?? 0
        if (h !== 0) byMonth.set(m.month, { month: m.month, assigned: h, consumed: 0 })
      }
      for (const [month, h] of consumedMes.get(k) ?? []) {
        const acc = byMonth.get(month) ?? { month, assigned: 0, consumed: 0 }
        acc.consumed += h
        byMonth.set(month, acc)
      }
      const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))

      rows.push({
        project, position, assigned, consumed: cons,
        remaining: assigned - cons,
        status: computeHorasStatus(assigned, cons),
        monthly,
        projectEstado: meta?.estado,
        manager: meta?.manager,
        fechaAuditoria: meta?.fechaAuditoria,
      })
    }
  }
```

- [ ] **Step 4: `getBancoHorasDetalle` — mensual por posición y por proyecto**

a) Guardar también los meses del Excel del proyecto (líneas 117-123):

```ts
  let posicionesExcel: { position: string; hours: number }[] = []
  let mesesExcel: BancoHorasProyecto['months'] = []
  try {
    const excel = await getCachedBancoHoras()
    const proj = excel.find((e) => e.project.trim() === name)
    posicionesExcel = proj?.positions ?? []
    mesesExcel = proj?.months ?? []
  } catch {
    posicionesExcel = []
  }
```

b) Consumo por posición y mes (junto a `consumedByPos`, líneas 148-153):

```ts
  const consumedByPos = new Map<string, number>()
  const consumedByPosMes = new Map<string, Map<string, number>>() // posición → mes → horas
  for (const l of rawLines) {
    const position = userPosition.get(l.time_logs.user_id)
    if (!position || !visible(allowed, position)) continue
    consumedByPos.set(position, (consumedByPos.get(position) ?? 0) + Number(l.hours))
    const month = l.time_logs.entry_date.slice(0, 7)
    let porMes = consumedByPosMes.get(position)
    if (!porMes) { porMes = new Map(); consumedByPosMes.set(position, porMes) }
    porMes.set(month, (porMes.get(month) ?? 0) + Number(l.hours))
  }
```

c) Cada fila de `posiciones` (map de línea 162) añade `monthly` (misma unión que en la lista):

```ts
  const posiciones: BancoHorasRow[] = [...posNames]
    .map((position) => {
      const assigned = excelByPos.get(position) ?? 0
      const consumed = consumedByPos.get(position) ?? 0
      const byMonth = new Map<string, BancoMensual>()
      for (const m of mesesExcel) {
        const h = m.positions.find((p) => p.position === position)?.hours ?? 0
        if (h !== 0) byMonth.set(m.month, { month: m.month, assigned: h, consumed: 0 })
      }
      for (const [month, h] of consumedByPosMes.get(position) ?? []) {
        const acc = byMonth.get(month) ?? { month, assigned: 0, consumed: 0 }
        acc.consumed += h
        byMonth.set(month, acc)
      }
      const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
      return { project: name, position, assigned, consumed, remaining: assigned - consumed, status: computeHorasStatus(assigned, consumed), monthly }
    })
    .sort((a, b) => HORAS_SEVERITY[a.status] - HORAS_SEVERITY[b.status] || a.position.localeCompare(b.position))
```

d) Mensual a nivel proyecto (después de calcular `ampliaciones`, línea 174). Meses = unión de: meses de `posiciones[].monthly` (ya visibles/acotadas) ∪ meses de ampliaciones activas:

```ts
  // Cifras del proyecto por mes: Excel visible + ampliaciones del mes (spec §4.3).
  const detalleByMonth = new Map<string, BancoDetalleMensual>()
  const monthEntry = (month: string) => {
    let e = detalleByMonth.get(month)
    if (!e) { e = { month, excelAssigned: 0, ampliado: 0, consumed: 0 }; detalleByMonth.set(month, e) }
    return e
  }
  for (const p of posiciones) {
    for (const m of p.monthly) {
      const e = monthEntry(m.month)
      e.excelAssigned += m.assigned
      e.consumed += m.consumed
    }
  }
  for (const a of ampliaciones) {
    if (!a.active) continue
    monthEntry(a.entry_date.slice(0, 7)).ampliado += Number(a.hours)
  }
  const monthly = [...detalleByMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
```

y añadir `monthly` al objeto del `return` (línea 184). Importar `BancoDetalleMensual` y `BancoMensual` del import de `bancos-status` (línea 3).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores (los dos únicos constructores de `BancoHorasRow` ya rellenan `monthly`).

- [ ] **Step 6: Commit**

```bash
git add lib/horas/bancos-status.ts lib/horas/bancos.ts
git commit -m "feat(bancos): agregación mensual de asignado y consumido (lista y detalle)"
```

---

### Task 3: UI de la lista — switch Total|Mensual y selector de mes

**Files:**
- Modify: `lib/horas/format.ts` (helpers de mes)
- Modify: `components/horas/BancosHorasClient.tsx`

**Interfaces:**
- Consumes: `BancoHorasRow.monthly: BancoMensual[]` y `BancoHorasProyecto.monthly` (Task 2); `computeHorasStatus` existente.
- Produces: helpers exportados en `lib/horas/format.ts` que Task 4 reutiliza: `formatMes(month: string): string` ("Julio 2026"), `currentMonth(): string`, `addMonths(month: string, delta: number): string`.

- [ ] **Step 1: Helpers de mes en `lib/horas/format.ts`**

Añadir al final:

```ts
// 'YYYY-MM' → "Julio 2026" (es-ES, inicial mayúscula). Si no es un mes válido,
// devuelve la entrada tal cual. timeZone UTC para no deslizarse de mes.
const MES = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function formatMes(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  const label = MES.format(new Date(Date.UTC(y, m - 1, 1)))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Mes actual como 'YYYY-MM'.
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

// Suma delta meses a un 'YYYY-MM' (delta puede ser negativo).
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
}
```

- [ ] **Step 2: Estado de vista y filas derivadas en `BancosHorasClient.tsx`**

a) Imports: añadir `ChevronLeft` a los de `lucide-react` (línea 5); `computeHorasStatus` al import de `bancos-status` (línea 7); `formatMes, currentMonth, addMonths` al import de `format` (línea 9).

b) Estado nuevo (junto a los filtros, línea 41):

```ts
  const [vista, setVista] = useState<'total' | 'mensual'>('total')
  const [mes, setMes] = useState(() => currentMonth())
```

c) Meses disponibles y filas según la vista (antes del memo `filtered`):

```ts
  // Meses con datos (Excel o consumo) en cualquier fila. Si el Excel aún no tiene
  // la columna Fecha, no hay meses y el switch Mensual no se muestra.
  const meses = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) for (const m of r.monthly) s.add(m.month)
    return [...s].sort()
  }, [rows])
  const hayMensual = meses.length > 0
  const minMes = meses[0] ?? currentMonth()
  const maxMes = meses.length > 0 && meses[meses.length - 1] > currentMonth() ? meses[meses.length - 1] : currentMonth()

  // En Mensual, cada fila muestra las cifras del mes elegido (0/0 si no tiene datos:
  // decisión de producto — el proyecto se ve en cero, no desaparece).
  const viewRows = useMemo(() => {
    if (vista === 'total') return rows
    return rows.map((r) => {
      const m = r.monthly.find((x) => x.month === mes)
      const assigned = m?.assigned ?? 0
      const consumed = m?.consumed ?? 0
      return { ...r, assigned, consumed, remaining: assigned - consumed, status: computeHorasStatus(assigned, consumed) }
    })
  }, [rows, vista, mes])
```

d) El pipeline existente pasa a leer de `viewRows`: en el memo `filtered` (línea 55) cambiar `rows.filter` por `viewRows.filter` y la dependencia `[rows, …]` por `[viewRows, …]`. Los memos `positions`/`managers`/`hasSinManager` se quedan sobre `rows` (los catálogos de filtro no dependen del mes). `groups`, `totals` y el export ya derivan de `filtered` — no se tocan.

e) El nombre del archivo de descarga refleja la vista (línea 98):

```ts
  const fileBase = `bancos-horas${vista === 'mensual' ? `-${mes}` : ''}${estado === 'todos' ? '' : `-${estado}`}`
```

- [ ] **Step 3: Switch y selector de mes (JSX)**

Encima del bloque de filtros (antes de `{/* Buscar + resumen */}`, línea 122), dentro del `div.space-y-3.5`:

```tsx
        {/* Vista Total | Mensual (spec §5.1). Solo si el Excel ya trae meses. */}
        {hayMensual && (
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Vista del banco" className="inline-flex rounded-lg bg-(--muted-surface) p-0.5">
              {(['total', 'mensual'] as const).map((v) => (
                <button
                  key={v} type="button" onClick={() => setVista(v)} aria-pressed={vista === v}
                  className={cn(
                    'rounded-md px-3.5 py-1.5 text-sm transition-colors',
                    vista === v ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v === 'total' ? 'Total' : 'Mensual'}
                </button>
              ))}
            </div>
            {vista === 'mensual' && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button" aria-label="Mes anterior" disabled={mes <= minMes}
                  onClick={() => setMes((m) => addMonths(m, -1))}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-(--brand) disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="min-w-30 text-center text-sm font-medium text-foreground">{formatMes(mes)}</span>
                <button
                  type="button" aria-label="Mes siguiente" disabled={mes >= maxMes}
                  onClick={() => setMes((m) => addMonths(m, 1))}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-(--brand) disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </div>
        )}
```

`ChevronRight` ya está importado. En la fila del proyecto, el badge de estado (línea 248) muestra guión neutro para 0/0 en Mensual (spec §5.1):

```tsx
                    <span className="w-28 shrink-0 text-right">
                      {vista === 'mensual' && g.assigned === 0 && g.consumed === 0
                        ? <span aria-label="Sin datos este mes" className="text-sm text-muted-foreground/50">—</span>
                        : <HorasStatusBadge status={g.status} />}
                    </span>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/horas/format.ts components/horas/BancosHorasClient.tsx
git commit -m "feat(bancos): switch Total|Mensual con selector de mes en la lista"
```

---

### Task 4: UI del detalle — mismo switch, cifras y tablas del mes

**Files:**
- Create: `components/horas/BancoDetalleView.tsx` (client component: tarjetas + Por posición + Ampliaciones + Movimientos, con el switch)
- Modify: `app/(horas)/bancos/[project]/page.tsx` (queda: auth, fetch, header, AmpliarHorasForm; delega el resto)

**Interfaces:**
- Consumes: `BancoHorasDetalle` con `monthly: BancoDetalleMensual[]` y `posiciones[].monthly` (Task 2); helpers `formatMes/currentMonth/addMonths` (Task 3).
- Produces: `export default function BancoDetalleView({ d, isAdmin }: { d: BancoHorasDetalle; isAdmin: boolean })`.

- [ ] **Step 1: Crear `components/horas/BancoDetalleView.tsx`**

Client component que absorbe las secciones de la página actual (líneas 61-199 de `page.tsx`) sin cambios visuales en modo Total, y añade el switch. Esqueleto completo (el JSX de las tablas se copia de `page.tsx` tal cual, con las sustituciones indicadas):

```tsx
'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BancoHorasDetalle } from '@/lib/horas/bancos-status'
import { computeHorasStatus, HORAS_BAR_COLOR } from '@/lib/horas/bancos-status'
import { formatHoras, formatMes, currentMonth, addMonths } from '@/lib/horas/format'
import { cn } from '@/lib/utils'
import HorasStatusBadge from '@/components/horas/HorasStatusBadge'
import AnularAmpliacionButton from '@/components/horas/AnularAmpliacionButton'

export default function BancoDetalleView({ d, isAdmin }: { d: BancoHorasDetalle; isAdmin: boolean }) {
  const [vista, setVista] = useState<'total' | 'mensual'>('total')
  const [mes, setMes] = useState(() => currentMonth())

  const meses = useMemo(() => d.monthly.map((m) => m.month), [d.monthly])
  const hayMensual = meses.length > 0
  const minMes = meses[0] ?? currentMonth()
  const maxMes = meses.length > 0 && meses[meses.length - 1] > currentMonth() ? meses[meses.length - 1] : currentMonth()
  const esMensual = vista === 'mensual'

  // Cifras de cabecera: total (como hoy) o las del mes elegido (Excel + ampliaciones del mes).
  const mm = d.monthly.find((m) => m.month === mes)
  const cab = esMensual
    ? { assigned: (mm?.excelAssigned ?? 0) + (mm?.ampliado ?? 0), excelBase: mm?.excelAssigned ?? 0, ampliado: mm?.ampliado ?? 0, consumed: mm?.consumed ?? 0 }
    : { assigned: d.assigned, excelBase: d.excelBase, ampliado: d.assigned - d.excelBase, consumed: d.consumed }
  const restante = cab.assigned - cab.consumed

  // Posiciones: en Mensual cada fila muestra su mes (0/0 se ve en cero, estado neutro '—').
  const posiciones = useMemo(() => {
    if (!esMensual) return d.posiciones
    return d.posiciones.map((p) => {
      const m = p.monthly.find((x) => x.month === mes)
      const assigned = m?.assigned ?? 0
      const consumed = m?.consumed ?? 0
      return { ...p, assigned, consumed, remaining: assigned - consumed, status: computeHorasStatus(assigned, consumed) }
    })
  }, [d.posiciones, esMensual, mes])

  // Ampliaciones y movimientos: en Mensual, solo los del mes elegido.
  const ampliaciones = esMensual ? d.ampliaciones.filter((a) => a.entry_date.slice(0, 7) === mes) : d.ampliaciones
  const movimientos = esMensual ? d.movimientos.filter((m) => m.date.slice(0, 7) === mes) : d.movimientos

  return (
    <div>
      {/* …switch + selector (mismo bloque JSX que en BancosHorasClient, Task 3 Step 3,
          usando vista/setVista/mes/setMes/minMes/maxMes/hayMensual de aquí)… */}
      {/* …tarjetas Asignado/Consumido/Restante: copiar de page.tsx líneas 61-79
          sustituyendo d.assigned→cab.assigned, d.excelBase→cab.excelBase,
          ampliado→cab.ampliado, d.consumed→cab.consumed, d.remaining→restante… */}
      {/* …sección "Por posición": copiar de page.tsx líneas 81-118 sustituyendo
          d.posiciones→posiciones; en la celda de estado, si esMensual && p.assigned === 0
          && p.consumed === 0 renderizar <span className="text-sm text-muted-foreground/50">—</span>
          en vez del badge… */}
      {/* …sección "Ampliaciones": copiar de page.tsx líneas 120-154 sustituyendo
          d.ampliaciones→ampliaciones; el mensaje vacío en Mensual es
          "Sin ampliaciones en {formatMes(mes)}."… */}
      {/* …sección "Movimientos": copiar de page.tsx líneas 156-199 sustituyendo
          d.movimientos→movimientos; el mensaje vacío en Mensual es
          "Sin movimientos en {formatMes(mes)}." Nota: el saldo antes/después es el
          acumulado histórico del banco total (los movimientos solo se FILTRAN)… */}
    </div>
  )
}
```

Los comentarios `{/* … */}` de arriba son instrucciones de copia para el implementador, NO van en el archivo final: el archivo final contiene el JSX completo copiado de `page.tsx` con esas sustituciones. `AnularAmpliacionButton` necesita `project`: usar `d.project`. `AmpliarHorasForm` se queda en la página (fuera del switch).

- [ ] **Step 2: Adelgazar `app/(horas)/bancos/[project]/page.tsx`**

La página conserva: imports de auth/datos/header, `getBancoHorasDetalle`, redirects, el `<header>` (líneas 39-57), y el bloque `{isAdmin && <AmpliarHorasForm …/>}` (línea 59). Todo lo demás (líneas 61-199) se reemplaza por:

```tsx
      <BancoDetalleView d={d} isAdmin={isAdmin} />
```

con `import BancoDetalleView from '@/components/horas/BancoDetalleView'`. Quitar los imports que quedan sin uso en la página (`formatHoras`, `HORAS_BAR_COLOR`, `AnularAmpliacionButton`, `cn` si ya no se usa — comprobar `estadoProyectoBadgeClass` que SÍ se usa en el header).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add components/horas/BancoDetalleView.tsx "app/(horas)/bancos/[project]/page.tsx"
git commit -m "feat(bancos): detalle con switch Total|Mensual (posiciones, ampliaciones y movimientos del mes)"
```

---

### Task 5: e2e — flujo del switch en lista y detalle

**Files:**
- Modify: `e2e/horas-bancos.spec.ts`
- Modify: `e2e/detalle.spec.ts` (solo si cubre el detalle de bancos; si no, añadir el caso al spec de bancos)

**Interfaces:**
- Consumes: UI de Tasks 3-4 (nombres accesibles exactos: botones "Mensual", "Total", "Mes anterior", "Mes siguiente"; group "Vista del banco").

**Contexto para el implementador:** la suite corre contra `http://localhost:3000` con datos vivos (Supabase seedeado por `global-setup.ts`, Excel real de Graph). El dev server lo gestiona el usuario: si el puerto 3000 no responde, dejar los specs escritos, saltar la ejecución y anotarlo. El switch Mensual **solo se renderiza si el Excel ya tiene la columna Fecha con datos** — el spec debe tolerar ambos estados del Excel.

- [ ] **Step 1: Corregir aserciones desactualizadas del spec de bancos**

En `e2e/horas-bancos.spec.ts` la UI actual renderiza `"N proyectos · M bancos"` y el vacío dice `"No hay bancos que coincidan con los filtros."` (ver `BancosHorasClient.tsx:131-135` y `:200`). Actualizar:

```ts
  // antes: await expect(page.getByText(/de \d+ proyectos/)).toBeVisible()
  await expect(page.getByText(/\d+ proyectos?/)).toBeVisible()
  // antes: 'No hay proyectos que coincidan con los filtros.'
  await expect(page.getByText('No hay bancos que coincidan con los filtros.')).toBeVisible()
```

- [ ] **Step 2: Caso nuevo — switch mensual en la lista**

Añadir al final de `e2e/horas-bancos.spec.ts`:

```ts
test('el switch Mensual muestra el mes en curso y navega meses', async ({ page }) => {
  await page.goto('/bancos')
  await expect(page.getByRole('heading', { name: 'Bancos de horas' })).toBeVisible()

  const mensual = page.getByRole('button', { name: 'Mensual' })
  if (!(await mensual.isVisible().catch(() => false))) {
    // El Excel aún no tiene la columna Fecha: la vista Total es la única y no hay switch.
    test.info().annotations.push({ type: 'skip-reason', description: 'Excel sin columna Fecha: switch Mensual oculto' })
    return
  }

  await mensual.click()
  // Selector con el mes en curso (formato "Julio 2026").
  const mesActual = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date())
  const label = mesActual.charAt(0).toUpperCase() + mesActual.slice(1)
  await expect(page.getByText(label)).toBeVisible()

  // Navegar al mes anterior y volver.
  const prev = page.getByRole('button', { name: 'Mes anterior' })
  if (await prev.isEnabled()) {
    await prev.click()
    await expect(page.getByText(label)).toHaveCount(0)
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
    await expect(page.getByText(label)).toBeVisible()
  }

  // Volver a Total: el selector de mes desaparece.
  await page.getByRole('button', { name: 'Total' }).click()
  await expect(page.getByRole('button', { name: 'Mes anterior' })).toHaveCount(0)
})
```

- [ ] **Step 3: Caso nuevo — switch en el detalle**

En el spec que cubra el detalle de bancos (si `e2e/detalle.spec.ts` es de HUCHA, añadirlo en `horas-bancos.spec.ts`):

```ts
test('el detalle del banco alterna Total y Mensual', async ({ page }) => {
  await page.goto('/bancos')
  const primera = page.locator('a[href^="/bancos/"]').first()
  if (!(await primera.isVisible().catch(() => false))) return // sin proyectos visibles
  await primera.click()
  await expect(page.getByText('Asignado')).toBeVisible()

  const mensual = page.getByRole('button', { name: 'Mensual' })
  if (!(await mensual.isVisible().catch(() => false))) return // Excel sin columna Fecha
  await mensual.click()
  await expect(page.getByRole('button', { name: 'Mes anterior' })).toBeVisible()
  await expect(page.getByText('Por posición')).toBeVisible()
})
```

- [ ] **Step 4: Ejecutar (solo si el dev server está arriba)**

Comprobar: `Test-NetConnection localhost -Port 3000 -InformationLevel Quiet`
Si responde: `npx playwright test horas-bancos --project=chromium` (usar el project que la config defina; comprobar `playwright.config.ts`).
Expected: specs de bancos en verde. Si el puerto no responde: anotar en el commit que quedan pendientes de ejecutar.

- [ ] **Step 5: Commit**

```bash
git add e2e/horas-bancos.spec.ts
git commit -m "test(bancos): e2e del switch Total|Mensual en lista y detalle"
```

---

### Verificación final (tras Task 5)

- [ ] `npx tsc --noEmit` limpio.
- [ ] Con el dev server del usuario arriba: `/bancos` muestra el switch (si el Excel ya tiene Fecha), las cifras cambian al alternar, el mes navega, un proyecto sin datos del mes se ve en cero con "—", y el detalle alterna sus tarjetas/tablas. Usar el skill `verify` para recorrer el flujo real.
- [ ] Confirmar que alertas (`/api` de alertas), registrar (combo de proyectos) y reportes siguen mostrando lo mismo que antes (usan totales).
- [ ] Los e2e que quedaron pendientes por servidor caído se ejecutan y quedan en verde.

# Editar registros ajenos (admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el admin pueda editar y anular registros de horas de otras personas para corregir errores, desde la vista `/equipo`.

**Architecture:** Feature 100% frontend. El backend ya lo soporta: `guardar_registro` (edición, migración 0019) y `anular_registro_diario` (migración 0017) dejan al admin operar sobre cualquier registro y escriben auditoría; la RLS deja al admin leer cualquier `time_log`. Se agrega la interfaz (acciones + buscador/filtros en `/equipo`) y se ajusta que, al editar un registro ajeno, el catálogo del formulario salga de la **posición del dueño** del registro.

**Tech Stack:** Next.js App Router (RSC + client components), Supabase (supabase-js, RPC security-definer), Tailwind v4 con tokens CSS, shadcn/Base UI, Playwright e2e.

## Global Constraints

- **Gate real = `npx tsc --noEmit` + `next build`.** `npm run lint` está roto repo-wide desde Next 16; no es gate.
- **El dev server es del usuario (user-managed).** No arrancarlo ni pararlo. Playwright NO debe spawnearlo (`webServer` desactivado); correr e2e contra el server ya levantado en `http://localhost:3000`.
- **Sin migraciones ni cambios de RPC.** El backend ya soporta y audita la operación.
- Estética: seguir los tokens/patrones existentes (`text-(--brand)`, `--muted-surface`, `Badge`, iconos `lucide-react`).
- e2e admin: proyecto Playwright `chromium-horas-admin` (usa `e2e/.auth/admin-horas.json`).
- Managers NO editan/anulan ajenos (el request es "el admin"; el RPC igual los bloquea).

---

### Task 1: Edición ajena en el flujo de `registrar` (catálogo del dueño + retorno)

Al editar el registro de otra persona, el formulario debe: (a) precargarse solo si soy admin (o es propio), (b) ofrecer el catálogo de la posición del **dueño**, (c) mostrar su nombre en el encabezado, (d) volver a `/equipo` al guardar. También se siembra un registro del operativo para poder testear.

**Files:**
- Modify: `components/horas/RegistroForm.tsx` (prop `returnTo`, línea 54-58 y 150)
- Modify: `app/(horas)/registrar/page.tsx` (reordenar: cargar log antes que catálogos; owner id/nombre; auth; catálogo del dueño; encabezado; `returnTo`)
- Modify: `e2e/helpers/seed-horas.ts` (crear un `time_log` + línea del operativo; devolver `operativoLogId`, `operativoName`)
- Modify: `e2e/global-setup.ts` (persistir la fixture de horas a `e2e/.horas.json`)
- Modify: `.gitignore` (ignorar `e2e/.horas.json` — es efímera, se regenera cada corrida)
- Create: `e2e/registros-admin.spec.ts` (test del encabezado con nombre del dueño)

**Interfaces:**
- Produces: `RegistroForm` prop `returnTo?: string` (default `'/mis-registros'`).
- Produces: `seedHorasFixture()` devuelve además `operativoLogId: string` y `operativoName: string`.
- Produces: archivo `e2e/.horas.json` con la fixture de horas (incluye `operativoLogId`, `operativoName`, `operativoEmail`, `operativoPassword`, `userId`, `adminEmail`, `adminPassword`, `adminUserId`).

- [ ] **Step 1: Sembrar un registro del operativo en `seed-horas.ts`**

En `e2e/helpers/seed-horas.ts`, tras `await admin.from('user_areas').insert({ user_id: userId, area_id: area!.id })` (línea 24), insertar un registro y devolverlo. Reemplazar el bloque `return { ... }` (líneas 35-42) para incluir los nuevos campos:

```ts
  await admin.from('user_areas').insert({ user_id: userId, area_id: area!.id })

  // Un registro del operativo (hoy, 2h) para que el admin lo edite/anule en los tests.
  const { data: etapa } = await admin.from('etapas').select('id').limit(1).single()
  const today = new Date().toISOString().slice(0, 10)
  const { data: log } = await admin.from('time_logs').insert({
    user_id: userId, entry_date: today, total_hours: 2, status: 'guardado', created_by: userId, updated_by: userId,
  }).select('id').single()
  await admin.from('time_log_lines').insert({
    log_id: log!.id, project: 'Proyecto E2E', area_id: area!.id, department: 'Clientes',
    etapa_id: etapa!.id, hours: 2, description: 'Registro sembrado E2E', created_by: userId, updated_by: userId,
  })

  // Create admin user
  const { data: createdAdmin, error: adminError } = await admin.auth.admin.createUser({
    email: ADMIN_USER.email, password: ADMIN_USER.password, email_confirm: true,
    user_metadata: { full_name: ADMIN_USER.full_name },
  })
  if (adminError) throw adminError
  const adminUserId = createdAdmin.user!.id
  await admin.from('profiles').update({ role: 'admin', status: 'activo', must_change_password: false }).eq('id', adminUserId)

  return {
    operativoEmail: OPERATIVO.email,
    operativoPassword: OPERATIVO.password,
    userId,
    operativoLogId: log!.id,
    operativoName: OPERATIVO.full_name,
    adminEmail: ADMIN_USER.email,
    adminPassword: ADMIN_USER.password,
    adminUserId,
  }
```

- [ ] **Step 2: Persistir la fixture de horas en `global-setup.ts`**

En `e2e/global-setup.ts`, justo después de `const horasFixture = await seedHorasFixture()` (línea 26), agregar:

```ts
  const horasFixture = await seedHorasFixture()
  fs.writeFileSync('e2e/.horas.json', JSON.stringify(horasFixture))
```

Y en `.gitignore`, agregar una línea:

```
e2e/.horas.json
```

- [ ] **Step 3: Agregar el prop `returnTo` a `RegistroForm`**

En `components/horas/RegistroForm.tsx`, en la firma (líneas 54-58), agregar `returnTo`:

```tsx
export default function RegistroForm({ projects, finishedProjects, pausedProjects, exceededProjects, areas, etapas, clientEtapas, descripciones, departamentos, internalAreaId, canBackdate = false, initial, returnTo = '/mis-registros' }: {
  projects: string[]; finishedProjects: string[]; pausedProjects: string[]; exceededProjects: string[]; areas: AreaRow[]; etapas: EtapaRow[]; clientEtapas: EtapaRow[]; descripciones: string[]; departamentos: DepartamentoRow[]; internalAreaId: string
  canBackdate?: boolean // admin: puede registrar fuera del rango de 14 días (PDF §4)
  initial?: { id: string; lines: LineInput[] }
  returnTo?: string // a dónde volver al guardar (default: mis registros; /equipo al editar ajeno)
}) {
```

Y en el redirect de éxito (línea 150), usar `returnTo`:

```tsx
    toast.success(initial ? 'Registro actualizado' : 'Registro guardado')
    router.push(returnTo)
```

- [ ] **Step 4: Reescribir `registrar/page.tsx` para el modo edición ajena**

Reemplazar el contenido completo de `app/(horas)/registrar/page.tsx` por:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getCatalogos, getMyPositionAreas, getMyPositionEtapaIds, getMyPositionDepartamentoIds } from '@/lib/horas/queries'
import { getCachedProyectosEstado } from '@/lib/graph/client'
import { getBancosHoras } from '@/lib/horas/bancos'
import RegistroForm from '@/components/horas/RegistroForm'
import type { LineInput } from '@/app/(horas)/registrar/actions'

export default async function RegistrarPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('profiles').select('role, position_id').eq('id', user!.id).single()

  // Modo edición: cargar el log ANTES que los catálogos, porque el catálogo (áreas/etapas/
  // departamentos) sale de la POSICIÓN DEL DUEÑO del registro, no de la del que edita. Solo
  // se precarga si el registro es propio o si soy admin (un manager que abra un ?edit= ajeno
  // por URL ve el formulario en blanco; el motor igual rechazaría el guardado).
  let initial: { id: string; lines: LineInput[] } | undefined
  let ownerName: string | undefined
  let catalogUserId = user!.id
  if (edit) {
    const { data: log } = await supabase
      .from('time_logs')
      .select('id, user_id, entry_date, status, profiles!time_logs_user_id_fkey(full_name), time_log_lines(project, area_id, department, etapa_id, hours, description)')
      .eq('id', edit).single()
    const puedeEditar = !!log && (log.user_id === user!.id || me?.role === 'admin')
    if (log && puedeEditar && log.status !== 'anulado') {
      initial = {
        id: log.id,
        lines: (log.time_log_lines as Omit<LineInput, 'entry_date'>[]).map((l) => ({
          entry_date: log.entry_date, project: l.project, area_id: l.area_id, department: l.department,
          etapa_id: l.etapa_id, hours: Number(l.hours), description: l.description,
        })),
      }
      catalogUserId = log.user_id
      if (log.user_id !== user!.id) ownerName = (log.profiles as { full_name: string } | null)?.full_name ?? undefined
    }
  }

  const { areas, etapas, descripciones, departamentos } = await getCatalogos()
  // El catálogo sale de la posición del DUEÑO (en alta o edición propia, es el propio usuario).
  const myPositionAreas = await getMyPositionAreas(catalogUserId)
  const internal = areas.find((a) => a.is_internal)
  if (!internal) throw new Error('No hay un área interna configurada (is_internal) para el proyecto "Departamento".')

  const selectableAreas = myPositionAreas.filter((a) => !a.is_internal)
  const positionEtapaIds = await getMyPositionEtapaIds(catalogUserId)
  const departmentEtapaIds = new Set(departamentos.flatMap((d) => d.etapaIds))
  const clientEtapas = etapas.filter((e) => positionEtapaIds.includes(e.id) && !departmentEtapaIds.has(e.id))
  const positionDepartamentoIds = await getMyPositionDepartamentoIds(catalogUserId)
  const allowedDepartamentos = departamentos.filter((d) => positionDepartamentoIds.includes(d.id))

  // La lista de proyectos y estados sale de Clientes_Proyectos (registro maestro con TODOS
  // los proyectos). Excel caído → solo "Departamento", sin avisos.
  let projects: string[] = ['Departamento']
  let finishedProjects: string[] = []
  let pausedProjects: string[] = []
  try {
    const estados = await getCachedProyectosEstado()
    projects = Array.from(new Set([...estados.map((e) => e.project), 'Departamento']))
    finishedProjects = estados.filter((e) => e.estado.toLowerCase() === 'finalizado').map((e) => e.project)
    pausedProjects = estados.filter((e) => e.estado.toLowerCase().includes('paus')).map((e) => e.project)
  } catch { /* Excel no disponible: solo Departamento, sin avisos */ }

  const finishedSet = new Set(finishedProjects)
  projects.sort((a, b) => (finishedSet.has(a) ? 1 : 0) - (finishedSet.has(b) ? 1 : 0) || a.localeCompare(b))

  // Banco POR POSICIÓN: aviso de "excedido" según la posición del que registra (admin usa la suya).
  let exceededProjects: string[] = []
  if (me?.position_id) {
    try {
      const { data: pos } = await supabase.from('positions').select('name').eq('id', me.position_id).single()
      const positionName = pos?.name
      if (positionName) {
        exceededProjects = (await getBancosHoras({ role: 'admin' }))
          .filter((b) => b.position === positionName && b.status === 'excedido')
          .map((b) => b.project)
      }
    } catch { /* bancos/Excel no disponibles: sin aviso de excedido */ }
  }

  const returnTo = ownerName ? '/equipo' : '/mis-registros'
  const heading = initial ? (ownerName ? `Editar registro de ${ownerName}` : 'Editar registro') : 'Registrar horas'

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">{heading}</h1>
      <RegistroForm projects={projects} finishedProjects={finishedProjects} pausedProjects={pausedProjects} exceededProjects={exceededProjects} areas={selectableAreas} etapas={etapas} clientEtapas={clientEtapas} descripciones={descripciones} departamentos={allowedDepartamentos} internalAreaId={internal.id} canBackdate={me?.role === 'admin'} initial={initial} returnTo={returnTo} />
    </div>
  )
}
```

- [ ] **Step 5: Escribir el test e2e del encabezado (falla ahora)**

Crear `e2e/registros-admin.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const horas = JSON.parse(fs.readFileSync('e2e/.horas.json', 'utf8')) as {
  operativoLogId: string; operativoName: string
}

test('el admin abre la edición de un registro ajeno con el nombre del dueño', async ({ page }) => {
  await page.goto(`/registrar?edit=${horas.operativoLogId}`)
  // El encabezado nombra al dueño → prueba: autorización de precarga (admin) + detección de
  // ajeno + resolución del nombre. (El catálogo del dueño lo cubre tsc/revisión.)
  await expect(
    page.getByRole('heading', { name: `Editar registro de ${horas.operativoName}` }),
  ).toBeVisible()
})
```

- [ ] **Step 6: Correr el test → debe FALLAR**

Run: `npx playwright test registros-admin --project=chromium-horas-admin --reporter=list`
Expected: FAIL — hoy el encabezado en edición es `Editar registro` (sin el nombre del dueño), así que el heading esperado no aparece. (Si `e2e/.horas.json` no existe aún, correr una vez el global-setup con `npx playwright test smoke --project=chromium-horas-admin` para regenerarlo.)

- [ ] **Step 7: Correr el typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (exit 0). Si aparecen errores en `.next/types` o `.next/dev/types`, son artefactos stale del dev server; borrar `.next/types` y `.next/dev/types/*` y reintentar.

- [ ] **Step 8: Correr el test → debe PASAR**

Run: `npx playwright test registros-admin --project=chromium-horas-admin --reporter=list`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add components/horas/RegistroForm.tsx "app/(horas)/registrar/page.tsx" e2e/helpers/seed-horas.ts e2e/global-setup.ts .gitignore e2e/registros-admin.spec.ts
git commit -m "feat(registros): el admin edita registros ajenos con el catálogo del dueño"
```

---

### Task 2: Acciones (Editar/Anular) + buscador/filtros en `/equipo`

Exponer en la lista "Registros del equipo" las acciones de Editar/Anular (solo admin) y un buscador con filtros por estado y rango de fechas.

**Files:**
- Create: `app/(horas)/equipo/actions.ts` (`anularRegistroEquipo`)
- Modify: `components/horas/EquipoRegistros.tsx` (prop `isAdmin`; acciones en el panel desplegado; toolbar de filtros + filtrado client-side + estado vacío)
- Modify: `app/(horas)/equipo/page.tsx` (pasar `isAdmin`, línea 137)
- Modify: `e2e/registros-admin.spec.ts` (tests de anular y de buscador)

**Interfaces:**
- Consumes: `e2e/.horas.json` (Task 1); `/registrar?edit=<id>` (Task 1).
- Produces: `EquipoRegistros` prop `isAdmin: boolean`.
- Produces: `anularRegistroEquipo(id: string): Promise<{ ok: true } | { ok: false; error: string }>`.

- [ ] **Step 1: Crear la server action de anular**

Crear `app/(horas)/equipo/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// Anular un registro desde /equipo. El RPC anular_registro_diario (migración 0017) valida
// que solo el admin pueda anular ajenos y escribe la auditoría 'anular'.
export async function anularRegistroEquipo(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('anular_registro_diario', { p_log_id: id })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/equipo')
  return { ok: true }
}
```

- [ ] **Step 2: Reescribir `EquipoRegistros.tsx` con acciones + filtros**

Reemplazar el contenido completo de `components/horas/EquipoRegistros.tsx` por:

```tsx
'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronRight, Pencil, Ban } from 'lucide-react'
import { formatHoras } from '@/lib/horas/format'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { anularRegistroEquipo } from '@/app/(horas)/equipo/actions'

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  guardado: 'secondary', editado: 'outline', anulado: 'destructive',
}

// Una línea del registro, con nombres ya resueltos (para mostrar en el desglose).
export interface EquipoLineDetail {
  project: string
  hours: number
  description: string
  department: string
  area: string
  etapa: string
}

// Un registro diario (time_log) del equipo, con sus líneas.
export interface EquipoLog {
  id: string
  entry_date: string
  total_hours: number
  status: string
  user: string
  lines: EquipoLineDetail[]
}

type Estado = 'todos' | 'guardado' | 'editado' | 'anulado'

const inputCls = 'rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

// Registros del equipo: una fila por registro diario que se despliega para ver sus líneas.
// El admin ve acciones Editar/Anular en el panel desplegado. Un buscador + filtros acotan
// la lista (client-side sobre los registros ya cargados).
export default function EquipoRegistros({ logs, isAdmin = false }: { logs: EquipoLog[]; isAdmin?: boolean }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState<Estado>('todos')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function onAnular(id: string) {
    if (!confirm('¿Anular este registro? Devolverá las horas al banco correspondiente.')) return
    setBusy(id)
    const res = await anularRegistroEquipo(id)
    setBusy(null)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Registro anulado'); router.refresh()
  }

  // Filtro client-side sobre los logs ya cargados (mismo patrón que la lista de bancos).
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return logs.filter((l) => {
      if (estado !== 'todos' && l.status !== estado) return false
      if (desde && l.entry_date < desde) return false
      if (hasta && l.entry_date > hasta) return false
      if (needle) {
        const inUser = l.user.toLowerCase().includes(needle)
        const inProject = l.lines.some((ln) => ln.project.toLowerCase().includes(needle))
        if (!inUser && !inProject) return false
      }
      return true
    })
  }, [logs, q, estado, desde, hasta])

  return (
    <div className="space-y-3">
      {/* Toolbar: buscador + filtros */}
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="min-w-52 flex-1 space-y-1">
          <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">Buscar registro</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Usuario o proyecto…" aria-label="Buscar registro" className={cn(inputCls, 'w-full')} />
        </label>
        <label className="space-y-1">
          <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value as Estado)} aria-label="Filtrar por estado" className={inputCls}>
            <option value="todos">Todos</option>
            <option value="guardado">Guardado</option>
            <option value="editado">Editado</option>
            <option value="anulado">Anulado</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta" className={inputCls} />
        </label>
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        {/* Cabecera (escritorio) */}
        <div className="hidden items-center gap-4 border-b border-border bg-(--muted-surface) px-4 py-2.5 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted-foreground md:flex">
          <span className="w-4" aria-hidden />
          <span className="w-28">Fecha</span>
          <span className="flex-1">Usuario</span>
          <span className="w-20 text-right">Total</span>
          <span className="w-24 text-right">Estado</span>
        </div>

        {logs.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Aún no hay registros.</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No hay registros que coincidan con los filtros.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((l) => {
              const open = expanded.has(l.id)
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => toggle(l.id)}
                    aria-expanded={open}
                    className="group flex w-full items-center gap-4 px-4 py-3 text-left outline-none transition-colors hover:bg-(--muted-surface)/50 focus-visible:bg-(--muted-surface)/50"
                  >
                    <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground/60 transition-transform duration-300 group-hover:text-(--brand)', open && 'rotate-90')} />
                    <span className="w-28 shrink-0 tabular-money text-sm whitespace-nowrap text-foreground/70">{l.entry_date}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">{l.user}</span>
                    <span className="w-20 shrink-0 text-right tabular-money text-sm font-medium">{formatHoras(l.total_hours)}</span>
                    <span className="w-24 shrink-0 text-right">
                      <Badge variant={STATUS_VARIANT[l.status] ?? 'outline'} className="capitalize">{l.status}</Badge>
                    </span>
                  </button>

                  {/* Detalle de las líneas (desplegable animado) */}
                  <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                    <div className="overflow-hidden">
                      <div className="border-t border-border/60 bg-(--muted-surface)/40 px-4 pb-4 pt-2 md:pl-12">
                        {l.lines.length === 0 ? (
                          <p className="py-2 text-sm text-muted-foreground">Este registro no tiene líneas.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-2xl text-sm">
                              <thead>
                                <tr className="text-left text-[0.7rem] uppercase tracking-wide text-muted-foreground/80">
                                  <th className="py-2 pr-4 font-medium">Proyecto</th>
                                  <th className="py-2 pr-4 font-medium">Área / Depto</th>
                                  <th className="py-2 pr-4 font-medium">Etapa</th>
                                  <th className="py-2 pr-4 font-medium text-right">Horas</th>
                                  <th className="py-2 font-medium">Descripción</th>
                                </tr>
                              </thead>
                              <tbody>
                                {l.lines.map((ln, i) => (
                                  <tr key={i} className="border-t border-border/50 align-top">
                                    <td className="py-2 pr-4 font-medium whitespace-nowrap">{ln.project}</td>
                                    <td className="py-2 pr-4 text-foreground/70 whitespace-nowrap">{ln.project === 'Departamento' ? (ln.department || '—') : (ln.area || '—')}</td>
                                    <td className="py-2 pr-4 text-foreground/70 whitespace-nowrap">{ln.etapa || '—'}</td>
                                    <td className="py-2 pr-4 text-right tabular-money whitespace-nowrap">{formatHoras(ln.hours)}</td>
                                    <td className="py-2 text-foreground/80">{ln.description || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Acciones del admin: corregir (editar) o anular el registro ajeno. */}
                        {isAdmin && l.status !== 'anulado' && (
                          <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
                            <Link
                              href={`/registrar?edit=${l.id}`}
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-(--brand) transition-colors hover:bg-(--brand)/10"
                            >
                              <Pencil className="size-4" /> Editar
                            </Link>
                            <button
                              onClick={() => onAnular(l.id)}
                              disabled={busy === l.id}
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            >
                              <Ban className="size-4" /> {busy === l.id ? 'Anulando…' : 'Anular'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Pasar `isAdmin` desde `equipo/page.tsx`**

En `app/(horas)/equipo/page.tsx`, línea 137, cambiar:

```tsx
        <EquipoRegistros logs={registros} isAdmin={viewer.role === 'admin'} />
```

- [ ] **Step 4: Escribir los tests e2e de anular y buscador (fallan ahora)**

Añadir al final de `e2e/registros-admin.spec.ts`:

```ts
test('el buscador de /equipo filtra por usuario', async ({ page }) => {
  await page.goto('/equipo')
  await expect(page.getByRole('heading', { name: 'Equipo' })).toBeVisible()
  const buscar = page.getByLabel('Buscar registro')
  await buscar.fill(horas.operativoName)
  // La fila del operativo sembrado sigue visible…
  await expect(page.locator('li').filter({ hasText: horas.operativoName }).first()).toBeVisible()
  // …y un término imposible deja la lista vacía con el mensaje de "sin coincidencias".
  await buscar.fill('zzz-no-existe-zzz')
  await expect(page.getByText('No hay registros que coincidan con los filtros.')).toBeVisible()
})

test('el admin anula un registro ajeno desde /equipo', async ({ page }) => {
  page.on('dialog', (d) => d.accept()) // aceptar el confirm() de anular
  await page.goto('/equipo')
  await expect(page.getByRole('heading', { name: 'Equipo' })).toBeVisible()
  // Acotar por el buscador y desplegar la fila del operativo sembrado.
  await page.getByLabel('Buscar registro').fill(horas.operativoName)
  const fila = page.locator('li').filter({ hasText: horas.operativoName }).first()
  await expect(fila).toBeVisible()
  await fila.getByRole('button').first().click() // toggle de la fila
  // El enlace Editar apunta al formulario de edición de ese registro.
  await expect(fila.getByRole('link', { name: /editar/i })).toHaveAttribute('href', `/registrar?edit=${horas.operativoLogId}`)
  // Anular → la fila queda en estado "anulado".
  await fila.getByRole('button', { name: /anular/i }).click()
  await expect(
    page.locator('li').filter({ hasText: horas.operativoName }).first().getByText('anulado'),
  ).toBeVisible()
})
```

- [ ] **Step 5: Correr los tests → deben FALLAR**

Run: `npx playwright test registros-admin --project=chromium-horas-admin --reporter=list`
Expected: FAIL — hoy no existe el buscador `Buscar registro` ni las acciones Editar/Anular en `/equipo`.

- [ ] **Step 6: Correr el typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (exit 0). (Ver nota de `.next/types` stale en Task 1 Step 7.)

- [ ] **Step 7: Correr los tests → deben PASAR**

Run: `npx playwright test registros-admin --project=chromium-horas-admin --reporter=list`
Expected: PASS (los 3 tests del archivo).

> Nota: el test de anular deja el registro sembrado en estado `anulado`; corre después del test del encabezado (que necesita el registro no anulado). Playwright ejecuta los tests de un mismo archivo en orden, y el global-setup resiembra un registro fresco en cada corrida completa.

- [ ] **Step 8: Verificar el build (gate)**

Run: `next build`
Expected: compila sin errores. (Si el dev server está usando `.next`, correr el build es opcional en local; Vercel lo valida en el deploy. Priorizar `tsc` en local.)

- [ ] **Step 9: Commit**

```bash
git add "app/(horas)/equipo/actions.ts" components/horas/EquipoRegistros.tsx "app/(horas)/equipo/page.tsx" e2e/registros-admin.spec.ts
git commit -m "feat(equipo): acciones Editar/Anular del admin + buscador/filtros en registros del equipo"
```

---

## Self-Review

**1. Spec coverage:**
- "Editar registros ajenos (admin), catálogo del dueño, encabezado con nombre, retorno a /equipo" → Task 1 (registrar/page + RegistroForm). ✓
- "Autorización de precarga (propio o admin)" → Task 1 Step 4 (`puedeEditar`). ✓
- "Anular ajenos (admin) + acción con revalidate" → Task 2 (equipo/actions.ts + botón Anular). ✓
- "Acciones en el panel desplegado, solo admin" → Task 2 Step 2 (`isAdmin && l.status !== 'anulado'`). ✓
- "Buscador (usuario/proyecto) + filtro estado + rango de fechas + estado vacío" → Task 2 Step 2 (toolbar + `filtered`). ✓
- "isAdmin desde equipo/page" → Task 2 Step 3. ✓
- "Sin migraciones / auditoría ya cubierta" → no hay tasks de backend, correcto. ✓
- "e2e: editar (encabezado/prefill), anular, filtros" → Task 1 Step 5 + Task 2 Step 4. ✓ (El round-trip completo de guardado-y-retorno queda cubierto por tsc + revisión, no por e2e, por la fragilidad conocida del submit del formulario en páginas pesadas.)

**2. Placeholder scan:** Sin TBD/TODO; todo el código está completo. ✓

**3. Type consistency:**
- `returnTo?: string` definido en RegistroForm (Task 1 Step 3) y usado en registrar/page (Task 1 Step 4). ✓
- `anularRegistroEquipo(id: string): Promise<{ ok: true } | { ok: false; error: string }>` definido en Task 2 Step 1 e importado/usado en EquipoRegistros (Task 2 Step 2). ✓
- `EquipoRegistros` prop `isAdmin?: boolean` definido en Task 2 Step 2 y provisto en equipo/page (Task 2 Step 3). ✓
- `seedHorasFixture` devuelve `operativoLogId`/`operativoName` (Task 1 Step 1), persistidos a `e2e/.horas.json` (Task 1 Step 2) y leídos en el spec (Task 1 Step 5, Task 2 Step 4). ✓
- `EquipoLog`/`EquipoLineDetail` se mantienen con la misma forma que `equipo/page.tsx` construye. ✓

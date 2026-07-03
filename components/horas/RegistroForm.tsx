'use client'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { guardarRegistro, type LineInput } from '@/app/(horas)/registrar/actions'
import { formatHoras } from '@/lib/horas/format'
import type { AreaRow, EtapaRow, DepartamentoRow } from '@/lib/horas/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { TriangleAlert } from 'lucide-react'
import ProjectCombobox from '@/components/horas/ProjectCombobox'
import DepartamentoSelect from '@/components/horas/DepartamentoSelect'
import NativeSelect from '@/components/ui/native-select'

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const emptyLine = (areaId: string, date: string, dep: string): LineInput => ({ entry_date: date, project: '', area_id: areaId, department: dep, etapa_id: '', hours: 0, description: '' })

const field =
  'w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

// Campo etiquetado para la vista móvil (label arriba + control).
function MobileField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export default function RegistroForm({ projects, finishedProjects, pausedProjects, exceededProjects, areas, etapas, clientEtapas, descripciones, departamentos, internalAreaId, canBackdate = false, initial }: {
  projects: string[]; finishedProjects: string[]; pausedProjects: string[]; exceededProjects: string[]; areas: AreaRow[]; etapas: EtapaRow[]; clientEtapas: EtapaRow[]; descripciones: string[]; departamentos: DepartamentoRow[]; internalAreaId: string
  canBackdate?: boolean // admin: puede registrar fuera del rango de 14 días (PDF §4)
  initial?: { id: string; lines: LineInput[] }
}) {
  const router = useRouter()
  const finishedSet = new Set(finishedProjects)
  const pausedSet = new Set(pausedProjects)
  const exceededSet = new Set(exceededProjects)
  // Confirmación al elegir un proyecto finalizado, pausado y/o con el banco excedido.
  const [projectWarning, setProjectWarning] = useState<{ index: number; project: string; finished: boolean; paused: boolean; exceeded: boolean } | null>(null)
  // Fecha por defecto: la heredan las líneas nuevas y las que aún la seguían.
  const [defaultDate, setDefaultDate] = useState(initial?.lines[0]?.entry_date ?? today())
  const defaultDep = departamentos[0]?.name ?? 'Clientes'
  const [lines, setLines] = useState<LineInput[]>(initial?.lines ?? [emptyLine(areas[0]?.id ?? '', today(), defaultDep)])
  const [saving, setSaving] = useState(false)

  const total = lines.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  // Subtotales por fecha (se muestran solo cuando hay más de una fecha).
  const byDate = lines.reduce<Record<string, number>>((acc, l) => {
    acc[l.entry_date] = (acc[l.entry_date] ?? 0) + (Number(l.hours) || 0); return acc
  }, {})
  const dates = Object.keys(byDate).sort()
  const isDepartamento = (p: string) => p === 'Departamento'
  // La columna Departamento solo aplica al proyecto interno "Departamento":
  // se muestra únicamente si alguna línea lo usa.
  const showDepartamento = lines.some((l) => isDepartamento(l.project))
  // La columna Etapa solo aplica a proyectos cliente (en Departamento la etapa
  // viene predefinida por el departamento): se oculta si todas las líneas son Departamento.
  const showEtapa = lines.some((l) => !isDepartamento(l.project))

  function update(i: number, patch: Partial<LineInput>) {
    setLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const next = { ...l, ...patch }
      
      let checkEtapaForDep = false

      if (patch.project !== undefined) {
        if (isDepartamento(patch.project)) { 
          next.area_id = internalAreaId
          if (!departamentos.some(d => d.name === next.department)) {
            next.department = defaultDep
          }
          checkEtapaForDep = true
        } else {
          next.department = defaultDep
          if (next.area_id === internalAreaId) next.area_id = areas[0]?.id ?? ''
          // Al salir de "Departamento", limpiar la etapa si no es válida para proyecto
          // cliente (las etapas de departamento no aplican en proyectos generales).
          if (next.etapa_id && !clientEtapas.some((e) => e.id === next.etapa_id)) next.etapa_id = ''
        }
      }

      if (patch.department !== undefined && isDepartamento(next.project)) {
        checkEtapaForDep = true
      }

      if (checkEtapaForDep) {
        const dep = departamentos.find((d) => d.name === next.department)
        if (dep && dep.etapaIds.length === 1) {
          next.etapa_id = dep.etapaIds[0]
        } else if (dep && !dep.etapaIds.includes(next.etapa_id)) {
          next.etapa_id = '' // clear if current etapa is not allowed in this new department
        }
      }

      // Descripción: en "Departamento" debe estar en la lista general; al entrar a
      // "Departamento", si la actual (texto libre) no está en la lista, se limpia. Fuera
      // de "Departamento" es texto libre.
      if (patch.project !== undefined && isDepartamento(next.project)) {
        if (next.description && !descripciones.includes(next.description)) next.description = ''
      }

      return next
    }))
  }

  // Cambiar la fecha por defecto arrastra a las líneas que aún la seguían;
  // las que el usuario cambió a mano conservan su fecha.
  function changeDefaultDate(newDate: string) {
    setLines((prev) => prev.map((l) => (l.entry_date === defaultDate ? { ...l, entry_date: newDate } : l)))
    setDefaultDate(newDate)
  }

  async function onSave() {
    setSaving(true)
    const res = await guardarRegistro(lines, initial?.id ?? null)
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(initial ? 'Registro actualizado' : 'Registro guardado')
    router.push('/mis-registros')
  }

  // Controles de una línea, reutilizados por la tabla (escritorio) y las tarjetas (móvil).
  function lineControls(l: LineInput, i: number) {
    const isDep = isDepartamento(l.project)
    const lineClientEtapas = l.etapa_id && !clientEtapas.some((e) => e.id === l.etapa_id)
      ? [...clientEtapas, ...etapas.filter((e) => e.id === l.etapa_id)]
      : clientEtapas
    // Descripción: en "Departamento" es la lista general (compartida); en el resto, texto libre.
    const deptDescripciones = isDep ? descripciones : []

    const fecha = (
      <Input aria-label="Fecha" type="date" value={l.entry_date} max={today()} min={canBackdate ? undefined : daysAgo(14)}
        onChange={(e) => update(i, { entry_date: e.target.value })} />
    )
    const proyecto = (
      <ProjectCombobox ariaLabel="Proyecto" value={l.project} projects={projects}
        finishedProjects={finishedSet} pausedProjects={pausedSet} exceededProjects={exceededSet}
        onValueChange={(v) => {
          const finished = !!v && finishedSet.has(v)
          const paused = !!v && pausedSet.has(v)
          const exceeded = !!v && exceededSet.has(v)
          if (finished || paused || exceeded) { setProjectWarning({ index: i, project: v, finished, paused, exceeded }); return }
          update(i, { project: v })
        }} />
    )
    const depto = departamentos.length === 0 ? (
      <NativeSelect aria-label="Departamento" value="" disabled fullWidth><option value="">— Sin departamentos (contacta al admin) —</option></NativeSelect>
    ) : (
      <DepartamentoSelect ariaLabel="Departamento" value={l.department} departamentos={departamentos}
        onValueChange={(v) => update(i, { department: v })} />
    )
    const etapa = lineClientEtapas.length === 0 ? (
      <NativeSelect aria-label="Etapa" value="" disabled fullWidth><option value="">— Sin etapas asignadas (contacta al admin) —</option></NativeSelect>
    ) : (
      <NativeSelect aria-label="Etapa" value={l.etapa_id} onChange={(e) => update(i, { etapa_id: e.target.value })} fullWidth>
        <option value="">— Etapa —</option>
        {lineClientEtapas.map((et) => <option key={et.id} value={et.id}>{et.name}</option>)}
      </NativeSelect>
    )
    const horas = (
      <Input aria-label="Horas" type="number" step="0.5" min="0" value={l.hours || ''}
        onChange={(e) => update(i, { hours: Number(e.target.value) })} />
    )
    // En "Departamento": desplegable con las descripciones del departamento. En el resto:
    // input de texto libre (obligatorio; el motor exige no vacía).
    const desc = isDep ? (
      deptDescripciones.length === 0 ? (
        <NativeSelect aria-label="Descripción" value="" disabled fullWidth><option value="">— Sin descripciones (contacta al admin) —</option></NativeSelect>
      ) : (
        <NativeSelect aria-label="Descripción" value={l.description} onChange={(e) => update(i, { description: e.target.value })} fullWidth>
          <option value="">— Descripción —</option>
          {deptDescripciones.map((name) => <option key={name} value={name}>{name}</option>)}
        </NativeSelect>
      )
    ) : (
      <input aria-label="Descripción" type="text" value={l.description}
        onChange={(e) => update(i, { description: e.target.value })} placeholder="Descripción…" className={field} />
    )
    const emptyPlaceholder = <span className="flex h-9 items-center px-2.5 text-sm text-muted-foreground/40">—</span>
    return { isDep, fecha, proyecto, depto, etapa, horas, desc, emptyPlaceholder }
  }

  const removeBtn = (i: number) => (
    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
      disabled={lines.length === 1} aria-label="Eliminar línea" className="text-foreground/40 hover:text-(--status-excedido)">✕</Button>
  )

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="fecha" className="text-sm font-medium text-foreground">Fecha por defecto</label>
        <Input
          id="fecha" type="date" value={defaultDate} max={today()} min={canBackdate ? undefined : daysAgo(14)}
          onChange={(e) => changeDefaultDate(e.target.value)} className="w-auto"
        />
        {!canBackdate && <span className="text-xs text-muted-foreground">Hasta 14 días atrás</span>}
      </div>

      {/* Escritorio: tabla */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 pr-3 font-medium">Fecha</th>
              <th className="pb-1 pr-3 font-medium">Proyecto</th>
              {showDepartamento && <th className="pb-1 pr-3 font-medium">Departamento</th>}
              {showEtapa && <th className="pb-1 pr-3 font-medium">Etapa</th>}
              <th className="pb-1 pr-3 font-medium">Horas</th>
              <th className="pb-1 pr-3 font-medium">Descripción</th>
              <th className="w-8 pb-1"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const c = lineControls(l, i)
              return (
                <tr key={i}>
                  <td className="min-w-37 pr-3 align-top">{c.fecha}</td>
                  <td className="min-w-45 pr-3 align-top">{c.proyecto}</td>
                  {showDepartamento && <td className="min-w-32.5 pr-3 align-top">{c.isDep ? c.depto : c.emptyPlaceholder}</td>}
                  {showEtapa && <td className="min-w-35 pr-3 align-top">{c.isDep ? c.emptyPlaceholder : c.etapa}</td>}
                  <td className="w-24 pr-3 align-top">{c.horas}</td>
                  <td className="min-w-50 pr-3 align-top">{c.desc}</td>
                  <td className="align-middle">{removeBtn(i)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Móvil: una tarjeta por línea */}
      <div className="space-y-3 md:hidden">
        {lines.map((l, i) => {
          const c = lineControls(l, i)
          return (
            <div key={i} className="rounded-xl border border-border bg-(--muted-surface) p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Línea {i + 1}</span>
                {removeBtn(i)}
              </div>
              <div className="space-y-3">
                <MobileField label="Fecha">{c.fecha}</MobileField>
                <MobileField label="Proyecto">{c.proyecto}</MobileField>
                {c.isDep ? <MobileField label="Departamento">{c.depto}</MobileField> : <MobileField label="Etapa">{c.etapa}</MobileField>}
                <MobileField label="Horas">{c.horas}</MobileField>
                <MobileField label="Descripción">{c.desc}</MobileField>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex items-start justify-between border-t border-border pt-4">
        <Button type="button" variant="link" size="sm" className="px-0" onClick={() => setLines((p) => [...p, emptyLine(areas[0]?.id ?? '', defaultDate, defaultDep)])}>
          + Añadir línea
        </Button>
        <div className="text-right">
          <span className="text-sm text-muted-foreground">
            Total: <strong className="tabular-money ml-1 text-base text-foreground">{formatHoras(total)}</strong>
          </span>
          {dates.length > 1 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {dates.map((d) => `${d}: ${formatHoras(byDate[d])}`).join(' · ')}
            </div>
          )}
        </div>
      </div>

      <Button type="button" onClick={onSave} disabled={saving} size="lg" className="mt-6">
        {saving ? 'Guardando…' : 'Guardar registro'}
      </Button>

      <Dialog open={projectWarning !== null} onOpenChange={(open) => { if (!open) setProjectWarning(null) }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-(--status-bajo)" />
              {projectWarning?.finished && projectWarning?.exceeded
                ? 'Proyecto finalizado y excedido'
                : projectWarning?.paused && projectWarning?.exceeded
                ? 'Proyecto pausado y excedido'
                : projectWarning?.exceeded
                ? 'Banco de horas excedido'
                : projectWarning?.finished
                ? 'Proyecto finalizado'
                : 'Proyecto pausado'}
            </DialogTitle>
            <DialogDescription>
              El proyecto <strong className="font-medium text-foreground">{projectWarning?.project}</strong>{' '}
              {projectWarning?.finished && projectWarning?.exceeded
                ? 'está marcado como finalizado y el banco de horas de tu posición está excedido.'
                : projectWarning?.paused && projectWarning?.exceeded
                ? 'está pausado y el banco de horas de tu posición está excedido.'
                : projectWarning?.exceeded
                ? 'tiene el banco de horas de tu posición excedido.'
                : projectWarning?.finished
                ? 'está marcado como finalizado en el Excel.'
                : 'está pausado en el Excel.'}{' '}
              ¿Deseas registrar horas de todas formas?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectWarning(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (projectWarning) update(projectWarning.index, { project: projectWarning.project })
                setProjectWarning(null)
              }}
            >
              Registrar de todas formas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

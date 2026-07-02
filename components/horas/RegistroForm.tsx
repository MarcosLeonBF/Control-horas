'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { guardarRegistro, type LineInput } from '@/app/(horas)/registrar/actions'
import { formatHoras } from '@/lib/horas/format'
import type { AreaRow, EtapaRow, DescripcionRow, DepartamentoRow } from '@/lib/horas/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { TriangleAlert } from 'lucide-react'
import ProjectCombobox from '@/components/horas/ProjectCombobox'

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const emptyLine = (areaId: string, date: string, dep: string): LineInput => ({ entry_date: date, project: '', area_id: areaId, department: dep, etapa_id: '', hours: 0, description: '' })

const field =
  'w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

export default function RegistroForm({ projects, finishedProjects, exceededProjects, areas, etapas, clientEtapas, descripciones, departamentos, internalAreaId, canBackdate = false, initial }: {
  projects: string[]; finishedProjects: string[]; exceededProjects: string[]; areas: AreaRow[]; etapas: EtapaRow[]; clientEtapas: EtapaRow[]; descripciones: DescripcionRow[]; departamentos: DepartamentoRow[]; internalAreaId: string
  canBackdate?: boolean // admin: puede registrar fuera del rango de 7 días (PDF §4)
  initial?: { id: string; lines: LineInput[] }
}) {
  const router = useRouter()
  const finishedSet = new Set(finishedProjects)
  const exceededSet = new Set(exceededProjects)
  // Confirmación al elegir un proyecto finalizado y/o con el banco excedido.
  const [projectWarning, setProjectWarning] = useState<{ index: number; project: string; finished: boolean; exceeded: boolean } | null>(null)
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

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <label htmlFor="fecha" className="text-sm font-medium text-foreground">Fecha por defecto</label>
        <Input
          id="fecha" type="date" value={defaultDate} max={today()} min={canBackdate ? undefined : daysAgo(7)}
          onChange={(e) => changeDefaultDate(e.target.value)} className="w-auto"
        />
        {!canBackdate && <span className="text-xs text-muted-foreground">Hasta 7 días atrás</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 pr-3 font-medium">Fecha</th>
              <th className="pb-1 pr-3 font-medium">Proyecto</th>
              <th className="pb-1 pr-3 font-medium">Departamento</th>
              <th className="pb-1 pr-3 font-medium">Etapa</th>
              <th className="pb-1 pr-3 font-medium">Horas</th>
              <th className="pb-1 pr-3 font-medium">Descripción</th>
              <th className="w-8 pb-1"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const isDep = isDepartamento(l.project)
              const currentDep = departamentos.find(d => d.name === l.department)
              const allowedEtapas = isDep && currentDep && currentDep.etapaIds.length > 0
                ? etapas.filter(e => currentDep.etapaIds.includes(e.id))
                : etapas
              // Proyecto cliente: etapas de la posición del usuario. En edición, si la
              // etapa ya guardada no está permitida, se incluye para no perderla.
              const lineClientEtapas = l.etapa_id && !clientEtapas.some(e => e.id === l.etapa_id)
                ? [...clientEtapas, ...etapas.filter(e => e.id === l.etapa_id)]
                : clientEtapas
              // Descripción (todas las líneas): opciones de la posición del usuario.
              // En edición, si la descripción guardada no está en la lista, se incluye
              // para no perderla (los registros viejos tenían texto libre).
              const lineDescripciones = l.description && !descripciones.some(d => d.name === l.description)
                ? [...descripciones, { id: `__cur_${i}`, name: l.description }]
                : descripciones

              return (
              <tr key={i}>
                <td className="min-w-37 pr-3 align-top">
                  <Input aria-label="Fecha" type="date" value={l.entry_date} max={today()} min={canBackdate ? undefined : daysAgo(7)}
                    onChange={(e) => update(i, { entry_date: e.target.value })} />
                </td>
                <td className="min-w-45 pr-3 align-top">
                  <ProjectCombobox
                    ariaLabel="Proyecto"
                    value={l.project}
                    projects={projects}
                    finishedProjects={finishedSet}
                    onValueChange={(v) => {
                      const finished = !!v && finishedSet.has(v)
                      const exceeded = !!v && exceededSet.has(v)
                      if (finished || exceeded) { setProjectWarning({ index: i, project: v, finished, exceeded }); return }
                      update(i, { project: v })
                    }}
                  />
                </td>
                <td className="min-w-32.5 pr-3 align-top">
                  {isDep ? (
                    departamentos.length === 0 ? (
                      <select aria-label="Departamento" value="" disabled className={field}>
                        <option value="">— Sin departamentos (contacta al admin) —</option>
                      </select>
                    ) : (
                      <select aria-label="Departamento" value={l.department}
                        onChange={(e) => update(i, { department: e.target.value })} className={field}>
                        {departamentos.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                      </select>
                    )
                  ) : (
                    <span className="flex h-9 items-center px-2.5 text-sm text-muted-foreground/50">Clientes</span>
                  )}
                </td>
                <td className="min-w-35 pr-3 align-top">
                  {isDep ? (
                    <span className="flex h-9 items-center px-2.5 text-sm text-muted-foreground/50">
                      {allowedEtapas[0]?.name ?? '— Etapa —'}
                    </span>
                  ) : lineClientEtapas.length === 0 ? (
                    <select aria-label="Etapa" value="" disabled className={field}>
                      <option value="">— Sin etapas asignadas (contacta al admin) —</option>
                    </select>
                  ) : (
                    <select aria-label="Etapa" value={l.etapa_id} onChange={(e) => update(i, { etapa_id: e.target.value })} className={field}>
                      <option value="">— Etapa —</option>
                      {lineClientEtapas.map((et) => <option key={et.id} value={et.id}>{et.name}</option>)}
                    </select>
                  )}
                </td>
                <td className="w-24 pr-3 align-top">
                  <Input aria-label="Horas" type="number" step="0.5" min="0" value={l.hours || ''}
                    onChange={(e) => update(i, { hours: Number(e.target.value) })} />
                </td>
                <td className="min-w-50 pr-3 align-top">
                  {lineDescripciones.length === 0 ? (
                    <select aria-label="Descripción" value="" disabled className={field}>
                      <option value="">— Sin descripciones (contacta al admin) —</option>
                    </select>
                  ) : (
                    <select aria-label="Descripción" value={l.description} onChange={(e) => update(i, { description: e.target.value })} className={field}>
                      <option value="">— Descripción —</option>
                      {lineDescripciones.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  )}
                </td>
                <td className="align-middle">
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                    disabled={lines.length === 1} aria-label="Eliminar línea" className="text-foreground/40 hover:text-(--status-excedido)">✕</Button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
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
                : projectWarning?.exceeded
                ? 'Banco de horas excedido'
                : 'Proyecto finalizado'}
            </DialogTitle>
            <DialogDescription>
              El proyecto <strong className="font-medium text-foreground">{projectWarning?.project}</strong>{' '}
              {projectWarning?.finished && projectWarning?.exceeded
                ? 'está marcado como finalizado y el banco de horas de tu posición está excedido.'
                : projectWarning?.exceeded
                ? 'tiene el banco de horas de tu posición excedido.'
                : 'está marcado como finalizado en el Excel.'}{' '}
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

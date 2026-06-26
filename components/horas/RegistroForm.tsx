'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { guardarRegistro, type LineInput } from '@/app/(horas)/registrar/actions'
import { formatHoras } from '@/lib/horas/format'
import type { AreaRow, EtapaRow } from '@/lib/horas/types'

const DEPARTAMENTOS = ['Clientes', 'Ventas', 'Marketing', 'Todos'] as const
const today = () => new Date().toISOString().slice(0, 10)
const emptyLine = (areaId: string): LineInput => ({ project: '', area_id: areaId, department: 'Clientes', etapa_id: '', hours: 0, description: '' })

const field =
  'w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

export default function RegistroForm({ projects, areas, etapas, internalAreaId, initial }: {
  projects: string[]; areas: AreaRow[]; etapas: EtapaRow[]; internalAreaId: string
  initial?: { id: string; entryDate: string; lines: LineInput[] }
}) {
  const router = useRouter()
  const [entryDate, setEntryDate] = useState(initial?.entryDate ?? today())
  const [lines, setLines] = useState<LineInput[]>(initial?.lines ?? [emptyLine(areas[0]?.id ?? '')])
  const [saving, setSaving] = useState(false)

  const total = lines.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const isDepartamento = (p: string) => p === 'Departamento'

  function update(i: number, patch: Partial<LineInput>) {
    setLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const next = { ...l, ...patch }
      if (patch.project !== undefined) {
        if (isDepartamento(patch.project)) { next.area_id = internalAreaId }
        else { next.department = 'Clientes'; if (next.area_id === internalAreaId) next.area_id = areas[0]?.id ?? '' }
      }
      return next
    }))
  }

  async function onSave() {
    setSaving(true)
    const res = await guardarRegistro(entryDate, lines, initial?.id ?? null)
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(initial ? 'Registro actualizado' : 'Registro guardado')
    router.push('/mis-registros')
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <label htmlFor="fecha" className="text-sm font-medium text-foreground">Fecha</label>
        <input
          id="fecha" type="date" value={entryDate} max={today()}
          onChange={(e) => setEntryDate(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 pr-3 font-medium">Proyecto</th>
              <th className="pb-1 pr-3 font-medium">Área</th>
              <th className="pb-1 pr-3 font-medium">Departamento</th>
              <th className="pb-1 pr-3 font-medium">Etapa</th>
              <th className="pb-1 pr-3 font-medium">Horas</th>
              <th className="pb-1 pr-3 font-medium">Descripción</th>
              <th className="w-8 pb-1"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="min-w-45 pr-3 align-top">
                  <select aria-label="Proyecto" value={l.project} onChange={(e) => update(i, { project: e.target.value })} className={field}>
                    <option value="">— Proyecto —</option>
                    {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td className="min-w-32.5 pr-3 align-top">
                  <select aria-label="Área" value={l.area_id} disabled={isDepartamento(l.project)}
                    onChange={(e) => update(i, { area_id: e.target.value })} className={field}>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </td>
                <td className="min-w-32.5 pr-3 align-top">
                  <select aria-label="Departamento" value={l.department} disabled={!isDepartamento(l.project)}
                    onChange={(e) => update(i, { department: e.target.value })} className={field}>
                    {DEPARTAMENTOS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </td>
                <td className="min-w-35 pr-3 align-top">
                  <select aria-label="Etapa" value={l.etapa_id} onChange={(e) => update(i, { etapa_id: e.target.value })} className={field}>
                    <option value="">— Etapa —</option>
                    {etapas.map((et) => <option key={et.id} value={et.id}>{et.name}</option>)}
                  </select>
                </td>
                <td className="w-24 pr-3 align-top">
                  <input aria-label="Horas" type="number" step="0.5" min="0" value={l.hours || ''}
                    onChange={(e) => update(i, { hours: Number(e.target.value) })} className={field} />
                </td>
                <td className="min-w-50 pr-3 align-top">
                  <input aria-label="Descripción" value={l.description}
                    onChange={(e) => update(i, { description: e.target.value })} placeholder="¿Qué hiciste?" className={field} />
                </td>
                <td className="align-middle">
                  <button type="button" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                    disabled={lines.length === 1} aria-label="Eliminar línea"
                    className="px-1 text-foreground/40 transition-colors hover:text-(--excedido) disabled:opacity-30">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <button type="button" onClick={() => setLines((p) => [...p, emptyLine(areas[0]?.id ?? '')])}
          className="text-sm font-medium text-(--brand) transition-colors hover:text-(--brand-strong)">+ Añadir línea</button>
        <span className="text-sm text-muted-foreground">
          Total del día: <strong className="tabular-money ml-1 text-base text-foreground">{formatHoras(total)}</strong>
        </span>
      </div>

      <button type="button" onClick={onSave} disabled={saving}
        className="mt-6 rounded-lg bg-(--brand) px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-(--brand-strong) disabled:cursor-not-allowed disabled:opacity-50">
        {saving ? 'Guardando…' : 'Guardar registro'}
      </button>
    </div>
  )
}

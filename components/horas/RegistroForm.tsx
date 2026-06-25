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
    <div className="space-y-4">
      <label className="block text-sm">Fecha
        <input type="date" value={entryDate} max={today()} onChange={(e) => setEntryDate(e.target.value)}
          className="ml-2 rounded border border-border px-2 py-1" />
      </label>

      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground">
          <th>Proyecto</th><th>Área</th><th>Departamento</th><th>Etapa</th><th>Horas</th><th>Descripción</th><th></th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <select aria-label="Proyecto" value={l.project} onChange={(e) => update(i, { project: e.target.value })}>
                  <option value="">— Proyecto —</option>
                  {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </td>
              <td>
                <select aria-label="Área" value={l.area_id} disabled={isDepartamento(l.project)}
                  onChange={(e) => update(i, { area_id: e.target.value })}>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </td>
              <td>
                <select aria-label="Departamento" value={l.department} disabled={!isDepartamento(l.project)}
                  onChange={(e) => update(i, { department: e.target.value })}>
                  {DEPARTAMENTOS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </td>
              <td>
                <select aria-label="Etapa" value={l.etapa_id} onChange={(e) => update(i, { etapa_id: e.target.value })}>
                  <option value="">— Etapa —</option>
                  {etapas.map((et) => <option key={et.id} value={et.id}>{et.name}</option>)}
                </select>
              </td>
              <td><input aria-label="Horas" type="number" step="0.5" min="0" value={l.hours || ''}
                onChange={(e) => update(i, { hours: Number(e.target.value) })} className="w-16" /></td>
              <td><input aria-label="Descripción" value={l.description}
                onChange={(e) => update(i, { description: e.target.value })} className="w-full" /></td>
              <td><button type="button" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                disabled={lines.length === 1} aria-label="Eliminar línea">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setLines((p) => [...p, emptyLine(areas[0]?.id ?? '')])}
          className="text-sm text-brand">+ Añadir línea</button>
        <span className="tabular-money text-sm">Total del día: <strong>{formatHoras(total)}</strong></span>
      </div>

      <button type="button" onClick={onSave} disabled={saving}
        className="rounded bg-brand px-4 py-2 text-white">{saving ? 'Guardando…' : 'Guardar registro'}</button>
    </div>
  )
}

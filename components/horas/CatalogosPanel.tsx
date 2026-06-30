'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  crearArea, renombrarArea, toggleArea,
  crearEtapa, renombrarEtapa, toggleEtapa,
  crearDepartamento, renombrarDepartamento, toggleDepartamento,
  crearPosicion, renombrarPosicion, togglePosicion, setPosicionAreas,
} from '@/app/(horas)/admin/catalogos/actions'

export interface CatalogoRow { id: string; name: string; active: boolean; is_internal?: boolean }
export interface PosicionRow { id: string; name: string; active: boolean; areaIds: string[] }

type Result = { ok: true } | { ok: false; error: string }
interface Ops {
  crear: (name: string) => Promise<Result>
  renombrar: (id: string, name: string) => Promise<Result>
  toggle: (id: string, active: boolean) => Promise<Result>
}

function useRun() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function run(p: Promise<Result>, okMsg: string): Promise<boolean> {
    setBusy(true)
    const res = await p
    setBusy(false)
    if (!res.ok) { toast.error(res.error); return false }
    toast.success(okMsg); router.refresh(); return true
  }
  return { busy, run }
}

function Seccion({ title, rows, ops, addPlaceholder }: { title: string; rows: CatalogoRow[]; ops: Ops; addPlaceholder: string }) {
  const { busy, run } = useRun()
  const [nuevo, setNuevo] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')

  async function add() {
    if (!nuevo.trim()) return
    if (await run(ops.crear(nuevo), 'Añadido')) setNuevo('')
  }
  async function saveEdit(id: string) {
    if (await run(ops.renombrar(id, editVal), 'Renombrado')) setEditingId(null)
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">{title}</h2>

      <div className="mt-4 flex gap-2">
        <Input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder={addPlaceholder}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
        <Button onClick={add} disabled={busy || !nuevo.trim()}>Añadir</Button>
      </div>

      <ul className="mt-4 divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-2.5">
            {editingId === r.id ? (
              <>
                <Input value={editVal} onChange={(e) => setEditVal(e.target.value)} className="h-8 max-w-xs" autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(r.id); if (e.key === 'Escape') setEditingId(null) }} />
                <Button size="sm" onClick={() => saveEdit(r.id)} disabled={busy}>Guardar</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
              </>
            ) : (
              <>
                <span className={`flex-1 text-sm ${r.active ? '' : 'text-muted-foreground line-through'}`}>{r.name}</span>
                {r.is_internal && <Badge variant="secondary">interna</Badge>}
                {!r.active && <Badge variant="outline">inactiva</Badge>}
                {r.is_internal ? (
                  <span className="px-2 text-xs text-muted-foreground">fija</span>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingId(r.id); setEditVal(r.name) }}>Renombrar</Button>
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => run(ops.toggle(r.id, !r.active), r.active ? 'Desactivado' : 'Activado')}>
                      {r.active ? 'Desactivar' : 'Activar'}
                    </Button>
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function PosicionesSection({ posiciones, areas }: { posiciones: PosicionRow[]; areas: CatalogoRow[] }) {
  const { busy, run } = useRun()
  const selectableAreas = areas.filter((a) => !a.is_internal)
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? ''
  const [nuevo, setNuevo] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const [areasFor, setAreasFor] = useState<string | null>(null)
  const [areaSel, setAreaSel] = useState<string[]>([])

  async function add() {
    if (!nuevo.trim()) return
    if (await run(crearPosicion(nuevo), 'Posición añadida')) setNuevo('')
  }
  async function saveEdit(id: string) {
    if (await run(renombrarPosicion(id, editVal), 'Renombrada')) setEditingId(null)
  }
  async function saveAreas(id: string) {
    if (await run(setPosicionAreas(id, areaSel), 'Áreas actualizadas')) setAreasFor(null)
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">Posiciones</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        El banco de horas es por posición (columnas del Excel). Liga cada una a sus áreas: un manager verá los bancos de las posiciones de sus áreas.
      </p>

      <div className="mt-4 flex gap-2">
        <Input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Nueva posición… (debe coincidir con la columna del Excel)"
          onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
        <Button onClick={add} disabled={busy || !nuevo.trim()}>Añadir</Button>
      </div>

      <ul className="mt-4 divide-y divide-border">
        {posiciones.map((p) => (
          <li key={p.id} className="py-2.5">
            <div className="flex items-center gap-2">
              {editingId === p.id ? (
                <>
                  <Input value={editVal} onChange={(e) => setEditVal(e.target.value)} className="h-8 max-w-xs" autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(p.id); if (e.key === 'Escape') setEditingId(null) }} />
                  <Button size="sm" onClick={() => saveEdit(p.id)} disabled={busy}>Guardar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
                </>
              ) : (
                <>
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <span className={`text-sm font-medium ${p.active ? '' : 'text-muted-foreground line-through'}`}>{p.name}</span>
                    {p.areaIds.length === 0
                      ? <Badge variant="outline" className="text-(--status-excedido)">sin áreas</Badge>
                      : p.areaIds.map((id) => <Badge key={id} variant="secondary">{areaName(id)}</Badge>)}
                    {!p.active && <Badge variant="outline">inactiva</Badge>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => { setAreasFor(areasFor === p.id ? null : p.id); setAreaSel(p.areaIds) }}>Áreas</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingId(p.id); setEditVal(p.name) }}>Renombrar</Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => run(togglePosicion(p.id, !p.active), p.active ? 'Desactivada' : 'Activada')}>
                    {p.active ? 'Desactivar' : 'Activar'}
                  </Button>
                </>
              )}
            </div>

            {areasFor === p.id && (
              <div className="mt-3 rounded-lg border border-border bg-(--muted-surface) p-3">
                <p className="mb-2 text-xs text-muted-foreground">Áreas de esta posición</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {selectableAreas.map((a) => (
                    <label key={a.id} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={areaSel.includes(a.id)}
                        onChange={(e) => setAreaSel((prev) => e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id))} />
                      {a.name}
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => saveAreas(p.id)} disabled={busy}>Guardar áreas</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAreasFor(null)}>Cancelar</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function CatalogosPanel({ areas, etapas, departamentos, posiciones }: {
  areas: CatalogoRow[]; etapas: CatalogoRow[]; departamentos: CatalogoRow[]; posiciones: PosicionRow[]
}) {
  return (
    <div className="space-y-6">
      <PosicionesSection posiciones={posiciones} areas={areas} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Seccion title="Áreas" rows={areas} addPlaceholder="Nueva área…"
          ops={{ crear: crearArea, renombrar: renombrarArea, toggle: toggleArea }} />
        <Seccion title="Etapas" rows={etapas} addPlaceholder="Nueva etapa…"
          ops={{ crear: crearEtapa, renombrar: renombrarEtapa, toggle: toggleEtapa }} />
        <Seccion title="Departamentos" rows={departamentos} addPlaceholder="Nuevo departamento…"
          ops={{ crear: crearDepartamento, renombrar: renombrarDepartamento, toggle: toggleDepartamento }} />
      </div>
    </div>
  )
}

'use client'
import { useState, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  crearArea, renombrarArea, toggleArea, eliminarArea,
  crearEtapa, renombrarEtapa, toggleEtapa, eliminarEtapa,
  crearDescripcion, renombrarDescripcion, toggleDescripcion, eliminarDescripcion,
  crearDepartamento, renombrarDepartamento, toggleDepartamento, eliminarDepartamento, setDepartamentoEtapasNombres,
  crearPosicion, renombrarPosicion, togglePosicion, eliminarPosicion, setPosicionAreas, setPosicionEtapas, setPosicionDepartamentos,
} from '@/app/(horas)/admin/catalogos/actions'
import type { DepartamentoRow } from '@/lib/horas/types'

export interface CatalogoRow { id: string; name: string; active: boolean; is_internal?: boolean }
export interface PosicionRow { id: string; name: string; active: boolean; areaIds: string[]; etapaIds: string[]; departamentoIds: string[] }

type Result = { ok: true } | { ok: false; error: string }
interface Ops {
  crear: (name: string) => Promise<Result>
  renombrar: (id: string, name: string) => Promise<Result>
  toggle: (id: string, active: boolean) => Promise<Result>
  eliminar: (id: string) => Promise<Result>
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
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5">
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
                    <Button size="sm" variant="ghost" disabled={busy}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => { if (confirm(`¿Eliminar "${r.name}" definitivamente? Esta acción no se puede deshacer.`)) run(ops.eliminar(r.id), 'Eliminado') }}>
                      Eliminar
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

// Tarjeta de edición por chips ("escribe y Enter"), reutilizada por Etapas y Descripciones
// dentro del acordeón de un departamento. Mantiene el lenguaje visual de las tarjetas de Posiciones.
function ChipCard({ dot, title, hint, chips, setChips, value, setValue, onSave, busy, emptyLabel }: {
  dot: ReactNode; title: string; hint: string
  chips: string[]; setChips: Dispatch<SetStateAction<string[]>>
  value: string; setValue: (v: string) => void; onSave: () => void; busy: boolean; emptyLabel: string
}) {
  function addChip() {
    const v = value.trim()
    if (v && !chips.some((n) => n.toLowerCase() === v.toLowerCase())) setChips((prev) => [...prev, v])
    setValue('')
  }
  return (
    <div className="rounded-xl border border-border bg-(--muted-surface) p-4">
      <div className="flex flex-wrap items-center gap-2">
        {dot}
        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/70">{title}</h4>
      </div>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {chips.length === 0 && <span className="text-sm text-muted-foreground">{emptyLabel}</span>}
        {chips.map((name) => (
          <Badge key={name} variant="secondary" className="gap-1 pr-1.5 text-sm font-normal">
            {name}
            <button onClick={() => setChips((prev) => prev.filter((n) => n !== name))}
              className="p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Quitar ${name}`}>
              <span className="block text-[10px] leading-none">✕</span>
            </button>
          </Badge>
        ))}
      </div>
      <Input value={value} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip() } }}
        placeholder="Escribe y presiona Enter…" className="mt-3 h-9 max-w-sm bg-background text-sm" />
      <Button size="sm" className="mt-4" onClick={onSave} disabled={busy}>Guardar</Button>
    </div>
  )
}

function PosicionesSection({ posiciones, areas, etapas, departamentos, departmentEtapaIds }: { posiciones: PosicionRow[]; areas: CatalogoRow[]; etapas: CatalogoRow[]; departamentos: DepartamentoRow[]; departmentEtapaIds: Set<string> }) {
  const { busy, run } = useRun()
  const selectableAreas = areas.filter((a) => !a.is_internal)
  // Etapas asignables a una posición = generales (activas). Se excluyen las etapas
  // de departamento, que son exclusivas del proyecto "Departamento".
  const selectableEtapas = etapas.filter((e) => e.active && !departmentEtapaIds.has(e.id))
  const selectableDepartamentos = departamentos.filter((d) => d.active)
  const [nuevo, setNuevo] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [areaSel, setAreaSel] = useState<string[]>([])
  const [etapaSel, setEtapaSel] = useState<string[]>([])
  const [departamentoSel, setDepartamentoSel] = useState<string[]>([])

  function toggleExpand(p: PosicionRow) {
    if (expandedId === p.id) { setExpandedId(null); return }
    setExpandedId(p.id); setAreaSel(p.areaIds); setEtapaSel(p.etapaIds); setDepartamentoSel(p.departamentoIds)
  }

  async function add() {
    if (!nuevo.trim()) return
    if (await run(crearPosicion(nuevo), 'Posición añadida')) setNuevo('')
  }
  async function saveEdit(id: string) {
    if (await run(renombrarPosicion(id, editVal), 'Renombrada')) setEditingId(null)
  }
  async function saveAreas(id: string) {
    await run(setPosicionAreas(id, areaSel), 'Áreas actualizadas')
  }
  async function saveEtapas(id: string) {
    await run(setPosicionEtapas(id, etapaSel), 'Etapas actualizadas')
  }
  async function saveDepartamentos(id: string) {
    await run(setPosicionDepartamentos(id, departamentoSel), 'Departamentos actualizados')
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">Posiciones</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        El banco de horas es por posición (columnas del Excel). Abre cada una para ligar las áreas a las que pertenece (definen en qué áreas registra y qué bancos ve un manager) y las etapas que sus usuarios podrán elegir al registrar.
      </p>

      <div className="mt-4 flex gap-2">
        <Input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Nueva posición… (debe coincidir con la columna del Excel)"
          onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
        <Button onClick={add} disabled={busy || !nuevo.trim()}>Añadir</Button>
      </div>

      <ul className="mt-4 divide-y divide-border">
        {posiciones.map((p) => (
          <li key={p.id} className="py-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {editingId === p.id ? (
                <>
                  <Input value={editVal} onChange={(e) => setEditVal(e.target.value)} className="h-8 max-w-xs" autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(p.id); if (e.key === 'Escape') setEditingId(null) }} />
                  <Button size="sm" onClick={() => saveEdit(p.id)} disabled={busy}>Guardar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => toggleExpand(p)} aria-expanded={expandedId === p.id}
                    className="group flex flex-1 items-center gap-2 rounded-md py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronRight className={`size-4 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-hover:text-foreground ${expandedId === p.id ? 'rotate-90' : ''}`} />
                    <span className={`text-sm font-medium ${p.active ? '' : 'text-muted-foreground line-through'}`}>{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.areaIds.length === 0
                        ? <span className="text-(--status-excedido)">Sin áreas</span>
                        : <>{p.areaIds.length} {p.areaIds.length === 1 ? 'área' : 'áreas'}</>}
                      <span className="px-1 text-foreground/25">·</span>
                      {p.etapaIds.length === 0
                        ? <span className="text-foreground/40">Sin etapas</span>
                        : <>{p.etapaIds.length} {p.etapaIds.length === 1 ? 'etapa' : 'etapas'}</>}
                      <span className="px-1 text-foreground/25">·</span>
                      {p.departamentoIds.length === 0
                        ? <span className="text-foreground/40">Sin departamentos</span>
                        : <>{p.departamentoIds.length} {p.departamentoIds.length === 1 ? 'departamento' : 'departamentos'}</>}
                    </span>
                    {!p.active && <Badge variant="outline" className="text-muted-foreground">inactiva</Badge>}
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingId(p.id); setEditVal(p.name) }}>Renombrar</Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => run(togglePosicion(p.id, !p.active), p.active ? 'Desactivada' : 'Activada')}>
                    {p.active ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => { if (confirm(`¿Eliminar la posición "${p.name}"? Se desasignará de los usuarios que la tengan. No se puede deshacer.`)) run(eliminarPosicion(p.id), 'Posición eliminada') }}>
                    Eliminar
                  </Button>
                </>
              )}
            </div>

            {expandedId === p.id && (
              <div className="mt-2 mb-1 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl border border-border bg-(--muted-surface) p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full bg-(--brand)" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Áreas</h4>
                  </div>
                  <p className="mt-1 mb-3 text-xs text-muted-foreground">Área(s) a la(s) que pertenece la posición: definen en qué áreas registra horas y qué bancos ve un manager.</p>
                  <div className="flex flex-col gap-2">
                    {selectableAreas.map((a) => (
                      <label key={a.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground/80 hover:text-foreground">
                        <input type="checkbox" className="size-4 accent-(--brand)" checked={areaSel.includes(a.id)}
                          onChange={(e) => setAreaSel((prev) => e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id))} />
                        {a.name}
                      </label>
                    ))}
                  </div>
                  <Button size="sm" className="mt-4" onClick={() => saveAreas(p.id)} disabled={busy}>Guardar áreas</Button>
                </div>

                <div className="rounded-xl border border-border bg-(--muted-surface) p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="size-2 shrink-0 rounded-[3px] bg-foreground/40" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Etapas</h4>
                  </div>
                  <p className="mt-1 mb-3 text-xs text-muted-foreground">Seleccionables al registrar en proyecto cliente.</p>
                  {selectableEtapas.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay etapas activas en el catálogo.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {selectableEtapas.map((e) => (
                        <label key={e.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground/80 hover:text-foreground">
                          <input type="checkbox" className="size-4 accent-(--brand)" checked={etapaSel.includes(e.id)}
                            onChange={(ev) => setEtapaSel((prev) => ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id))} />
                          {e.name}
                        </label>
                      ))}
                    </div>
                  )}
                  <Button size="sm" className="mt-4" onClick={() => saveEtapas(p.id)} disabled={busy}>Guardar etapas</Button>
                </div>

                <div className="rounded-xl border border-border bg-(--muted-surface) p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full border border-foreground/45" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Departamentos</h4>
                  </div>
                  <p className="mt-1 mb-3 text-xs text-muted-foreground">Seleccionables al registrar en el proyecto interno &quot;Departamento&quot;.</p>
                  {selectableDepartamentos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay departamentos activos en el catálogo.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {selectableDepartamentos.map((d) => (
                        <label key={d.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground/80 hover:text-foreground">
                          <input type="checkbox" className="size-4 shrink-0 accent-(--brand)" checked={departamentoSel.includes(d.id)}
                            onChange={(ev) => setDepartamentoSel((prev) => ev.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id))} />
                          {d.name}
                        </label>
                      ))}
                    </div>
                  )}
                  <Button size="sm" className="mt-4" onClick={() => saveDepartamentos(p.id)} disabled={busy}>Guardar departamentos</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function DepartamentosSection({ departamentos, etapas }: { departamentos: DepartamentoRow[]; etapas: CatalogoRow[] }) {
  const { busy, run } = useRun()
  const etapaName = (id: string) => etapas.find((e) => e.id === id)?.name ?? ''
  const [nuevo, setNuevo] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [etapaSel, setEtapaSel] = useState<string[]>([])
  const [newEtapa, setNewEtapa] = useState('')

  function toggleExpand(d: DepartamentoRow) {
    if (expandedId === d.id) { setExpandedId(null); return }
    setExpandedId(d.id)
    setEtapaSel(d.etapaIds.map((id) => etapaName(id)).filter(Boolean))
    setNewEtapa('')
  }

  async function add() {
    if (!nuevo.trim()) return
    if (await run(crearDepartamento(nuevo), 'Departamento añadido')) setNuevo('')
  }
  async function saveEdit(id: string) {
    if (await run(renombrarDepartamento(id, editVal), 'Renombrado')) setEditingId(null)
  }
  async function saveEtapas(id: string) {
    const pending = newEtapa.trim()
    const names = pending && !etapaSel.some((n) => n.toLowerCase() === pending.toLowerCase()) ? [...etapaSel, pending] : etapaSel
    if (await run(setDepartamentoEtapasNombres(id, names), 'Etapas actualizadas')) setNewEtapa('')
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold">Departamentos</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Solo aplican al proyecto interno &quot;Departamento&quot;. Abre cada uno para definir sus etapas. Las descripciones del proyecto Departamento son generales y se gestionan en la sección &quot;Descripciones&quot;.
      </p>

      <div className="mt-4 flex gap-2">
        <Input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Nuevo departamento…"
          onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
        <Button onClick={add} disabled={busy || !nuevo.trim()}>Añadir</Button>
      </div>

      <ul className="mt-4 divide-y divide-border">
        {departamentos.map((d) => (
          <li key={d.id} className="py-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {editingId === d.id ? (
                <>
                  <Input value={editVal} onChange={(e) => setEditVal(e.target.value)} className="h-8 max-w-xs" autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(d.id); if (e.key === 'Escape') setEditingId(null) }} />
                  <Button size="sm" onClick={() => saveEdit(d.id)} disabled={busy}>Guardar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => toggleExpand(d)} aria-expanded={expandedId === d.id}
                    className="group flex flex-1 items-center gap-2 rounded-md py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronRight className={`size-4 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-hover:text-foreground ${expandedId === d.id ? 'rotate-90' : ''}`} />
                    <span className={`text-sm font-medium ${d.active ? '' : 'text-muted-foreground line-through'}`}>{d.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.etapaIds.length === 0
                        ? <span className="text-foreground/40">Sin etapas</span>
                        : <>{d.etapaIds.length} {d.etapaIds.length === 1 ? 'etapa' : 'etapas'}</>}
                    </span>
                    {!d.active && <Badge variant="outline" className="text-muted-foreground">inactivo</Badge>}
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingId(d.id); setEditVal(d.name) }}>Renombrar</Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => run(toggleDepartamento(d.id, !d.active), d.active ? 'Desactivado' : 'Activado')}>
                    {d.active ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => { if (confirm(`¿Eliminar el departamento "${d.name}"? No se puede deshacer.`)) run(eliminarDepartamento(d.id), 'Departamento eliminado') }}>
                    Eliminar
                  </Button>
                </>
              )}
            </div>

            {expandedId === d.id && (
              <div className="mt-2 mb-1 grid gap-3 sm:grid-cols-2">
                <ChipCard
                  dot={<span className="size-2 shrink-0 rounded-[3px] bg-foreground/40" />}
                  title="Etapas" hint="Etapas de este departamento (se derivan al registrar en Departamento)."
                  chips={etapaSel} setChips={setEtapaSel} value={newEtapa} setValue={setNewEtapa}
                  onSave={() => saveEtapas(d.id)} busy={busy} emptyLabel="Ninguna etapa todavía." />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function CatalogosPanel({ areas, etapas, descripciones, departamentos, posiciones }: {
  areas: CatalogoRow[]; etapas: CatalogoRow[]; descripciones: CatalogoRow[]; departamentos: DepartamentoRow[]; posiciones: PosicionRow[]
}) {
  // Etapas ligadas a un departamento: exclusivas del proyecto "Departamento", no
  // asignables a posiciones (las de posición son las etapas generales).
  const departmentEtapaIds = new Set(departamentos.flatMap((d) => d.etapaIds))
  return (
    <div className="space-y-6">
      <PosicionesSection posiciones={posiciones} areas={areas} etapas={etapas} departamentos={departamentos} departmentEtapaIds={departmentEtapaIds} />

      <DepartamentosSection departamentos={departamentos} etapas={etapas} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Seccion title="Áreas" rows={areas} addPlaceholder="Nueva área…"
          ops={{ crear: crearArea, renombrar: renombrarArea, toggle: toggleArea, eliminar: eliminarArea }} />
        <Seccion title="Etapas" rows={etapas} addPlaceholder="Nueva etapa…"
          ops={{ crear: crearEtapa, renombrar: renombrarEtapa, toggle: toggleEtapa, eliminar: eliminarEtapa }} />
        <Seccion title="Descripciones" rows={descripciones} addPlaceholder="Nueva descripción…"
          ops={{ crear: crearDescripcion, renombrar: renombrarDescripcion, toggle: toggleDescripcion, eliminar: eliminarDescripcion }} />
      </div>
    </div>
  )
}

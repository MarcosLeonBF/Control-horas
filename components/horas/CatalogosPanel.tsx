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
} from '@/app/(horas)/admin/catalogos/actions'

export interface CatalogoRow { id: string; name: string; active: boolean; is_internal?: boolean }

const DEPARTAMENTOS = ['Clientes', 'Ventas', 'Marketing', 'Todos']

type Result = { ok: true } | { ok: false; error: string }
interface Ops {
  crear: (name: string) => Promise<Result>
  renombrar: (id: string, name: string) => Promise<Result>
  toggle: (id: string, active: boolean) => Promise<Result>
}

function Seccion({ title, rows, ops, addPlaceholder }: { title: string; rows: CatalogoRow[]; ops: Ops; addPlaceholder: string }) {
  const router = useRouter()
  const [nuevo, setNuevo] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')

  async function run(p: Promise<Result>, okMsg: string): Promise<boolean> {
    setBusy(true)
    const res = await p
    setBusy(false)
    if (!res.ok) { toast.error(res.error); return false }
    toast.success(okMsg); router.refresh(); return true
  }

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

export default function CatalogosPanel({ areas, etapas }: { areas: CatalogoRow[]; etapas: CatalogoRow[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Seccion title="Áreas" rows={areas} addPlaceholder="Nueva área…"
        ops={{ crear: crearArea, renombrar: renombrarArea, toggle: toggleArea }} />
      <Seccion title="Etapas" rows={etapas} addPlaceholder="Nueva etapa…"
        ops={{ crear: crearEtapa, renombrar: renombrarEtapa, toggle: toggleEtapa }} />

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
        <h2 className="font-display text-lg font-semibold">Departamentos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Fijos por especificación: aplican al trabajo interno del proyecto «Departamento».
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEPARTAMENTOS.map((d) => <Badge key={d} variant="secondary">{d}</Badge>)}
        </div>
      </section>
    </div>
  )
}

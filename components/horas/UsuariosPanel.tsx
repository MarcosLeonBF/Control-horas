'use client'
import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { actualizarUsuario, cambiarEstadoUsuario, type EdicionUsuario } from '@/app/(horas)/admin/usuarios/actions'
import type { AreaRow } from '@/lib/horas/types'

export interface UsuarioRow {
  id: string; full_name: string; email: string; position: string | null
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'; areaIds: string[]
}

const field = 'w-full rounded border border-border px-2.5 py-1.5 text-sm'

function Editor({ u, areas, onDone }: { u: UsuarioRow; areas: AreaRow[]; onDone: () => void }) {
  const router = useRouter()
  const [f, setF] = useState<EdicionUsuario>({
    full_name: u.full_name, position: u.position ?? '', role: u.role, status: u.status, areaIds: u.areaIds,
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const res = await actualizarUsuario(u.id, f)
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Usuario actualizado')
    onDone(); router.refresh()
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-(--muted-surface) p-4 sm:grid-cols-2">
      <label className="text-xs text-muted-foreground">Nombre
        <input aria-label="Editar nombre" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} className={field} />
      </label>
      <label className="text-xs text-muted-foreground">Posición
        <input aria-label="Editar posición" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} className={field} />
      </label>
      <label className="text-xs text-muted-foreground">Rol
        <select aria-label="Editar rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as EdicionUsuario['role'] })} className={field}>
          <option value="operativo">operativo</option><option value="manager">manager</option><option value="admin">admin</option>
        </select>
      </label>
      <label className="text-xs text-muted-foreground">Estado
        <select aria-label="Editar estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as EdicionUsuario['status'] })} className={field}>
          <option value="activo">activo</option><option value="inactivo">inactivo</option>
        </select>
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="text-xs text-muted-foreground">Áreas</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {areas.filter((a) => !a.is_internal).map((a) => (
            <label key={a.id} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={f.areaIds.includes(a.id)}
                onChange={(e) => setF({ ...f, areaIds: e.target.checked ? [...f.areaIds, a.id] : f.areaIds.filter((x) => x !== a.id) })} />
              {a.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2 sm:col-span-2">
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-(--brand) px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-(--brand-strong) disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={onDone} className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground/70 hover:text-foreground">Cancelar</button>
      </div>
    </div>
  )
}

export default function UsuariosPanel({ usuarios, areas }: { usuarios: UsuarioRow[]; areas: AreaRow[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? ''

  async function toggle(u: UsuarioRow) {
    setBusy(u.id)
    const res = await cambiarEstadoUsuario(u.id, u.status === 'activo' ? 'inactivo' : 'activo')
    setBusy(null)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(u.status === 'activo' ? 'Usuario desactivado' : 'Usuario activado')
    router.refresh()
  }

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-(--muted-surface) text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Usuario</th>
            <th className="px-4 py-2.5 font-medium">Posición</th>
            <th className="px-4 py-2.5 font-medium">Rol</th>
            <th className="px-4 py-2.5 font-medium">Áreas</th>
            <th className="px-4 py-2.5 font-medium">Estado</th>
            <th className="px-4 py-2.5 font-medium text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <Fragment key={u.id}>
              <tr className="border-t border-border">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-foreground">{u.full_name}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-4 py-2.5 text-foreground/70">{u.position || '—'}</td>
                <td className="px-4 py-2.5 text-foreground/70">{u.role}</td>
                <td className="px-4 py-2.5 text-foreground/70">{u.areaIds.map(areaName).filter(Boolean).join(', ') || '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    u.status === 'activo' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-neutral-100 text-neutral-500 ring-neutral-400/20'}`}>
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => setEditing(editing === u.id ? null : u.id)}
                    className="text-(--brand) transition-colors hover:underline">Editar</button>
                  <button onClick={() => toggle(u)} disabled={busy === u.id}
                    className="ml-3 text-foreground/60 transition-colors hover:text-foreground disabled:opacity-50">
                    {u.status === 'activo' ? 'Desactivar' : 'Activar'}
                  </button>
                </td>
              </tr>
              {editing === u.id && (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-4 py-3"><Editor u={u} areas={areas} onDone={() => setEditing(null)} /></td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

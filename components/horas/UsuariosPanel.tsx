'use client'
import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { actualizarUsuario, cambiarEstadoUsuario, type EdicionUsuario } from '@/app/(horas)/admin/usuarios/actions'
import type { AreaRow } from '@/lib/horas/types'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

export interface UsuarioRow {
  id: string; full_name: string; email: string; position: string | null
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'; areaIds: string[]
}

const selectClass = 'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

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
      <label className="space-y-1 text-xs text-muted-foreground">Nombre
        <Input aria-label="Editar nombre" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} className="h-9" />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Posición
        <Input aria-label="Editar posición" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} className="h-9" />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Rol
        <select aria-label="Editar rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as EdicionUsuario['role'] })} className={selectClass}>
          <option value="operativo">operativo</option><option value="manager">manager</option><option value="admin">admin</option>
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Estado
        <select aria-label="Editar estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as EdicionUsuario['status'] })} className={selectClass}>
          <option value="activo">activo</option><option value="inactivo">inactivo</option>
        </select>
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="text-xs text-muted-foreground">Áreas</legend>
        {f.role === 'manager' && (
          <p className="mb-1 text-xs text-foreground/55">
            El manager gestiona estas áreas: verá los registros, bancos y reportes de los usuarios que las tengan asignadas.
          </p>
        )}
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
        <Button onClick={save} disabled={saving} size="lg">{saving ? 'Guardando…' : 'Guardar'}</Button>
        <Button onClick={onDone} variant="outline" size="lg">Cancelar</Button>
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
      <Table>
        <TableHeader>
          <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
            <TableHead>Usuario</TableHead>
            <TableHead>Posición</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Áreas</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usuarios.map((u) => (
            <Fragment key={u.id}>
              <TableRow>
                <TableCell className="py-3">
                  <div className="font-medium text-foreground">{u.full_name}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell className="py-3 text-foreground/70">{u.position || '—'}</TableCell>
                <TableCell className="py-3 text-foreground/70 capitalize">{u.role}</TableCell>
                <TableCell className="py-3 text-foreground/70">{u.areaIds.map(areaName).filter(Boolean).join(', ') || '—'}</TableCell>
                <TableCell className="py-3">
                  <Badge className={`capitalize ${u.status === 'activo' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>{u.status}</Badge>
                </TableCell>
                <TableCell className="py-3 text-right">
                  <Button variant="link" size="sm" className="px-1" onClick={() => setEditing(editing === u.id ? null : u.id)}>Editar</Button>
                  <Button variant="ghost" size="sm" disabled={busy === u.id} onClick={() => toggle(u)}>
                    {u.status === 'activo' ? 'Desactivar' : 'Activar'}
                  </Button>
                </TableCell>
              </TableRow>
              {editing === u.id && (
                <TableRow>
                  <TableCell colSpan={6} className="py-3"><Editor u={u} areas={areas} onDone={() => setEditing(null)} /></TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

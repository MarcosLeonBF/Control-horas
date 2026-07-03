'use client'
import { Fragment, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { actualizarUsuario, cambiarEstadoUsuario, type EdicionUsuario } from '@/app/(horas)/admin/usuarios/actions'
import type { AreaRow } from '@/lib/horas/types'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import NativeSelect from '@/components/ui/native-select'
import { Badge } from '@/components/ui/badge'

export interface PosicionOpt { id: string; name: string }
export interface UsuarioRow {
  id: string; full_name: string; email: string; positionId: string | null
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'; areaIds: string[]
}

const fieldSelect = 'h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '·'
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Editor({ u, areas, posiciones, onDone }: { u: UsuarioRow; areas: AreaRow[]; posiciones: PosicionOpt[]; onDone: () => void }) {
  const router = useRouter()
  const [f, setF] = useState<EdicionUsuario>({
    full_name: u.full_name, positionId: u.positionId ?? '', role: u.role, status: u.status, areaIds: u.areaIds,
  })
  const [saving, setSaving] = useState(false)
  const selectableAreas = areas.filter((a) => !a.is_internal)

  async function save() {
    setSaving(true)
    const res = await actualizarUsuario(u.id, f)
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Usuario actualizado')
    onDone(); router.refresh()
  }

  return (
    <div className="rounded-xl border border-border bg-(--muted-surface) p-5 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--brand)/10 text-xs font-semibold text-(--brand-strong)">
          {initials(f.full_name || u.full_name)}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Editar usuario</p>
          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre">
          <Input aria-label="Editar nombre" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} className="h-9" />
        </Field>
        <Field label="Posición (banco de horas)">
          <NativeSelect aria-label="Editar posición" value={f.positionId} onChange={(e) => setF({ ...f, positionId: e.target.value })} className={fieldSelect} fullWidth>
            <option value="">— Sin posición —</option>
            {posiciones.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Rol">
          <NativeSelect aria-label="Editar rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as EdicionUsuario['role'] })} className={fieldSelect} fullWidth>
            <option value="operativo">Operativo</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </NativeSelect>
        </Field>
        <Field label="Estado">
          <NativeSelect aria-label="Editar estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as EdicionUsuario['status'] })} className={fieldSelect} fullWidth>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </NativeSelect>
        </Field>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-(--brand)" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Áreas</h4>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {f.role === 'manager'
            ? 'El manager gestiona estas áreas: verá los registros, bancos y reportes de los usuarios que las tengan asignadas.'
            : 'Áreas asignadas al usuario.'}
        </p>
        {selectableAreas.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No hay áreas en el catálogo.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {selectableAreas.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2 text-sm text-foreground/80 hover:text-foreground">
                <input type="checkbox" className="size-4 accent-(--brand)" checked={f.areaIds.includes(a.id)}
                  onChange={(e) => setF({ ...f, areaIds: e.target.checked ? [...f.areaIds, a.id] : f.areaIds.filter((x) => x !== a.id) })} />
                {a.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex gap-2">
        <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button>
        <Button onClick={onDone} variant="outline">Cancelar</Button>
      </div>
    </div>
  )
}

export default function UsuariosPanel({ usuarios, areas, posiciones }: { usuarios: UsuarioRow[]; areas: AreaRow[]; posiciones: PosicionOpt[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? ''
  const posName = (id: string | null) => (id ? posiciones.find((p) => p.id === id)?.name ?? '—' : '—')

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
                <TableCell className="py-3 text-foreground/70">{posName(u.positionId)}</TableCell>
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
                  <TableCell colSpan={6} className="py-3"><Editor u={u} areas={areas} posiciones={posiciones} onDone={() => setEditing(null)} /></TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

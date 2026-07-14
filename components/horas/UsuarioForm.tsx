'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { crearUsuario, type NuevoUsuario } from '@/app/(horas)/admin/usuarios/actions'
import type { AreaRow } from '@/lib/horas/types'
import type { PosicionOpt } from '@/components/horas/UsuariosPanel'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import NativeSelect from '@/components/ui/native-select'

const selectClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

export default function UsuarioForm({ areas, posiciones, allowAdminRole = true }: { areas: AreaRow[]; posiciones: PosicionOpt[]; allowAdminRole?: boolean }) {
  const [f, setF] = useState<NuevoUsuario>({ full_name: '', email: '', password: '', positionId: '', role: 'operativo', areaIds: [] })
  const [saving, setSaving] = useState(false)
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const res = await crearUsuario(f); setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Usuario creado')
    setF({ full_name: '', email: '', password: '', positionId: '', role: 'operativo', areaIds: [] })
  }
  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <Input aria-label="Nombre" placeholder="Nombre" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
      <Input aria-label="Correo" type="email" placeholder="Correo" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <Input aria-label="Contraseña" type="password" placeholder="Contraseña inicial" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <NativeSelect aria-label="Posición" value={f.positionId} onChange={(e) => setF({ ...f, positionId: e.target.value })} className={selectClass} fullWidth>
        <option value="">— Posición (banco de horas) —</option>
        {posiciones.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </NativeSelect>
      <NativeSelect aria-label="Rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as NuevoUsuario['role'] })} className={selectClass} fullWidth>
        <option value="operativo">operativo</option><option value="manager">manager</option>{allowAdminRole && <option value="admin">admin</option>}
      </NativeSelect>
      {/* Áreas = visibilidad del manager (qué áreas ve su equipo/reportes). El operativo
          las hereda de su posición (no se editan aquí). */}
      {(f.role === 'manager' || f.role === 'admin') && (
        <fieldset className="space-y-1"><legend className="text-sm text-muted-foreground">Áreas que puede ver</legend>
          {areas.filter((a) => !a.is_internal).map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.areaIds.includes(a.id)}
                onChange={(e) => setF({ ...f, areaIds: e.target.checked ? [...f.areaIds, a.id] : f.areaIds.filter((x) => x !== a.id) })} />
              {a.name}
            </label>
          ))}
        </fieldset>
      )}
      <Button type="submit" disabled={saving} size="lg">{saving ? 'Creando…' : 'Crear usuario'}</Button>
    </form>
  )
}

'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { crearUsuario, type NuevoUsuario } from '@/app/(horas)/admin/usuarios/actions'
import type { AreaRow } from '@/lib/horas/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const selectClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

export default function UsuarioForm({ areas }: { areas: AreaRow[] }) {
  const [f, setF] = useState<NuevoUsuario>({ full_name: '', email: '', password: '', position: '', role: 'operativo', areaIds: [] })
  const [saving, setSaving] = useState(false)
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const res = await crearUsuario(f); setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Usuario creado')
    setF({ full_name: '', email: '', password: '', position: '', role: 'operativo', areaIds: [] })
  }
  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <Input aria-label="Nombre" placeholder="Nombre" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
      <Input aria-label="Correo" type="email" placeholder="Correo" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <Input aria-label="Contraseña" type="password" placeholder="Contraseña inicial" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <Input aria-label="Posición" placeholder="Posición" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} />
      <select aria-label="Rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as NuevoUsuario['role'] })} className={selectClass}>
        <option value="operativo">operativo</option><option value="manager">manager</option><option value="admin">admin</option>
      </select>
      <fieldset className="space-y-1"><legend className="text-sm text-muted-foreground">Áreas</legend>
        {areas.filter((a) => !a.is_internal).map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.areaIds.includes(a.id)}
              onChange={(e) => setF({ ...f, areaIds: e.target.checked ? [...f.areaIds, a.id] : f.areaIds.filter((x) => x !== a.id) })} />
            {a.name}
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={saving} size="lg">{saving ? 'Creando…' : 'Crear usuario'}</Button>
    </form>
  )
}

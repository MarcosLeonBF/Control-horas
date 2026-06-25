'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { crearUsuario, type NuevoUsuario } from '@/app/(horas)/admin/usuarios/actions'
import type { AreaRow } from '@/lib/horas/types'

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
    <form onSubmit={onSubmit} className="max-w-md space-y-3">
      <input aria-label="Nombre" placeholder="Nombre" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} className="w-full rounded border border-border px-3 py-2" />
      <input aria-label="Correo" type="email" placeholder="Correo" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="w-full rounded border border-border px-3 py-2" />
      <input aria-label="Contraseña" type="password" placeholder="Contraseña inicial" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="w-full rounded border border-border px-3 py-2" />
      <input aria-label="Posición" placeholder="Posición" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} className="w-full rounded border border-border px-3 py-2" />
      <select aria-label="Rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as NuevoUsuario['role'] })} className="w-full rounded border border-border px-3 py-2">
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
      <button type="submit" disabled={saving} className="rounded bg-brand px-4 py-2 text-white">{saving ? 'Creando…' : 'Crear usuario'}</button>
    </form>
  )
}

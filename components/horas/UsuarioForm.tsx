'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { UserPlus } from 'lucide-react'
import { crearUsuario, type NuevoUsuario } from '@/app/(horas)/admin/usuarios/actions'
import type { AreaRow } from '@/lib/horas/types'
import { Field, fieldSelect, initials, type PosicionOpt } from '@/components/horas/UsuariosPanel'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import NativeSelect from '@/components/ui/native-select'
import { AYUDA_SLACK_ID } from '@/lib/slack-id'

const VACIO: NuevoUsuario = { full_name: '', email: '', password: '', positionId: '', role: 'operativo', areaIds: [], equipoId: null, slackId: '' }

// Mismo lenguaje visual que el editor del panel (Field, selects, caja de áreas): crear y
// editar a una persona tienen que verse como la misma ficha.
export default function UsuarioForm({ areas, posiciones, equipos, allowAdminRole = true }: { areas: AreaRow[]; posiciones: PosicionOpt[]; equipos: PosicionOpt[]; allowAdminRole?: boolean }) {
  const router = useRouter()
  const [f, setF] = useState<NuevoUsuario>(VACIO)
  const [saving, setSaving] = useState(false)
  const selectableAreas = areas.filter((a) => !a.is_internal)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const res = await crearUsuario(f); setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Usuario creado')
    setF(VACIO)
    router.refresh() // que aparezca en la lista de arriba sin recargar
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--brand)/10 text-xs font-semibold text-(--brand-strong)">
          {f.full_name.trim() ? initials(f.full_name) : <UserPlus className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{f.full_name.trim() || 'Nuevo usuario'}</p>
          <p className="truncate text-xs text-muted-foreground">{f.email.trim() || 'Completa sus datos para darlo de alta'}</p>
        </div>
      </div>

      {/* La persona y su acceso. autoComplete: sin "new-password", el navegador rellena aquí
          el correo y la contraseña guardados de quien está creando el usuario. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" obligatorio>
          <Input aria-label="Nombre" required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })}
            className="h-9" autoComplete="off" />
        </Field>
        <Field label="Correo" obligatorio>
          <Input aria-label="Correo" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })}
            className="h-9" autoComplete="off" />
        </Field>
        <Field label="Contraseña inicial" obligatorio>
          <Input aria-label="Contraseña" type="password" required minLength={8} value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })} className="h-9" autoComplete="new-password" />
          <span className="block text-xs text-muted-foreground">Mínimo 8 caracteres. Al entrar por primera vez tendrá que cambiarla.</span>
        </Field>
        {/* ID de miembro de Slack (0050), obligatorio en el alta: los avisos lo usan para
            mencionar o escribir por mensaje directo. Lo comprueba también crearUsuario. */}
        <Field label="ID de Slack" obligatorio>
          <Input aria-label="ID de Slack" required value={f.slackId}
            onChange={(e) => setF({ ...f, slackId: e.target.value })} className="h-9 font-mono" autoComplete="off" spellCheck={false} />
          <span className="block text-xs text-muted-foreground">{AYUDA_SLACK_ID}</span>
        </Field>
      </div>

      {/* Su sitio en la empresa. Posición y equipo pueden quedar sin asignar. */}
      <div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
        <Field label="Rol">
          <NativeSelect aria-label="Rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as NuevoUsuario['role'] })} className={fieldSelect} fullWidth>
            <option value="operativo">Operativo</option>
            <option value="manager">Manager</option>
            {allowAdminRole && <option value="admin">Admin</option>}
          </NativeSelect>
        </Field>
        <Field label="Posición (banco de horas)">
          <NativeSelect aria-label="Posición" value={f.positionId} onChange={(e) => setF({ ...f, positionId: e.target.value })} className={fieldSelect} fullWidth>
            <option value="">— Sin posición —</option>
            {posiciones.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
        {/* Equipo de la empresa (0049): sin relación con la posición ni con las áreas. Solo
            etiqueta a la persona para que los avisos sepan por dónde enrutar. */}
        <Field label="Equipo (empresa)">
          <NativeSelect aria-label="Equipo" value={f.equipoId ?? ''} onChange={(e) => setF({ ...f, equipoId: e.target.value || null })} className={fieldSelect} fullWidth>
            <option value="">— Sin equipo —</option>
            {equipos.map((eq) => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
          </NativeSelect>
        </Field>
      </div>

      {/* Áreas = visibilidad del manager (qué áreas ve su equipo/reportes). El operativo
          las hereda de su posición (no se editan aquí). */}
      {(f.role === 'manager' || f.role === 'admin') && (
        <fieldset className="mt-4 rounded-lg border border-border bg-(--muted-surface) p-4">
          <legend className="sr-only">Áreas que puede ver</legend>
          <div className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full bg-(--brand)" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Áreas que puede ver</h4>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {f.role === 'manager'
              ? 'Verá los registros, bancos y reportes de los usuarios de estas áreas. El área con la que registra sale de su posición.'
              : 'El admin ve todo por defecto; el área con la que registra sale de su posición.'}
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
        </fieldset>
      )}

      <div className="mt-5">
        <Button type="submit" disabled={saving}>{saving ? 'Creando…' : 'Crear usuario'}</Button>
      </div>
    </form>
  )
}

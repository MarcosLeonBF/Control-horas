import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CambiarContrasenaForm from '@/components/horas/CambiarContrasenaForm'

export default async function PerfilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, role, position_id, must_change_password')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  // Obtener el nombre de la posición si tiene una asignada.
  let positionName: string | null = null
  if (profile.position_id) {
    const { data: pos } = await supabase.from('positions').select('name').eq('id', profile.position_id).single()
    positionName = pos?.name ?? null
  }

  const roleLabels: Record<string, string> = { operativo: 'Operativo', manager: 'Manager', admin: 'Administrador' }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">Mi perfil</h1>

      {/* Datos informativos (solo lectura) */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Datos personales</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Nombre</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">{profile.full_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">{profile.email || user.email || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Rol</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground capitalize">{roleLabels[profile.role] ?? profile.role}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Posición</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">{positionName || '—'}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">Para cambiar estos datos, contactá a un administrador.</p>
      </div>

      {/* Cambio de contraseña */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cambiar contraseña</h2>
        <CambiarContrasenaForm />
      </div>
    </div>
  )
}

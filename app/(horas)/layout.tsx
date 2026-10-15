import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import ForcePasswordGate from '@/components/horas/ForcePasswordGate'
import { hubActivo, urlSalidaHub } from '@/lib/hub/config'
import { rutaErrorHub } from '@/lib/hub/rutas'

export default async function HorasLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role, full_name, status, must_change_password, can_create_users').eq('id', user.id).single()
  const hub = hubActivo()
  if (!profile || profile.status !== 'activo') {
    // Con Acceso, la baja del conector (lib/hub/conector.ts) corta aquí en la siguiente
    // petición. Se manda a la página que lo explica y no al login: con la sesión de
    // Supabase aún viva, el proxy devolvería del login a la app, y la app al login, en bucle.
    redirect(hub ? rutaErrorHub(profile ? 'inactivo' : 'sin-ficha') : '/login')
  }

  // Si debe cambiar la contraseña, bloquear toda la app y mostrar el formulario. Con Acceso
  // no aplica: la contraseña vive en Acceso, que ya obliga a cambiar la temporal al entrar.
  if (profile.must_change_password && !hub) {
    return <ForcePasswordGate displayName={profile.full_name || user.email!} />
  }

  return (
    <AppShell displayName={profile.full_name || user.email!} role={profile.role} canCreateUsers={profile.can_create_users === true} urlSalidaHub={urlSalidaHub()}>
      {children}
    </AppShell>
  )
}

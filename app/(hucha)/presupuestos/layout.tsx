import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { hubActivo, urlSalidaHub } from '@/lib/hub/config'
import { rutaErrorHub } from '@/lib/hub/rutas'

export default async function HuchaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, full_name, status, can_create_users').eq('id', user.id).single()
  // Con Acceso, la baja del conector tiene que cortar también HUCHA en la siguiente
  // petición, como hace el layout de Horas. Sin Acceso se deja como estaba.
  if (hubActivo() && profile && profile.status !== 'activo') redirect(rutaErrorHub('inactivo'))
  if (!profile || (profile.role !== 'manager' && profile.role !== 'admin')) {
    redirect('/login')
  }

  return (
    <AppShell displayName={profile.full_name || user.email!} role={profile.role} canCreateUsers={profile.can_create_users === true} urlSalidaHub={urlSalidaHub()}>
      {children}
    </AppShell>
  )
}

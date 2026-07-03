import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import ForcePasswordGate from '@/components/horas/ForcePasswordGate'

export default async function HorasLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role, full_name, status, must_change_password').eq('id', user.id).single()
  if (!profile || profile.status !== 'activo') redirect('/login')

  // Si debe cambiar la contraseña, bloquear toda la app y mostrar el formulario.
  if (profile.must_change_password) {
    return <ForcePasswordGate displayName={profile.full_name || user.email!} />
  }

  return (
    <AppShell displayName={profile.full_name || user.email!} role={profile.role}>
      {children}
    </AppShell>
  )
}

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'

export default async function HuchaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, full_name, can_create_users').eq('id', user.id).single()
  if (!profile || (profile.role !== 'manager' && profile.role !== 'admin')) {
    redirect('/login')
  }

  return (
    <AppShell displayName={profile.full_name || user.email!} role={profile.role} canCreateUsers={profile.can_create_users === true}>
      {children}
    </AppShell>
  )
}

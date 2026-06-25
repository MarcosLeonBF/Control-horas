import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HorasNav from '@/components/horas/HorasNav'

export default async function HorasLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role, full_name, status').eq('id', user.id).single()
  if (!profile || profile.status !== 'activo') redirect('/login')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <HorasNav displayName={profile.full_name || user.email!} role={profile.role} />
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  )
}

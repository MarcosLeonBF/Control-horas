import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HuchaNav from '@/components/hucha/HuchaNav'

export default async function HuchaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (!profile || (profile.role !== 'manager' && profile.role !== 'admin')) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <HuchaNav displayName={profile.full_name || user.email!} role={profile.role} />
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  )
}

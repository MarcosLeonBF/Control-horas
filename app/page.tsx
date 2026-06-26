import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Control de Horas es la app principal: todos entran ahí. HUCHA (presupuestos)
  // se accede desde el link en la barra de navegación (manager/admin).
  redirect('/registrar')
}

import { redirect } from 'next/navigation'

// La raíz redirige siempre a la app principal (que ya verifica sesión)
export default function Home() {
  redirect('/presupuestos')
}

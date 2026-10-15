import { redirect } from 'next/navigation'
import { hubActivo } from '@/lib/hub/config'
import { rutaEntrarHub } from '@/lib/hub/rutas'
import LoginForm from './LoginForm'

// Con Acceso (docs/acceso.md) aquí ya no se pide contraseña: se pasa directo a la entrada por
// Acceso, conservando a dónde iba. El proxy sigue mandando aquí a quien no tiene sesión, así
// que todo acaba pasando por Acceso.
//
// searchParams solo se lee con Acceso activo: sin él, la página sigue siendo la estática de
// siempre. Cambiar ACCESO_ISSUER en Vercel exige volver a desplegar, y ese despliegue
// rehace la página en el modo nuevo.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  if (hubActivo()) {
    const { next } = await searchParams
    redirect(rutaEntrarHub(next))
  }
  return <LoginForm />
}

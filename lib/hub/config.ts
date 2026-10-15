// Configuración de Acceso, el login centralizado de Bastida&Farina (docs/acceso.md).
//
// Todo cuelga de ACCESO_ISSUER. Sin ella la app funciona exactamente como antes: login con
// contraseña de Supabase, cambio forzado de contraseña, cambio en /perfil y altas con
// contraseña inicial. Con ella se entra por Acceso, las contraseñas se gestionan allí y el
// conector (/api/hub/*) queda disponible. Quitarla es la vuelta atrás.
//
// Solo servidor: el secreto del cliente y el del conector no salen de aquí. Lo único que
// necesita el navegador (la URL de salida de Acceso) lo pasan los layouts como prop.
import { appUrl } from '@/lib/avisos/entorno'
import { urlAccesoDesdeIssuer, urlCierreSesion } from '@/lib/hub/rutas'

export function hubActivo(): boolean {
  return !!process.env.ACCESO_ISSUER?.trim()
}

export interface ConfigHub {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string // tiene que ser exactamente la registrada en Acceso
}

// Con el hub activo, lo que falte es un error de despliegue y se dice cuál. APP_URL se exige
// aunque appUrl() tenga un plan B: la redirect URI tiene que coincidir con la registrada, y
// adivinarla a partir de VERCEL_PROJECT_PRODUCTION_URL daría un fallo difícil de ver.
export function configHub(): ConfigHub {
  const issuer = process.env.ACCESO_ISSUER?.trim().replace(/\/+$/, '') ?? ''
  const clientId = process.env.ACCESO_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.ACCESO_CLIENT_SECRET?.trim() ?? ''
  const faltan = [
    !issuer && 'ACCESO_ISSUER',
    !clientId && 'ACCESO_CLIENT_ID',
    !clientSecret && 'ACCESO_CLIENT_SECRET',
    !process.env.APP_URL?.trim() && 'APP_URL',
  ].filter(Boolean)
  if (faltan.length) throw new Error(`Acceso: faltan variables de entorno: ${faltan.join(', ')}`)
  return { issuer, clientId, clientSecret, redirectUri: `${appUrl()}/auth/hub/callback` }
}

// Web de Acceso (issuer sin /oidc), para enlazar a "Mi cuenta" y a las altas. null sin hub.
export function urlAcceso(): string | null {
  const issuer = process.env.ACCESO_ISSUER?.trim()
  return issuer ? urlAccesoDesdeIssuer(issuer) : null
}

// A dónde manda "Salir" después de cerrar la sesión de Supabase. null sin hub (o sin
// client_id): entonces "Salir" vuelve al login de la app, como siempre.
export function urlSalidaHub(): string | null {
  const issuer = process.env.ACCESO_ISSUER?.trim()
  const clientId = process.env.ACCESO_CLIENT_ID?.trim()
  return issuer && clientId ? urlCierreSesion(issuer, clientId) : null
}

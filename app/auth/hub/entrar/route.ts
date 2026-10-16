// GET /auth/hub/entrar?next=… — empieza la entrada por Acceso: guarda en una cookie cifrada
// lo necesario para validar la vuelta (PKCE, state, nonce y a dónde volver) y manda a la
// pantalla de entrada de Acceso. Ver docs/acceso.md.
//
// Sin hub (ACCESO_ISSUER sin definir) no hace nada propio: devuelve al login de siempre.
import { NextResponse, type NextRequest } from 'next/server'
import { hubActivo } from '@/lib/hub/config'
import { COOKIE_ENTRADA, opcionesCookieEntrada } from '@/lib/hub/entrada'
import { iniciarEntrada } from '@/lib/hub/oidc'
import { destinoTrasEntrar, rutaErrorHub, rutaLogin } from '@/lib/hub/rutas'

export async function GET(request: NextRequest) {
  const next = destinoTrasEntrar(request.nextUrl.searchParams.get('next'))
  if (!hubActivo()) return NextResponse.redirect(new URL(rutaLogin(next), request.url))

  try {
    const { url, cookie, segura } = await iniciarEntrada(next)
    const respuesta = NextResponse.redirect(url)
    respuesta.cookies.set(COOKIE_ENTRADA, cookie, opcionesCookieEntrada(segura))
    return respuesta
  } catch (e) {
    // Acceso caído o mal configurado: mejor una página que lo diga que un 500.
    console.error('[acceso] no se pudo iniciar la entrada', e)
    return NextResponse.redirect(new URL(rutaErrorHub('sin-conexion', next), request.url))
  }
}

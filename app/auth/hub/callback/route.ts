// GET /auth/hub/callback — vuelta de Acceso. Valida el código (state, nonce, PKCE y la firma
// del ID token), abre la sesión de Supabase de esa persona sin contraseña y la deja donde
// iba. Cualquier fallo acaba en /auth/hub/error con un motivo legible. Ver docs/acceso.md.
import { NextResponse, type NextRequest } from 'next/server'
import { configHub, hubActivo } from '@/lib/hub/config'
import { COOKIE_ENTRADA, descifrarEntrada, type Entrada } from '@/lib/hub/entrada'
import { completarEntrada } from '@/lib/hub/oidc'
import { rutaErrorHub, type MotivoError } from '@/lib/hub/rutas'
import { abrirSesion } from '@/lib/hub/sesion'

export async function GET(request: NextRequest) {
  if (!hubActivo()) return NextResponse.redirect(new URL('/login', request.url))

  let next = '/'
  // La cookie temporal ya cumplió (o no sirve): se borra en cualquier respuesta. Con su
  // path, que es como se creó; sin él el navegador no la reconoce como la misma.
  const conCookieBorrada = (respuesta: NextResponse) => {
    respuesta.cookies.delete({ name: COOKIE_ENTRADA, path: '/auth/hub' })
    return respuesta
  }
  const fallar = (motivo: MotivoError) =>
    conCookieBorrada(NextResponse.redirect(new URL(rutaErrorHub(motivo, next), request.url)))

  let entrada: Entrada | null
  try {
    entrada = await descifrarEntrada(request.cookies.get(COOKIE_ENTRADA)?.value, configHub().clientSecret)
  } catch (e) {
    console.error('[acceso] configuración incompleta', e) // configHub dice qué variable falta
    return fallar('fallo')
  }
  next = entrada?.next ?? '/'

  // Acceso puede volver con un error en vez de un código (p. ej. access_denied si no tiene
  // acceso a esta app o canceló).
  const error = request.nextUrl.searchParams.get('error')
  if (error) return fallar(error === 'access_denied' ? 'sin-acceso' : 'fallo')
  // Sin cookie: caducó (más de 10 minutos), o la entrada empezó en otro navegador o pestaña.
  if (!entrada) return fallar('caducada')

  let sub: string
  try {
    ;({ sub } = await completarEntrada(request.nextUrl.search, entrada))
  } catch (e) {
    console.error('[acceso] la vuelta de Acceso no es válida', e)
    return fallar('fallo')
  }

  // `next` ya pasó por destinoTrasEntrar al guardarse, y la cookie va cifrada: es una ruta interna.
  const respuesta = conCookieBorrada(NextResponse.redirect(new URL(next, request.url)))
  try {
    const sesion = await abrirSesion(sub, request, respuesta)
    if (!sesion.ok) return fallar(sesion.motivo)
  } catch (e) {
    console.error('[acceso] no se pudo abrir la sesión', e)
    return fallar('fallo')
  }
  return respuesta
}

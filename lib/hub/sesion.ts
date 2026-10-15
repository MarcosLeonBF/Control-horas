// Sesión de Supabase para quien vuelve de Acceso, sin contraseña.
//
// Acceso ya dijo quién es (el `sub`, que es el id de auth.users: los migrados conservan su
// UUID y las altas nuevas se crean con él, ver lib/hub/conector.ts). Aquí se comprueba que
// tiene ficha activa y se le abre su propia sesión de Supabase: el service role genera un
// enlace mágico (generateLink NO envía ningún correo) y su token se canjea en el servidor
// con verifyOtp, que deja las cookies de @supabase/ssr en la respuesta. Desde ahí la app
// funciona igual que con contraseña: RLS, RPC y tablas no cambian.
import { createServerClient } from '@supabase/ssr'
import type { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MotivoError } from '@/lib/hub/rutas'

export async function abrirSesion(
  sub: string, request: NextRequest, respuesta: NextResponse,
): Promise<{ ok: true } | { ok: false; motivo: MotivoError }> {
  const admin = createAdminClient()

  const { data: { user }, error: errorUsuario } = await admin.auth.admin.getUserById(sub)
  if (errorUsuario && errorUsuario.status !== 404) {
    console.error('[acceso] getUserById', errorUsuario.message)
    return { ok: false, motivo: 'fallo' }
  }
  if (!user) return { ok: false, motivo: 'sin-ficha' }

  const { data: perfil, error: errorPerfil } = await admin.from('profiles').select('status').eq('id', sub).maybeSingle()
  if (errorPerfil) {
    console.error('[acceso] profiles', errorPerfil.message)
    return { ok: false, motivo: 'fallo' }
  }
  if (!perfil) return { ok: false, motivo: 'sin-ficha' }
  // Inactivo o baneado (la baja del conector hace las dos cosas): no entra.
  const baneado = !!user.banned_until && new Date(user.banned_until).getTime() > Date.now()
  if (perfil.status !== 'activo' || baneado) return { ok: false, motivo: 'inactivo' }
  if (!user.email) return { ok: false, motivo: 'fallo' }

  const { data: enlace, error: errorEnlace } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email })
  const tokenHash = enlace?.properties?.hashed_token
  if (errorEnlace || !tokenHash) {
    console.error('[acceso] generateLink', errorEnlace?.message ?? 'sin hashed_token')
    return { ok: false, motivo: 'fallo' }
  }

  // Mismo patrón de cookies que lib/supabase/middleware.ts, pero escribiendo en la redirección
  // que se va a devolver: ahí viajan las cookies de la sesión nueva (y se limpian los trozos
  // de una sesión anterior, que se leen de la petición).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) => respuesta.cookies.set(name, value, options))
          Object.entries(headers ?? {}).forEach(([clave, valor]) => respuesta.headers.set(clave, valor))
        },
      },
    },
  )
  // type 'email' y no 'magiclink': auth-js marca 'magiclink' como obsoleto para verifyOtp y
  // documenta 'email' para los token_hash. GoTrue busca un token_hash de tipo 'email' tanto
  // entre los de confirmación como entre los de enlace mágico, así que vale para los dos.
  const { error: errorOtp } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
  if (errorOtp) {
    console.error('[acceso] verifyOtp', errorOtp.message)
    return { ok: false, motivo: errorOtp.code === 'user_banned' ? 'inactivo' : 'fallo' }
  }
  return { ok: true }
}

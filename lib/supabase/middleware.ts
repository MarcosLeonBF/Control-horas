import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { rutaInternaSegura } from '@/lib/ruta-segura'

// Helper que refresca la sesión del usuario en cada request
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresca la sesión (no usar getUser() con caché). Si el refresh token guardado en
  // la cookie está vencido o ya no existe (p. ej. una sesión vieja en local),
  // getUser() lanza AuthApiError (refresh_token_not_found). Lo tratamos como "sin
  // sesión" en vez de romper la app con el error crudo, y limpiamos las cookies de
  // auth para que el próximo request no vuelva a chocar con el token inválido.
  let user: User | null = null
  let staleSession = false
  try {
    user = (await supabase.auth.getUser()).data.user
  } catch {
    staleSession = true
  }

  // Borra las cookies de auth de Supabase (sb-<ref>-auth-token[.n]) del response que
  // se devuelve, solo cuando la sesión era inválida.
  const clearAuthCookies = (res: NextResponse) => {
    if (staleSession) {
      for (const c of request.cookies.getAll()) {
        if (/^sb-.*-auth-token/.test(c.name)) res.cookies.delete(c.name)
      }
    }
    return res
  }

  const isAuthPage = request.nextUrl.pathname.startsWith('/login')

  if (!user && !isAuthPage) {
    // Sin sesión (o token inválido) y no está en login → redirigir al login, recordando a
    // dónde iba en `next` para volver ahí al entrar. Es lo que hace útil un enlace que
    // llega por Slack (un registro, un banco): antes se perdía y todo acababa en la home.
    // La raíz no se guarda: volver a "/" es lo mismo que no volver a ningún sitio.
    const { pathname, search } = request.nextUrl
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    if (pathname !== '/') url.searchParams.set('next', pathname + search)
    return clearAuthCookies(NextResponse.redirect(url))
  }

  if (user && isAuthPage) {
    // Ya tiene sesión y va al login → a la app, o a su `next` si es una ruta interna.
    // `next` lo controla quien fabricó el enlace: rutaInternaSegura descarta cualquier
    // cosa que no sea una ruta de esta app (ver lib/ruta-segura.ts).
    const destino = rutaInternaSegura(request.nextUrl.searchParams.get('next')) ?? '/'
    return NextResponse.redirect(new URL(destino, request.url))
  }

  return clearAuthCookies(supabaseResponse)
}

// Rutas y URLs de la entrada por Acceso (el login centralizado, docs/acceso.md).
//
// Puro y sin dependencias de Next ni de Supabase: lo usan la página de login, las rutas de
// /auth/hub/*, los layouts y el AppShell, y tiene sus tests en e2e/hub-rutas.spec.ts.
import { rutaInternaSegura } from '@/lib/ruta-segura'

// Por qué no se pudo entrar. Viaja en la URL de la página de error (/auth/hub/error), que
// traduce cada motivo a una frase para la persona.
export const MOTIVOS_ERROR = ['sin-ficha', 'inactivo', 'sin-acceso', 'caducada', 'sin-conexion', 'fallo'] as const
export type MotivoError = (typeof MOTIVOS_ERROR)[number]

// Lo que llega en ?motivo= lo controla quien fabrica el enlace: lo que no se conoce es un
// fallo genérico, nunca texto que se pinte tal cual.
export function motivoError(raw: string | string[] | null | undefined): MotivoError {
  const valor = Array.isArray(raw) ? raw[0] : raw
  return (MOTIVOS_ERROR as readonly string[]).includes(valor ?? '') ? (valor as MotivoError) : 'fallo'
}

// A dónde volver después de entrar. Lo mismo que el login de siempre (rutaInternaSegura:
// solo rutas internas, nada de open redirect) y además nada del propio flujo de entrada
// (/auth/...): volver a /auth/hub/entrar empezaría otra entrada. Sin destino válido, la home.
export function destinoTrasEntrar(next: string | string[] | null | undefined): string {
  const ruta = rutaInternaSegura(Array.isArray(next) ? next[0] : next)
  if (!ruta) return '/'
  const { pathname } = new URL(ruta, 'http://interno.invalid')
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return '/'
  return ruta
}

// `?next=` solo cuando aporta algo: volver a la home es lo mismo que no volver a ningún sitio.
function conNext(base: string, next: string | string[] | null | undefined): string {
  const destino = destinoTrasEntrar(next)
  return destino === '/' ? base : `${base}?next=${encodeURIComponent(destino)}`
}

export function rutaEntrarHub(next?: string | string[] | null): string {
  return conNext('/auth/hub/entrar', next)
}

export function rutaLogin(next?: string | string[] | null): string {
  return conNext('/login', next)
}

export function rutaErrorHub(motivo: MotivoError, next?: string | string[] | null): string {
  const destino = destinoTrasEntrar(next)
  const params = new URLSearchParams({ motivo })
  if (destino !== '/') params.set('next', destino)
  return `/auth/hub/error?${params}`
}

function sinBarraFinal(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

// La web de Acceso es el issuer sin el /oidc final: https://acceso.<dominio>/oidc → https://acceso.<dominio>.
// Ahí viven "Mi cuenta" (/cuenta) y el panel de altas (/admin/usuarios/nuevo).
export function urlAccesoDesdeIssuer(issuer: string): string {
  return sinBarraFinal(issuer).replace(/\/oidc$/, '')
}

// Cierre de sesión en Acceso (RP-initiated logout, docs/integrar-una-app.md §4). Sin él, el
// siguiente "entrar" volvería a dejar a la persona dentro sin pedirle nada.
export function urlCierreSesion(issuer: string, clientId: string): string {
  return `${sinBarraFinal(issuer)}/session/end?client_id=${encodeURIComponent(clientId)}`
}

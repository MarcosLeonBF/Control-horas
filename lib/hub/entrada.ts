// Cookie temporal de la entrada por Acceso: lo que hay que recordar entre /auth/hub/entrar
// y /auth/hub/callback (el verificador PKCE, el state, el nonce y a dónde volver).
//
// Va cifrada (JWE dir + A256GCM, como las cookies de Acceso): desde el navegador no se puede
// leer ni alterar. Caduca a los 10 minutos: una entrada que tarda más se repite. La clave se
// deriva del secreto del cliente, así que no hace falta otra variable de entorno.
//
// El secreto entra como parámetro para poder probarlo sin entorno (e2e/hub-conector.spec.ts).
import { createHash } from 'node:crypto'
import { EncryptJWT, jwtDecrypt } from 'jose'

export const COOKIE_ENTRADA = 'hub_entrada'
export const VIDA_ENTRADA_S = 10 * 60

export interface Entrada {
  verifier: string // PKCE: el code_verifier del que salió el code_challenge
  state: string
  nonce: string
  next: string // ya validado con destinoTrasEntrar
}

// Una clave por uso: aunque el secreto del cliente sea el mismo, esta cookie no vale para otra cosa.
function clave(secreto: string): Uint8Array {
  return createHash('sha256').update(`cookie:hub-entrada:${secreto}`).digest()
}

export function cifrarEntrada(entrada: Entrada, secreto: string): Promise<string> {
  return new EncryptJWT({ ...entrada })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${VIDA_ENTRADA_S}s`)
    .encrypt(clave(secreto))
}

// null si falta, está alterada, es de otra clave o ha caducado: en todos los casos la
// entrada se repite desde el principio.
export async function descifrarEntrada(valor: string | undefined, secreto: string): Promise<Entrada | null> {
  if (!valor) return null
  try {
    const { payload } = await jwtDecrypt(valor, clave(secreto))
    const { verifier, state, nonce, next } = payload
    if (typeof verifier !== 'string' || typeof state !== 'string' || typeof nonce !== 'string' || typeof next !== 'string') {
      return null
    }
    return { verifier, state, nonce, next }
  } catch {
    return null
  }
}

// Solo la ve /auth/hub/*. SameSite=Lax y no Strict: la vuelta desde Acceso es una navegación
// de primer nivel desde otro sitio, y con Strict la cookie no llegaría al callback.
export function opcionesCookieEntrada(segura: boolean) {
  return { httpOnly: true, secure: segura, sameSite: 'lax' as const, path: '/auth/hub', maxAge: VIDA_ENTRADA_S }
}

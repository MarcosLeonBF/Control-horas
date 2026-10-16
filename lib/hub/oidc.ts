// Cliente OIDC de Acceso (authorization code + PKCE, docs/integrar-una-app.md §3), con
// openid-client 6. Solo servidor: lo usan /auth/hub/entrar y /auth/hub/callback.
import * as oidc from 'openid-client'
import { configHub } from '@/lib/hub/config'
import { cifrarEntrada, type Entrada } from '@/lib/hub/entrada'

// El descubrimiento se hace una vez por instancia y se reutiliza. Si falla (Acceso caído),
// no se guarda el fallo: la próxima entrada lo vuelve a intentar.
let configuracion: Promise<oidc.Configuration> | null = null

function configuracionOidc(): Promise<oidc.Configuration> {
  if (!configuracion) {
    const { issuer, clientId, clientSecret } = configHub()
    const url = new URL(issuer)
    configuracion = oidc
      .discovery(
        url,
        clientId,
        // Acceso firma el ID token con ES256: se exige ese y no otro.
        { client_secret: clientSecret, id_token_signed_response_alg: 'ES256' },
        oidc.ClientSecretBasic(clientSecret),
        // http solo tiene sentido con un Acceso local de desarrollo; en producción es https.
        { timeout: 10, ...(url.protocol === 'http:' ? { execute: [oidc.allowInsecureRequests] } : {}) },
      )
      .catch((e) => {
        configuracion = null
        throw e
      })
  }
  return configuracion
}

// Prepara la ida a Acceso: la URL de autorización y la cookie cifrada con lo necesario para
// validar la vuelta.
export async function iniciarEntrada(next: string): Promise<{ url: URL; cookie: string; segura: boolean }> {
  const { clientSecret, redirectUri } = configHub()
  const config = await configuracionOidc()
  const entrada: Entrada = {
    verifier: oidc.randomPKCECodeVerifier(),
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    next,
  }
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge: await oidc.calculatePKCECodeChallenge(entrada.verifier),
    code_challenge_method: 'S256',
    state: entrada.state,
    nonce: entrada.nonce,
  })
  return { url, cookie: await cifrarEntrada(entrada, clientSecret), segura: redirectUri.startsWith('https:') }
}

// Valida la vuelta de Acceso con todas las comprobaciones (state, nonce, PKCE, firma y
// audiencia del ID token) y devuelve quién es. Lanza si algo no cuadra.
//
// `busqueda` es la query con la que volvió (?code=…&state=…&iss=…). La URL se rehace sobre la
// redirect URI configurada y no sobre la de la petición: detrás del proxy de Vercel el host o
// el protocolo de la petición pueden no ser los públicos, y openid-client compara con ella.
export async function completarEntrada(busqueda: string, entrada: Entrada): Promise<{ sub: string }> {
  const { redirectUri } = configHub()
  const config = await configuracionOidc()
  const actual = new URL(redirectUri)
  actual.search = busqueda
  const tokens = await oidc.authorizationCodeGrant(config, actual, {
    pkceCodeVerifier: entrada.verifier,
    expectedState: entrada.state,
    expectedNonce: entrada.nonce,
    idTokenExpected: true,
  })
  const sub = tokens.claims()?.sub
  if (!sub) throw new Error('Acceso no devolvió el sub en el ID token')
  return { sub }
}

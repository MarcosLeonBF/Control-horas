import { test, expect } from '@playwright/test'
import { rutaInternaSegura } from '../lib/ruta-segura'

// `next` viene de la URL, así que lo controla quien fabrica el enlace. Si se aceptara
// cualquier cosa, un enlace de login legítimo podría dejar a la persona, ya logueada, en
// un sitio de phishing (open redirect). Solo pasan rutas internas de esta app.

test('rutaInternaSegura: acepta rutas internas, con su query', () => {
  expect(rutaInternaSegura('/registros/5b1c')).toBe('/registros/5b1c')
  expect(rutaInternaSegura('/bancos/Proyecto%20Ejemplo')).toBe('/bancos/Proyecto%20Ejemplo')
  expect(rutaInternaSegura('/reportes?from=2026-09-01&to=2026-09-18')).toBe('/reportes?from=2026-09-01&to=2026-09-18')
})

test('rutaInternaSegura: vacío o ausente no es una ruta', () => {
  expect(rutaInternaSegura(null)).toBeNull()
  expect(rutaInternaSegura(undefined)).toBeNull()
  expect(rutaInternaSegura('')).toBeNull()
})

test('rutaInternaSegura: rechaza cualquier salida a otro sitio', () => {
  expect(rutaInternaSegura('https://evil.com')).toBeNull()
  expect(rutaInternaSegura('//evil.com')).toBeNull() // protocolo relativo: otro dominio
  expect(rutaInternaSegura('/\\evil.com')).toBeNull() // los navegadores leen \ como /
  expect(rutaInternaSegura('\\\\evil.com')).toBeNull()
  expect(rutaInternaSegura('javascript:alert(1)')).toBeNull()
  expect(rutaInternaSegura('evil.com')).toBeNull()
})

test('rutaInternaSegura: rechaza espacios y caracteres de control', () => {
  // El truco que más se olvida: los navegadores QUITAN tabuladores y saltos de línea de
  // las URLs, así que "/\t/evil.com" acaba siendo "//evil.com".
  expect(rutaInternaSegura('/\t/evil.com')).toBeNull()
  expect(rutaInternaSegura('/\n/evil.com')).toBeNull()
  expect(rutaInternaSegura(' /registros/5b1c')).toBeNull()
})

test('rutaInternaSegura: no devuelve al propio login (evita el bucle)', () => {
  expect(rutaInternaSegura('/login')).toBeNull()
  expect(rutaInternaSegura('/login?next=/registros/5b1c')).toBeNull()
})

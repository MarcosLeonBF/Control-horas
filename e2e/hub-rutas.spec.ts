import { test, expect } from '@playwright/test'
import {
  destinoTrasEntrar, motivoError, rutaEntrarHub, rutaErrorHub, rutaLogin, urlAccesoDesdeIssuer, urlCierreSesion,
} from '../lib/hub/rutas'

// Entrada por Acceso (docs/acceso.md). Puros: no tocan Supabase ni Acceso.
// npx playwright test -c playwright.puros.config.ts

test('destinoTrasEntrar: rutas internas, con su query', () => {
  expect(destinoTrasEntrar('/registros/5b1c')).toBe('/registros/5b1c')
  expect(destinoTrasEntrar('/reportes?from=2026-09-01&to=2026-09-18')).toBe('/reportes?from=2026-09-01&to=2026-09-18')
  expect(destinoTrasEntrar(['/bancos', '/otro'])).toBe('/bancos') // ?next repetido: el primero
})

test('destinoTrasEntrar: sin destino válido, la home', () => {
  expect(destinoTrasEntrar(null)).toBe('/')
  expect(destinoTrasEntrar(undefined)).toBe('/')
  expect(destinoTrasEntrar('')).toBe('/')
})

test('destinoTrasEntrar: nunca fuera de la app (open redirect)', () => {
  expect(destinoTrasEntrar('https://evil.com')).toBe('/')
  expect(destinoTrasEntrar('//evil.com')).toBe('/')
  expect(destinoTrasEntrar('/\\evil.com')).toBe('/')
  expect(destinoTrasEntrar('/\t/evil.com')).toBe('/')
  expect(destinoTrasEntrar('javascript:alert(1)')).toBe('/')
})

test('destinoTrasEntrar: ni el login ni el propio flujo de entrada (bucles)', () => {
  expect(destinoTrasEntrar('/login')).toBe('/')
  expect(destinoTrasEntrar('/auth/hub/entrar?next=/bancos')).toBe('/')
  expect(destinoTrasEntrar('/auth/hub/callback?code=x')).toBe('/')
  expect(destinoTrasEntrar('/auth')).toBe('/')
  // Solo /auth como segmento: una ruta que empieza igual no se toca.
  expect(destinoTrasEntrar('/autores')).toBe('/autores')
})

test('rutaEntrarHub y rutaLogin: next codificado, y sin next si es la home', () => {
  expect(rutaEntrarHub('/registros/5b1c')).toBe('/auth/hub/entrar?next=%2Fregistros%2F5b1c')
  expect(rutaEntrarHub('/reportes?a=1&b=2')).toBe('/auth/hub/entrar?next=%2Freportes%3Fa%3D1%26b%3D2')
  expect(rutaEntrarHub(null)).toBe('/auth/hub/entrar')
  expect(rutaEntrarHub('https://evil.com')).toBe('/auth/hub/entrar')
  expect(rutaLogin('/bancos')).toBe('/login?next=%2Fbancos')
  expect(rutaLogin(undefined)).toBe('/login')
})

test('rutaErrorHub: motivo y next validado', () => {
  expect(rutaErrorHub('sin-ficha')).toBe('/auth/hub/error?motivo=sin-ficha')
  expect(rutaErrorHub('caducada', '/bancos')).toBe('/auth/hub/error?motivo=caducada&next=%2Fbancos')
  expect(rutaErrorHub('fallo', '//evil.com')).toBe('/auth/hub/error?motivo=fallo')
})

test('motivoError: lo desconocido es un fallo genérico', () => {
  expect(motivoError('inactivo')).toBe('inactivo')
  expect(motivoError(['sin-acceso'])).toBe('sin-acceso')
  expect(motivoError('<script>')).toBe('fallo')
  expect(motivoError(undefined)).toBe('fallo')
})

test('urlAccesoDesdeIssuer: el issuer sin /oidc ni barras finales', () => {
  expect(urlAccesoDesdeIssuer('https://acceso.bastidafarina.com/oidc')).toBe('https://acceso.bastidafarina.com')
  expect(urlAccesoDesdeIssuer(' https://acceso.bastidafarina.com/oidc/ ')).toBe('https://acceso.bastidafarina.com')
  expect(urlAccesoDesdeIssuer('http://localhost:3001')).toBe('http://localhost:3001')
})

test('urlCierreSesion: session/end del issuer con el client_id', () => {
  expect(urlCierreSesion('https://acceso.bastidafarina.com/oidc', 'control-horas'))
    .toBe('https://acceso.bastidafarina.com/oidc/session/end?client_id=control-horas')
  expect(urlCierreSesion('https://acceso.bastidafarina.com/oidc/', 'a b')).toBe('https://acceso.bastidafarina.com/oidc/session/end?client_id=a%20b')
})

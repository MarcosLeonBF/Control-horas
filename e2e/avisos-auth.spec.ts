import { test, expect } from '@playwright/test'
import { autorizado } from '../lib/avisos/auth'

const req = (auth?: string) => new Request('https://plataforma.test/api/avisos/v1/x', { headers: auth ? { authorization: auth } : {} })

test('autorizado: solo con el Bearer exacto y con secreto configurado', () => {
  expect(autorizado(req('Bearer abc123'), 'abc123')).toBe(true)
  expect(autorizado(req('Bearer abc124'), 'abc123')).toBe(false)
  expect(autorizado(req('abc123'), 'abc123')).toBe(false)
  expect(autorizado(req(), 'abc123')).toBe(false)
  expect(autorizado(req('Bearer '), '')).toBe(false)
  expect(autorizado(req('Bearer abc123'), undefined)).toBe(false)
})

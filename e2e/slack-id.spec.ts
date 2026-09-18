import { test, expect } from '@playwright/test'
import { normalizarSlackId } from '../lib/slack-id'

// El ID de miembro de Slack es lo que los flujos usan para mencionar (<@U…>) o escribir
// por mensaje directo. Un handle o un nombre visible no sirven para eso: si se colaran, el
// mensaje saldría sin mención y sin ningún error visible. Por eso se valida al guardar.

test('normalizarSlackId: acepta IDs de miembro (U… y W… de Enterprise Grid)', () => {
  expect(normalizarSlackId('U01ABCD2EFG')).toEqual({ ok: true, valor: 'U01ABCD2EFG' })
  expect(normalizarSlackId('U12345678')).toEqual({ ok: true, valor: 'U12345678' }) // los antiguos, de 9
  expect(normalizarSlackId('W0123ABCDEF')).toEqual({ ok: true, valor: 'W0123ABCDEF' })
})

test('normalizarSlackId: arregla lo que suele traer un pegado', () => {
  expect(normalizarSlackId('  U01ABCD2EFG \n')).toEqual({ ok: true, valor: 'U01ABCD2EFG' })
  expect(normalizarSlackId('u01abcd2efg')).toEqual({ ok: true, valor: 'U01ABCD2EFG' })
})

test('normalizarSlackId: vacío es "sin asignar", no un error', () => {
  expect(normalizarSlackId('')).toEqual({ ok: true, valor: null })
  expect(normalizarSlackId('   ')).toEqual({ ok: true, valor: null })
  expect(normalizarSlackId(null)).toEqual({ ok: true, valor: null })
})

test('normalizarSlackId: rechaza handles, nombres y otros IDs de Slack', () => {
  expect(normalizarSlackId('@laura.gomez').ok).toBe(false)
  expect(normalizarSlackId('laura.gomez').ok).toBe(false)
  expect(normalizarSlackId('Laura Gómez').ok).toBe(false)
  expect(normalizarSlackId('C01ABCD2EFG').ok).toBe(false) // un canal, no una persona
  expect(normalizarSlackId('U123').ok).toBe(false) // demasiado corto
  expect(normalizarSlackId('<@U01ABCD2EFG>').ok).toBe(false) // la mención entera, no el ID
})

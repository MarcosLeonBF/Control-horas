import { test, expect } from '@playwright/test'
import type { AuditEntry, AuditSnapshotLine } from '../lib/horas/auditoria-types'
import {
  addDiasISO, agrupar, claveLinea, diaMadrid, diffLineas, filtrar,
  inicioDiaMadridUTC, opcionesDe, resumir, tieneDetalle, totalDe,
} from '../lib/horas/auditoria-types'

// Línea de snapshot mínima: los tests van cambiando lo que a cada uno le importa.
const linea = (p: Partial<AuditSnapshotLine> = {}): AuditSnapshotLine => ({
  project: 'Vancubic', area: 'CRM', department: 'Clientes', etapa: 'Setup',
  hours: 2, description: 'motivo', ...p,
})

const asiento = (p: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'a1', action: 'editar', actorId: 'u1', actorName: 'Marcos Ruiz',
  subjectName: 'Ana López', entryDate: '2026-08-03', totalHours: 8,
  at: '2026-08-04T10:12:00.000Z', before: null, after: null, ...p,
})

// --- Fechas ---------------------------------------------------------------

test('diaMadrid usa el dia del reloj de Madrid, no el de UTC', () => {
  // 23:30 UTC del 4 de agosto son las 01:30 del 5 en Madrid (verano, UTC+2).
  expect(diaMadrid('2026-08-04T23:30:00.000Z')).toBe('2026-08-05')
})

test('diaMadrid en invierno desplaza una sola hora', () => {
  // 23:30 UTC del 4 de enero son las 00:30 del 5 en Madrid (invierno, UTC+1).
  expect(diaMadrid('2026-01-04T23:30:00.000Z')).toBe('2026-01-05')
})

test('inicioDiaMadridUTC en verano cae a las 22:00 del dia anterior', () => {
  expect(inicioDiaMadridUTC('2026-08-05')).toBe('2026-08-04T22:00:00.000Z')
})

test('inicioDiaMadridUTC en invierno cae a las 23:00 del dia anterior', () => {
  expect(inicioDiaMadridUTC('2026-01-05')).toBe('2026-01-04T23:00:00.000Z')
})

test('addDiasISO suma y cruza el fin de mes', () => {
  expect(addDiasISO('2026-08-31', 1)).toBe('2026-09-01')
  expect(addDiasISO('2026-01-01', -1)).toBe('2025-12-31')
})

// --- Filtro ---------------------------------------------------------------

test('filtrar sin nada puesto devuelve todo', () => {
  const entries = [asiento({ id: 'a' }), asiento({ id: 'b', action: 'crear' })]
  expect(filtrar(entries, { acciones: [], actorKey: '', subjectKey: '' })).toHaveLength(2)
})

test('filtrar por accion deja solo las marcadas', () => {
  const entries = [
    asiento({ id: 'a', action: 'crear' }),
    asiento({ id: 'b', action: 'editar' }),
    asiento({ id: 'c', action: 'anular' }),
  ]
  const res = filtrar(entries, { acciones: ['editar', 'anular'], actorKey: '', subjectKey: '' })
  expect(res.map((e) => e.id)).toEqual(['b', 'c'])
})

test('filtrar por actor y por sujeto son filtros distintos', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u1', subjectName: 'Ana López' }),
    asiento({ id: 'b', actorId: 'u2', subjectName: 'Ana López' }),
  ]
  expect(filtrar(entries, { acciones: [], actorKey: 'u1', subjectKey: '' }).map((e) => e.id)).toEqual(['a'])
  expect(filtrar(entries, { acciones: [], actorKey: '', subjectKey: 'Ana López' }).map((e) => e.id)).toEqual(['a', 'b'])
})

// --- Agrupación -----------------------------------------------------------

test('agrupar por actor cuenta movimientos y acciones', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u1', action: 'editar', totalHours: 8 }),
    asiento({ id: 'b', actorId: 'u1', action: 'anular', totalHours: 2 }),
    asiento({ id: 'c', actorId: 'u2', action: 'crear', totalHours: 5 }),
  ]
  const grupos = agrupar(entries, 'actor', 'at')
  expect(grupos).toHaveLength(2)
  expect(grupos[0].key).toBe('u1')
  expect(grupos[0].entries).toHaveLength(2)
  expect(grupos[0].counts).toEqual({ crear: 0, editar: 1, anular: 1 })
  expect(grupos[0].hours).toBe(10)
})

test('agrupar por actor no funde a dos homonimos con id distinto', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u1', actorName: 'Ana López' }),
    asiento({ id: 'b', actorId: 'u2', actorName: 'Ana López' }),
  ]
  expect(agrupar(entries, 'actor', 'at')).toHaveLength(2)
})

test('agrupar por actor sin id cae al nombre como identidad', () => {
  const entries = [
    asiento({ id: 'a', actorId: null, actorName: 'Sistema' }),
    asiento({ id: 'b', actorId: null, actorName: 'Sistema' }),
  ]
  const grupos = agrupar(entries, 'actor', 'at')
  expect(grupos).toHaveLength(1)
  expect(grupos[0].label).toBe('Sistema')
})

test('agrupar ordena por volumen de movimientos', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u1' }),
    asiento({ id: 'b', actorId: 'u2' }),
    asiento({ id: 'c', actorId: 'u2' }),
  ]
  expect(agrupar(entries, 'actor', 'at').map((g) => g.key)).toEqual(['u2', 'u1'])
})

test('agrupar por dia ordena cronologico descendente, no por volumen', () => {
  const entries = [
    asiento({ id: 'a', at: '2026-08-01T09:00:00.000Z' }),
    asiento({ id: 'b', at: '2026-08-01T10:00:00.000Z' }),
    asiento({ id: 'c', at: '2026-08-03T09:00:00.000Z' }),
  ]
  expect(agrupar(entries, 'date', 'at').map((g) => g.key)).toEqual(['2026-08-03', '2026-08-01'])
})

test('agrupar por dia con base entry_date usa la fecha del registro, no la del movimiento', () => {
  const entries = [asiento({ at: '2026-08-04T10:00:00.000Z', entryDate: '2026-07-15' })]
  expect(agrupar(entries, 'date', 'entry_date')[0].key).toBe('2026-07-15')
})

test('agrupar por mes agrupa las claves YYYY-MM', () => {
  const entries = [
    asiento({ id: 'a', at: '2026-07-02T09:00:00.000Z' }),
    asiento({ id: 'b', at: '2026-07-30T09:00:00.000Z' }),
    asiento({ id: 'c', at: '2026-08-01T09:00:00.000Z' }),
  ]
  const grupos = agrupar(entries, 'month', 'at')
  expect(grupos.map((g) => g.key)).toEqual(['2026-08', '2026-07'])
  expect(grupos[1].entries).toHaveLength(2)
})

test('agrupar conserva el orden de entrada dentro del grupo', () => {
  const entries = [
    asiento({ id: 'nuevo', actorId: 'u1', at: '2026-08-04T10:00:00.000Z' }),
    asiento({ id: 'viejo', actorId: 'u1', at: '2026-08-01T10:00:00.000Z' }),
  ]
  expect(agrupar(entries, 'actor', 'at')[0].entries.map((e) => e.id)).toEqual(['nuevo', 'viejo'])
})

test('agrupar por none no produce grupos', () => {
  expect(agrupar([asiento()], 'none', 'at')).toEqual([])
})

// --- Diff -----------------------------------------------------------------

test('diffLineas marca una linea anadida', () => {
  const res = diffLineas([], [linea({ project: 'Vancubic' })])
  expect(res).toHaveLength(1)
  expect(res[0].mark).toBe('+')
  expect(res[0].hoursBefore).toBeNull()
  expect(res[0].hoursAfter).toBe(2)
})

test('diffLineas marca una linea eliminada', () => {
  const res = diffLineas([linea({ project: 'Vancubic' })], [])
  expect(res[0].mark).toBe('-')
  expect(res[0].hoursBefore).toBe(2)
  expect(res[0].hoursAfter).toBeNull()
})

test('diffLineas marca el cambio de horas de una misma linea', () => {
  const res = diffLineas([linea({ hours: 3 })], [linea({ hours: 4.5 })])
  expect(res).toHaveLength(1)
  expect(res[0].mark).toBe('~')
  expect(res[0].hoursBefore).toBe(3)
  expect(res[0].hoursAfter).toBe(4.5)
})

test('diffLineas deja sin marca lo que no cambio', () => {
  const res = diffLineas([linea()], [linea()])
  expect(res[0].mark).toBe('=')
})

// La descripción entra en la clave a propósito: en una auditoría un motivo
// reescrito es un cambio que debe verse entero, no un matiz de la misma línea.
test('diffLineas trata el motivo reescrito como par eliminada + anadida', () => {
  const res = diffLineas([linea({ description: 'viejo' })], [linea({ description: 'nuevo' })])
  expect(res.map((r) => r.mark)).toEqual(['+', '-'])
})

test('diffLineas ordena cambios, anadidas, eliminadas y por ultimo lo intacto', () => {
  const before = [
    linea({ project: 'Intacto' }),
    linea({ project: 'Cambia', hours: 1 }),
    linea({ project: 'Se va' }),
  ]
  const after = [
    linea({ project: 'Intacto' }),
    linea({ project: 'Cambia', hours: 9 }),
    linea({ project: 'Llega' }),
  ]
  expect(diffLineas(before, after).map((r) => r.mark)).toEqual(['~', '+', '-', '='])
})

test('diffLineas con snapshot ausente en un lado trata el otro entero', () => {
  expect(diffLineas(null, [linea()]).map((r) => r.mark)).toEqual(['+'])
  expect(diffLineas([linea()], null).map((r) => r.mark)).toEqual(['-'])
})

test('claveLinea distingue por proyecto, area, departamento, etapa y motivo', () => {
  expect(claveLinea(linea())).toBe(claveLinea(linea({ hours: 99 })))
  expect(claveLinea(linea())).not.toBe(claveLinea(linea({ etapa: 'Otra' })))
})

test('tieneDetalle es falso solo cuando faltan los dos snapshots', () => {
  expect(tieneDetalle(asiento({ before: null, after: null }))).toBe(false)
  expect(tieneDetalle(asiento({ before: null, after: [] }))).toBe(true)
  expect(tieneDetalle(asiento({ before: [], after: null }))).toBe(true)
})

test('totalDe suma las horas del snapshot y respeta el null', () => {
  expect(totalDe([linea({ hours: 2 }), linea({ hours: 3.5, project: 'Otro' })])).toBe(5.5)
  expect(totalDe(null)).toBeNull()
})

// --- Opciones y resumen ---------------------------------------------------

test('opcionesDe deduplica y ordena alfabeticamente', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u2', actorName: 'Zoe', subjectName: 'Ana López' }),
    asiento({ id: 'b', actorId: 'u1', actorName: 'Ana López', subjectName: 'Ana López' }),
    asiento({ id: 'c', actorId: 'u1', actorName: 'Ana López', subjectName: 'Beto' }),
  ]
  const { actores, sujetos } = opcionesDe(entries)
  expect(actores.map((o) => o.label)).toEqual(['Ana López', 'Zoe'])
  expect(sujetos.map((o) => o.label)).toEqual(['Ana López', 'Beto'])
})

test('resumir cuenta movimientos, ediciones, anulaciones y personas', () => {
  const entries = [
    asiento({ id: 'a', actorId: 'u1', action: 'crear' }),
    asiento({ id: 'b', actorId: 'u1', action: 'editar' }),
    asiento({ id: 'c', actorId: 'u2', action: 'anular' }),
  ]
  expect(resumir(entries)).toEqual({ movimientos: 3, ediciones: 1, anulaciones: 1, personas: 2 })
})

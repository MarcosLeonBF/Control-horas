import { test, expect } from '@playwright/test'
import type { AuditEntry, AuditSnapshotLine } from '../lib/horas/auditoria-types'
import {
  addDiasISO, agrupar, claveLinea, descripcionCambio, diaMadrid, diffLineas, filtrar,
  inicioDiaMadridUTC, opcionesDe, resumir, resumirCambio, tieneDetalle, totalDe,
  ultimoAsientoPorLog,
} from '../lib/horas/auditoria-types'

// Línea de snapshot mínima: los tests van cambiando lo que a cada uno le importa.
const linea = (p: Partial<AuditSnapshotLine> = {}): AuditSnapshotLine => ({
  project: 'Vancubic', area: 'CRM', department: 'Clientes', etapa: 'Setup',
  hours: 2, description: 'motivo', ...p,
})

const asiento = (p: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'a1', action: 'editar', actorId: 'u1', actorName: 'Marcos Ruiz',
  subjectName: 'Ana López', entryDate: '2026-08-03', totalHours: 8,
  at: '2026-08-04T10:12:00.000Z', cambio: null, ...p,
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

// La víspera del atraso de reloj (25 de octubre) sigue en CEST (+2) hasta la 01:00
// UTC de ese domingo: 22:30 UTC del 24 son, con offset +2, las 00:30 del 25 en
// Madrid — cruza de día aunque en UTC todavía es el 24.
test('diaMadrid la vispera del atraso de reloj sigue en offset de verano', () => {
  expect(diaMadrid('2026-10-24T22:30:00.000Z')).toBe('2026-10-25')
})

test('inicioDiaMadridUTC en verano cae a las 22:00 del dia anterior', () => {
  expect(inicioDiaMadridUTC('2026-08-05')).toBe('2026-08-04T22:00:00.000Z')
})

test('inicioDiaMadridUTC en invierno cae a las 23:00 del dia anterior', () => {
  expect(inicioDiaMadridUTC('2026-01-05')).toBe('2026-01-04T23:00:00.000Z')
})

// El adelanto de reloj de 2026 es el domingo 29 de marzo: a las 01:00 UTC (02:00
// CET) el reloj de Madrid salta a las 03:00 CEST. La medianoche local de ese mismo
// día (00:00) queda ANTES de ese salto, así que todavía rige el offset viejo, CET
// (+1) — igual que un día de invierno cualquiera. 00:00 local - 1h = 23:00 UTC del
// día anterior.
test('inicioDiaMadridUTC el dia del adelanto de reloj (29 marzo) usa aun el offset de invierno', () => {
  expect(inicioDiaMadridUTC('2026-03-29')).toBe('2026-03-28T23:00:00.000Z')
})

// El retraso de reloj de 2026 es el domingo 25 de octubre: a las 01:00 UTC (03:00
// CEST) el reloj de Madrid retrocede a las 02:00 CET. La medianoche local de ese
// mismo día (00:00) queda ANTES de ese retroceso, así que todavía rige el offset
// viejo, CEST (+2) — igual que un día de verano cualquiera. 00:00 local - 2h =
// 22:00 UTC del día anterior.
test('inicioDiaMadridUTC el dia del atraso de reloj (25 octubre) usa aun el offset de verano', () => {
  expect(inicioDiaMadridUTC('2026-10-25')).toBe('2026-10-24T22:00:00.000Z')
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

test('tieneDetalle es falso solo cuando el asiento no trae resumen del cambio', () => {
  expect(tieneDetalle(asiento({ cambio: null }))).toBe(false)
  expect(tieneDetalle(asiento({ cambio: resumirCambio(null, []) }))).toBe(true)
  expect(tieneDetalle(asiento({ cambio: { tipo: 'reconstruido', lineas: 2 } }))).toBe(true)
})

test('totalDe suma las horas del snapshot y respeta el null', () => {
  expect(totalDe([linea({ hours: 2 }), linea({ hours: 3.5, project: 'Otro' })])).toBe(5.5)
  expect(totalDe(null)).toBeNull()
})

// --- Resumen compacto del cambio ------------------------------------------

test('resumirCambio cuenta anadidas, eliminadas y cambiadas, con los dos totales', () => {
  const before = [linea({ project: 'Intacto' }), linea({ project: 'Cambia', hours: 1 }), linea({ project: 'Se va' })]
  const after = [linea({ project: 'Intacto' }), linea({ project: 'Cambia', hours: 9 }), linea({ project: 'Llega' })]
  expect(resumirCambio(before, after)).toEqual({
    tipo: 'snapshot', anadidas: 1, eliminadas: 1, cambiadas: 1, totalAntes: 5, totalDespues: 13,
  })
})

test('resumirCambio de un crear no inventa un total anterior', () => {
  expect(resumirCambio(null, [linea({ hours: 3 })])).toEqual({
    tipo: 'snapshot', anadidas: 1, eliminadas: 0, cambiadas: 0, totalAntes: null, totalDespues: 3,
  })
})

test('resumirCambio de un anular no inventa un total posterior', () => {
  expect(resumirCambio([linea({ hours: 3 })], null)).toEqual({
    tipo: 'snapshot', anadidas: 0, eliminadas: 1, cambiadas: 0, totalAntes: 3, totalDespues: null,
  })
})

test('descripcionCambio resume el diff con los dos totales', () => {
  const before = [linea({ project: 'Cambia', hours: 1 }), linea({ project: 'Se va' })]
  const after = [linea({ project: 'Cambia', hours: 9 })]
  expect(descripcionCambio(resumirCambio(before, after))).toBe('1 eliminada, 1 cambiada · 3,00h → 9,00h')
})

test('descripcionCambio dice que un reconstruido es estado final, sin recuentos de diff', () => {
  const texto = descripcionCambio({ tipo: 'reconstruido', lineas: 3 })
  expect(texto).toBe('Estado final del registro: 3 líneas (reconstruido)')
  expect(texto).not.toContain('añadida')
  expect(texto).not.toContain('eliminada')
})

test('descripcionCambio sin resumen dice que no hay detalle', () => {
  expect(descripcionCambio(null)).toBe('Sin detalle')
})

test('descripcionCambio de una edicion que no toco lineas no finge cambios', () => {
  expect(descripcionCambio(resumirCambio([linea()], [linea()]))).toBe('sin cambios en las líneas · 2,00h → 2,00h')
})

// --- Regla del "último movimiento del registro" ----------------------------

test('ultimoAsientoPorLog se queda con el mas reciente de cada registro', () => {
  const ultimo = ultimoAsientoPorLog([
    { id: 'a', logId: 'L1', at: '2026-07-01T10:00:00.000Z' },
    { id: 'b', logId: 'L1', at: '2026-07-09T10:00:00.000Z' },
    { id: 'c', logId: 'L2', at: '2026-07-05T10:00:00.000Z' },
  ])
  expect(ultimo.get('L1')).toBe('b')
  expect(ultimo.get('L2')).toBe('c')
})

// Un guardado multi-fecha escribe varios asientos con el mismo now(): sin desempate,
// "el último" saldría al azar y la reconstrucción se colgaría de la fila equivocada.
test('ultimoAsientoPorLog desempata por id cuando el instante es identico', () => {
  const filas = [
    { id: 'aaa', logId: 'L1', at: '2026-07-09T10:00:00.000Z' },
    { id: 'zzz', logId: 'L1', at: '2026-07-09T10:00:00.000Z' },
  ]
  expect(ultimoAsientoPorLog(filas).get('L1')).toBe('zzz')
  expect(ultimoAsientoPorLog([...filas].reverse()).get('L1')).toBe('zzz')
})

// Postgres guarda microsegundos y Date.parse trunca a milisegundos: si solo se
// comparasen los milisegundos, estas dos empatarían y desempataría el id, eligiendo
// la anterior.
test('ultimoAsientoPorLog distingue microsegundos dentro del mismo milisegundo', () => {
  const ultimo = ultimoAsientoPorLog([
    { id: 'zzz', logId: 'L1', at: '2026-07-09T10:00:00.123400+00:00' },
    { id: 'aaa', logId: 'L1', at: '2026-07-09T10:00:00.123900+00:00' },
  ])
  expect(ultimo.get('L1')).toBe('aaa')
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

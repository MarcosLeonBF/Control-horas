// Tipos y lógica pura de /admin/auditoria: fechas, filtro, agrupación y diff de
// snapshots. SIN imports de servidor, para poder probarlo con el proyecto
// `node-horas` de Playwright (mismo reparto que lib/horas/reportes-types.ts).
import { formatFechaISO, mesCorto } from '@/lib/horas/format'

export type AuditAction = 'crear' | 'editar' | 'anular'

export const AUDIT_ACTIONS: AuditAction[] = ['crear', 'editar', 'anular']

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  crear: 'Creación',
  editar: 'Edición',
  anular: 'Anulación',
}

// Una línea dentro de un snapshot. Los nombres vienen ya resueltos desde el RPC
// (migración 0041): el asiento es autocontenido y no depende de que el área o la
// etapa sigan existiendo.
export interface AuditSnapshotLine {
  project: string
  area: string
  department: string
  etapa: string
  hours: number
  description: string
}

export interface AuditEntry {
  id: string
  action: AuditAction
  actorId: string | null
  actorName: string
  subjectName: string
  entryDate: string | null // día de trabajo afectado (ISO)
  totalHours: number | null
  at: string               // instante del movimiento (ISO con zona)
  before: AuditSnapshotLine[] | null
  after: AuditSnapshotLine[] | null
}

// Sobre qué fecha se acota el rango y se agrupa por Día/Mes: el instante del
// movimiento, o el día de trabajo del registro afectado.
export type AuditDateBase = 'at' | 'entry_date'

export type AuditGroupBy = 'none' | 'actor' | 'subject' | 'action' | 'date' | 'month'

export const AUDIT_GROUP_LABELS: Record<AuditGroupBy, string> = {
  none: 'Ninguno',
  actor: 'Quien edita',
  subject: 'Usuario afectado',
  action: 'Acción',
  date: 'Día',
  month: 'Mes',
}

export const AUDIT_GROUP_ORDER: AuditGroupBy[] = ['none', 'actor', 'subject', 'action', 'date', 'month']

// --- Fechas ---------------------------------------------------------------

// 'en-CA' formatea como 'YYYY-MM-DD', que es justo la clave ISO que queremos.
const DIA_MADRID = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
})

// El día (ISO) al que pertenece un instante según el reloj de Madrid. `at` es un
// timestamptz: quedarse con los 10 primeros caracteres del ISO daría el día en UTC,
// y un movimiento de la 01:00 de Madrid aparecería como del día anterior.
export function diaMadrid(iso: string): string {
  return DIA_MADRID.format(new Date(iso))
}

const PARTES_MADRID = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Madrid', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

// Offset de Madrid, en minutos, en un instante dado (+120 en verano, +60 en invierno).
function offsetMadrid(d: Date): number {
  const p = Object.fromEntries(
    PARTES_MADRID.formatToParts(d).map((x) => [x.type, x.value]),
  ) as Record<string, string>
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return (comoUTC - d.getTime()) / 60000
}

// Instante UTC (ISO) en que empieza en Madrid el día ISO dado. Acota el rango sobre
// `at`: comparar un timestamptz contra 'YYYY-MM-DD' pelado lo tomaría como medianoche
// UTC y en verano se comería las dos primeras horas del día.
export function inicioDiaMadridUTC(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const tentativo = Date.UTC(y, m - 1, d)
  // Dos pasadas: la primera usa el offset del instante tentativo; la segunda lo
  // recalcula sobre el resultado, por si el cruce cae justo en un cambio de hora.
  let ms = tentativo - offsetMadrid(new Date(tentativo)) * 60000
  ms = tentativo - offsetMadrid(new Date(ms)) * 60000
  return new Date(ms).toISOString()
}

// Suma días a una fecha ISO ('2026-08-31', 1 → '2026-09-01').
export function addDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10)
}

// El día del asiento según la base elegida.
export function diaDe(entry: AuditEntry, base: AuditDateBase): string {
  return base === 'entry_date' ? (entry.entryDate ?? '') : diaMadrid(entry.at)
}

// --- Filtro ---------------------------------------------------------------

// Identidad del actor: el id cuando lo hay (dos personas pueden llamarse igual) y
// el nombre como respaldo, porque actor_id es nullable (perfil borrado).
export function actorKey(entry: AuditEntry): string {
  return entry.actorId ?? `nombre:${entry.actorName}`
}

export interface AuditFiltros {
  acciones: AuditAction[] // vacío = todas
  actorKey: string        // '' = todos
  subjectKey: string      // '' = todos
}

export function filtrar(entries: AuditEntry[], f: AuditFiltros): AuditEntry[] {
  return entries.filter(
    (e) =>
      (f.acciones.length === 0 || f.acciones.includes(e.action)) &&
      (!f.actorKey || actorKey(e) === f.actorKey) &&
      (!f.subjectKey || e.subjectName === f.subjectKey),
  )
}

// --- Agrupación -----------------------------------------------------------

export interface AuditGroup {
  key: string
  label: string
  entries: AuditEntry[]
  counts: Record<AuditAction, number>
  hours: number // suma de las horas de los registros tocados
}

function claveGrupo(
  e: AuditEntry,
  groupBy: Exclude<AuditGroupBy, 'none'>,
  base: AuditDateBase,
): { key: string; label: string } {
  switch (groupBy) {
    case 'actor':
      return { key: actorKey(e), label: e.actorName || '—' }
    case 'subject':
      // time_log_audit no guarda subject_id: aquí la identidad es el nombre, con el
      // riesgo conocido de fundir homónimos. Anotado en el spec como siguiente paso.
      return { key: e.subjectName || '—', label: e.subjectName || '—' }
    case 'action':
      return { key: e.action, label: AUDIT_ACTION_LABELS[e.action] }
    case 'date': {
      const d = diaDe(e, base)
      return { key: d || '—', label: d ? formatFechaISO(d) : '—' }
    }
    case 'month': {
      const m = diaDe(e, base).slice(0, 7)
      return { key: m || '—', label: m ? mesCorto(m) : '—' }
    }
  }
}

// Agrupa conservando el orden de entrada dentro de cada grupo: la vista pasa los
// asientos ya ordenados cronológicamente, y esa secuencia es lo que se viene a leer.
export function agrupar(entries: AuditEntry[], groupBy: AuditGroupBy, base: AuditDateBase): AuditGroup[] {
  if (groupBy === 'none') return []
  const by = new Map<string, AuditGroup>()
  for (const e of entries) {
    const { key, label } = claveGrupo(e, groupBy, base)
    const g = by.get(key) ?? { key, label, entries: [], counts: { crear: 0, editar: 0, anular: 0 }, hours: 0 }
    g.entries.push(e)
    g.counts[e.action] += 1
    g.hours += e.totalHours ?? 0
    by.set(key, g)
  }
  const grupos = [...by.values()].map((g) => ({ ...g, hours: Math.round(g.hours * 100) / 100 }))
  // Día y Mes van en orden cronológico descendente (la clave es ISO y ordena sola);
  // el resto, por volumen de movimientos.
  return groupBy === 'date' || groupBy === 'month'
    ? grupos.sort((a, b) => b.key.localeCompare(a.key))
    : grupos.sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label))
}

// --- Diff -----------------------------------------------------------------

export type DiffMark = '~' | '+' | '-' | '='

export interface DiffLine {
  mark: DiffMark
  line: AuditSnapshotLine    // la versión vigente: la de "después", salvo en '-'
  hoursBefore: number | null // null en '+'
  hoursAfter: number | null  // null en '-'
}

// Identidad de una línea dentro del snapshot. La descripción entra en la clave a
// propósito: en una auditoría, reescribir el motivo es un cambio que debe verse
// entero (sale como par eliminada + añadida), no como un matiz de la misma línea.
export function claveLinea(l: AuditSnapshotLine): string {
  return [l.project, l.area, l.department, l.etapa, l.description].join('|')
}

const PRIORIDAD: Record<DiffMark, number> = { '~': 0, '+': 1, '-': 2, '=': 3 }

// Compara los dos snapshots. Orden: primero lo que cambió, luego lo añadido, lo
// eliminado y por último lo intacto; dentro de cada bloque, por clave, para que dos
// lecturas del mismo asiento salgan siempre iguales.
export function diffLineas(
  before: AuditSnapshotLine[] | null,
  after: AuditSnapshotLine[] | null,
): DiffLine[] {
  const antes = new Map((before ?? []).map((l) => [claveLinea(l), l]))
  const despues = new Map((after ?? []).map((l) => [claveLinea(l), l]))
  const filas: DiffLine[] = []
  for (const [k, l] of despues) {
    const prev = antes.get(k)
    if (!prev) filas.push({ mark: '+', line: l, hoursBefore: null, hoursAfter: l.hours })
    else if (prev.hours !== l.hours) filas.push({ mark: '~', line: l, hoursBefore: prev.hours, hoursAfter: l.hours })
    else filas.push({ mark: '=', line: l, hoursBefore: prev.hours, hoursAfter: l.hours })
  }
  for (const [k, l] of antes) {
    if (!despues.has(k)) filas.push({ mark: '-', line: l, hoursBefore: l.hours, hoursAfter: null })
  }
  return filas.sort(
    (a, b) => PRIORIDAD[a.mark] - PRIORIDAD[b.mark] || claveLinea(a.line).localeCompare(claveLinea(b.line)),
  )
}

// Un asiento anterior a la migración 0041 no guardó snapshots: no hay diff que pintar
// y la pantalla debe decirlo, en vez de mostrar un desglose vacío que se leería como
// "no cambió nada". Un 'crear' nuevo siempre trae `after` y un 'anular' nuevo siempre
// trae `before`, así que la regla no da falsos positivos.
export function tieneDetalle(entry: AuditEntry): boolean {
  return entry.before !== null || entry.after !== null
}

export function totalDe(lines: AuditSnapshotLine[] | null): number | null {
  if (lines === null) return null
  return Math.round(lines.reduce((s, l) => s + l.hours, 0) * 100) / 100
}

// --- Opciones y resumen ---------------------------------------------------

export interface AuditOpcion { key: string; label: string }

// Opciones de los desplegables, derivadas de los asientos del rango: no tiene
// sentido ofrecer a alguien que no aparece en lo que se está mirando.
export function opcionesDe(entries: AuditEntry[]): { actores: AuditOpcion[]; sujetos: AuditOpcion[] } {
  const actores = new Map<string, string>()
  const sujetos = new Map<string, string>()
  for (const e of entries) {
    actores.set(actorKey(e), e.actorName || '—')
    sujetos.set(e.subjectName || '—', e.subjectName || '—')
  }
  const aOpciones = (m: Map<string, string>): AuditOpcion[] =>
    [...m.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  return { actores: aOpciones(actores), sujetos: aOpciones(sujetos) }
}

export interface AuditResumen {
  movimientos: number
  ediciones: number
  anulaciones: number
  personas: number
}

export function resumir(entries: AuditEntry[]): AuditResumen {
  const personas = new Set<string>()
  let ediciones = 0
  let anulaciones = 0
  for (const e of entries) {
    personas.add(actorKey(e))
    if (e.action === 'editar') ediciones += 1
    if (e.action === 'anular') anulaciones += 1
  }
  return { movimientos: entries.length, ediciones, anulaciones, personas: personas.size }
}

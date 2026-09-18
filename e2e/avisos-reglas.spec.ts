import { test, expect } from '@playwright/test'
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  resumirPorDia, motivosLlamativo, claveLlamativo, comoNivel, transicion, avisosDeBanco,
  siguienteIntento, MAX_INTENTOS, textoProyectos, descripcionLlamativo, registroPorProyecto, type Nivel,
} from '../lib/avisos/reglas'
import {
  diasSinRegistrar, diasPendientes, laborablesDesde, diaMes, ultimoAntesDe, dentroDePlazo, fechaDeConsulta,
} from '../lib/avisos/calendario'
import {
  nivelesDeBancos, rankingCapacidad, huchasParaRanking, datosAmpliacionHoras, porcentajeConsumido, porcentajeDisponible,
} from '../lib/avisos/capacidad'
import { firmar, construirEnvio } from '../lib/avisos/firma'
import type { BancoHorasRow } from '../lib/horas/bancos-status'

const dia = (total: number, porProyecto: Record<string, number>) => ({ total, porProyecto: new Map(Object.entries(porProyecto)) })
const fechas = (...d: string[]) => new Set(d)

// --- reglas ---------------------------------------------------------------

test('resumirPorDia suma por día y por proyecto, en centésimas', () => {
  const r = resumirPorDia([
    { dia: '2026-09-14', proyecto: 'A', horas: 0.1 },
    { dia: '2026-09-14', proyecto: 'A', horas: 0.2 },
    { dia: '2026-09-15', proyecto: 'B', horas: 3 },
  ])
  expect(r.get('2026-09-14')!.total).toBe(0.3)
  expect(r.get('2026-09-14')!.porProyecto.get('A')).toBe(0.3)
  expect(r.get('2026-09-15')!.total).toBe(3)
})

test('llamativo: más de 10 h en el día', () => {
  expect(motivosLlamativo(dia(11, { A: 4, B: 4, Departamento: 3 }))).toEqual([
    { regla: 'dia_largo', valor: 11, limite: 10, proyecto: null },
  ])
  expect(motivosLlamativo(dia(10, { A: 4, B: 4, Departamento: 2 }))).toEqual([])
})

test('llamativo: 5 h o más a un proyecto, sin contar Departamento', () => {
  expect(motivosLlamativo(dia(8, { A: 5, Departamento: 3 }))).toEqual([
    { regla: 'proyecto_largo', valor: 5, limite: 5, proyecto: 'A' },
  ])
  expect(motivosLlamativo(dia(8, { A: 4.99, Departamento: 3.01 }))).toEqual([])
  expect(motivosLlamativo(dia(7, { Departamento: 7 }))).toEqual([])
})

test('claveLlamativo distingue regla y proyecto', () => {
  expect(claveLlamativo('u1', '2026-09-14', { regla: 'dia_largo', valor: 11, limite: 10, proyecto: null }))
    .toBe('llamativo:u1:2026-09-14:dia_largo')
  expect(claveLlamativo('u1', '2026-09-14', { regla: 'proyecto_largo', valor: 6, limite: 6, proyecto: 'A' }))
    .toBe('llamativo:u1:2026-09-14:proyecto_largo:A')
})

test('comoNivel solo acepta los cuatro niveles', () => {
  expect(comoNivel('bajo')).toBe('bajo')
  expect(comoNivel('sin_asignacion')).toBeNull()
  expect(comoNivel('sin_presupuesto')).toBeNull()
  expect(comoNivel('toString')).toBeNull()
})

test('transicion: línea base, empeora, cruza al tope, mejora e igual', () => {
  expect(transicion(null, 'excedido')).toEqual({ guardar: true, avisar: false, alTope: false })
  expect(transicion('disponible', 'bajo')).toEqual({ guardar: true, avisar: true, alTope: false })
  expect(transicion('bajo', 'consumido')).toEqual({ guardar: true, avisar: true, alTope: true })
  expect(transicion('disponible', 'excedido')).toEqual({ guardar: true, avisar: true, alTope: true })
  expect(transicion('consumido', 'excedido')).toEqual({ guardar: true, avisar: true, alTope: false })
  expect(transicion('excedido', 'disponible')).toEqual({ guardar: true, avisar: false, alTope: false })
  expect(transicion('bajo', 'bajo')).toEqual({ guardar: false, avisar: false, alTope: false })
})

test('avisosDeBanco: el tope solo sale para el total del proyecto', () => {
  expect(avisosDeBanco(transicion('bajo', 'consumido'), 'posicion')).toEqual(['banco.nivel'])
  expect(avisosDeBanco(transicion('bajo', 'consumido'), 'proyecto')).toEqual(['banco.nivel', 'banco.al_tope'])
  expect(avisosDeBanco(transicion('consumido', 'excedido'), 'proyecto')).toEqual(['banco.nivel'])
})

test('avisosDeBanco: la línea base y el rearme no avisan', () => {
  expect(avisosDeBanco(transicion(null, 'excedido'), 'proyecto')).toEqual([])
  expect(avisosDeBanco(transicion('excedido', 'disponible'), 'proyecto')).toEqual([])
})

test('siguienteIntento: 5 min, 30 min, 2 h, 12 h y luego nada', () => {
  const t0 = new Date('2026-09-14T10:00:00.000Z')
  const mas = (min: number) => new Date(t0.getTime() + min * 60_000).toISOString()
  expect(siguienteIntento(1, t0)!.toISOString()).toBe(mas(5))
  expect(siguienteIntento(2, t0)!.toISOString()).toBe(mas(30))
  expect(siguienteIntento(3, t0)!.toISOString()).toBe(mas(120))
  expect(siguienteIntento(4, t0)!.toISOString()).toBe(mas(720))
  expect(siguienteIntento(MAX_INTENTOS, t0)).toBeNull()
})

test('textos listos para un mensaje (los del contrato)', () => {
  expect(textoProyectos([{ proyecto: 'Proyecto Ejemplo', horas: 5 }, { proyecto: 'Departamento', horas: 2.5 }]))
    .toBe('Proyecto Ejemplo (5 h), Departamento (2,5 h)')
  expect(descripcionLlamativo({ regla: 'dia_largo', valor: 11, limite: 10, proyecto: null }, '2026-09-14'))
    .toBe('11 h registradas el 14/09 (límite: 10 h)')
  expect(descripcionLlamativo({ regla: 'proyecto_largo', valor: 6.5, limite: 6, proyecto: 'A' }, '2026-09-14'))
    .toBe('6,5 h a A el 14/09 (límite: 6 h)')
})

// --- calendario (mié 16/09/2026; lun 14; vie 11) ----------------------------

test('días sin registrar: el ejemplo del contrato', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-16', registrados: fechas('2026-09-11'), festivos: fechas(), alta: '2026-01-01' }))
    .toEqual({ dias: 2, desde: '2026-09-14' })
})

test('días sin registrar: un festivo no cuenta', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-16', registrados: fechas('2026-09-11'), festivos: fechas('2026-09-15'), alta: '2026-01-01' }))
    .toEqual({ dias: 1, desde: '2026-09-14' })
})

test('días sin registrar: no cuenta días anteriores al alta', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-16', registrados: fechas(), festivos: fechas(), alta: '2026-09-15' }))
    .toEqual({ dias: 1, desde: '2026-09-15' })
})

test('días sin registrar: si registró el día anterior, cero', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-16', registrados: fechas('2026-09-15'), festivos: fechas(), alta: '2026-01-01' }))
    .toEqual({ dias: 0, desde: null })
})

test('días sin registrar: el lunes no cuenta el fin de semana', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-14', registrados: fechas('2026-09-11'), festivos: fechas(), alta: '2026-01-01' }))
    .toEqual({ dias: 0, desde: null })
})

test('días sin registrar: se para en el tope', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-16', registrados: fechas(), festivos: fechas(), alta: '2026-01-01', tope: 3 }))
    .toEqual({ dias: 3, desde: '2026-09-11' })
})

test('ultimoAntesDe y dentroDePlazo', () => {
  expect(ultimoAntesDe(['2026-09-02', '2026-09-11', '2026-09-16'], '2026-09-16')).toBe('2026-09-11')
  expect(ultimoAntesDe([], '2026-09-16')).toBeNull()
  expect(dentroDePlazo('2026-09-09', '2026-09-16', 7)).toBe(true)
  expect(dentroDePlazo('2026-09-08', '2026-09-16', 7)).toBe(false)
})

test('fechaDeConsulta: hoy por defecto, y 400 con formato raro o fecha futura', () => {
  expect(fechaDeConsulta(null, '2026-09-14')).toEqual({ fecha: '2026-09-14' })
  expect(fechaDeConsulta('2026-09-14', '2026-09-14')).toEqual({ fecha: '2026-09-14' })
  expect(fechaDeConsulta('2026-09-01', '2026-09-14')).toEqual({ fecha: '2026-09-01' })
  expect(fechaDeConsulta('2026-09-15', '2026-09-14')).toEqual({ error: 'El parámetro fecha no puede ser posterior a hoy.' })
  expect(fechaDeConsulta('14/09/2026', '2026-09-14')).toEqual({ error: 'El parámetro fecha tiene que ser YYYY-MM-DD.' })
})

test('días pendientes: falta el lunes, registró el martes y hoy es miércoles', () => {
  const r = { fecha: '2026-09-16', registrados: fechas('2026-09-10', '2026-09-11', '2026-09-15'), festivos: fechas(), alta: '2026-09-10' }
  expect(diasSinRegistrar(r)).toEqual({ dias: 0, desde: null })
  expect(diasPendientes(r)).toEqual(['2026-09-14'])
})

test('días pendientes: ni lunes ni martes, del más antiguo al más reciente', () => {
  expect(diasPendientes({ fecha: '2026-09-16', registrados: fechas('2026-09-11'), festivos: fechas(), alta: '2026-09-11' }))
    .toEqual(['2026-09-14', '2026-09-15'])
})

test('días pendientes: sin fines de semana, festivos, hoy ni días anteriores al alta', () => {
  expect(diasPendientes({ fecha: '2026-09-14', registrados: fechas(), festivos: fechas('2026-09-11'), alta: '2026-09-10' }))
    .toEqual(['2026-09-10'])
  expect(diasPendientes({ fecha: '2026-09-16', registrados: fechas(), festivos: fechas(), alta: '2026-09-16' })).toEqual([])
})

test('días pendientes: mira solo los últimos N laborables, registrados o no', () => {
  expect(diasPendientes({ fecha: '2026-09-16', registrados: fechas('2026-09-14'), festivos: fechas(), alta: '2026-01-01', tope: 3 }))
    .toEqual(['2026-09-11', '2026-09-15'])
})

test('laborablesDesde: del pendiente más antiguo hasta ayer, sin fines de semana ni festivos', () => {
  expect(laborablesDesde('2026-09-04', '2026-09-16', fechas())).toBe(8)
  expect(laborablesDesde('2026-09-04', '2026-09-16', fechas('2026-09-11'))).toBe(7)
  expect(laborablesDesde('2026-09-15', '2026-09-16', fechas())).toBe(1)
  expect(laborablesDesde('2026-09-11', '2026-09-14', fechas())).toBe(1)
})

test('diaMes: dd-mm sin año', () => {
  expect(diaMes('2026-09-04')).toBe('04-09')
  expect(diaMes('2027-01-08')).toBe('08-01')
  expect(['2026-12-15', '2026-12-22', '2027-01-08'].map(diaMes)).toEqual(['15-12', '22-12', '08-01'])
})

// --- capacidad -------------------------------------------------------------

const fila = (p: Partial<BancoHorasRow> & Pick<BancoHorasRow, 'project' | 'position'>): BancoHorasRow => ({
  assigned: 0, consumed: 0, remaining: 0, inutilizables: 0, carryNeto: 0, status: 'sin_asignacion',
  monthly: [], projectEstado: 'Activo', manager: 'Carlos Ruiz', ...p,
})

test('porcentajeConsumido con un decimal, y null sin base', () => {
  expect(porcentajeConsumido(40, 33.5)).toBe(83.8)
  expect(porcentajeConsumido(148, 40)).toBe(27)
  expect(porcentajeConsumido(0, 5)).toBeNull()
})

test('porcentajeDisponible: lo que falta hasta 100, con un decimal, y null sin base', () => {
  expect(porcentajeDisponible(83.8)).toBe(16.2)
  expect(porcentajeDisponible(112.5)).toBe(-12.5)
  expect(porcentajeDisponible(null)).toBeNull()
})

test('nivelesDeBancos: posición con banco, total con ampliaciones, sin inactivos', () => {
  const rows = [
    fila({ project: 'A', position: 'SEO Strategist', assigned: 40, consumed: 33.5, remaining: 6.5, status: 'bajo' }),
    fila({ project: 'A', position: 'CRM', assigned: 0, consumed: 2, remaining: -2, status: 'excedido' }),
    fila({ project: 'B', position: 'CRM', assigned: 100, consumed: 100, remaining: 0, status: 'consumido' }),
    fila({ project: 'C', position: 'CRM', assigned: 10, consumed: 10, remaining: 0, status: 'consumido', projectEstado: 'Finalizado' }),
  ]
  const n = nivelesDeBancos(rows, new Map([['A', 20]]))
  expect(n.map((x) => [x.clave, x.nivel])).toEqual([
    ['banco:A:SEO Strategist', 'bajo'],
    ['banco:A:*', 'disponible'], // 40 + 20 ampliadas = 60; consumidas 35,5 → quedan 24,5
    ['banco:B:CRM', 'consumido'],
    ['banco:B:*', 'consumido'],
  ])
  const totalA = n.find((x) => x.clave === 'banco:A:*')!
  expect(totalA.horas).toEqual({ asignadas: 60, ampliadas: 20, consumidas: 35.5, inutilizables: 0, disponibles: 24.5 })
  expect(totalA.alcance).toBe('proyecto')
  expect(totalA.posicion).toBeNull()
  expect(totalA.managerExcel).toBe('Carlos Ruiz')
})

// Sin tope (pedido de Roberto, 2026-09-18): cada lista trae TODOS los proyectos, solo
// cambia el orden. "Sin tope" no es "sin reglas": las listas por porcentaje siguen
// dejando fuera los que no tienen base (porcentaje null).
test('rankingCapacidad: todos, ordenados por horas disponibles y por porcentaje', () => {
  const it = (proyecto: string, disponibles: number, pct: number | null) => ({
    proyecto, horas: { asignadas: 0, ampliadas: 0, consumidas: 0, inutilizables: 0, disponibles }, porcentajeConsumido: pct,
  })
  const r = rankingCapacidad([it('A', 10, 90), it('B', 50, 40), it('C', 30, 10), it('D', 0, null), it('E', -5, 120)],
    (x) => x.horas.disponibles)
  expect(r.conMas.map((x) => x.proyecto)).toEqual(['B', 'C', 'A', 'D', 'E'])
  expect(r.conMenos.map((x) => x.proyecto)).toEqual(['E', 'D', 'A', 'C', 'B'])
  expect(r.masLibres.map((x) => x.proyecto)).toEqual(['C', 'B', 'A', 'E']) // sin base (D) no entra en las listas por %
  expect(r.menosLibres.map((x) => x.proyecto)).toEqual(['E', 'A', 'B', 'C'])
})

// El mismo ranking sirve para HUCHA: lo único que cambia es qué se entiende por
// "disponible" (euros en vez de horas). Si alguien vuelve a atar el ranking a
// `horas.disponibles`, este test deja de compilar.
test('rankingCapacidad: rankea HUCHA por el presupuesto disponible', () => {
  const it = (proyecto: string, disponible: number, pct: number | null) => ({
    proyecto, presupuesto: { asignado: 0, consumido: 0, disponible }, porcentajeConsumido: pct,
  })
  const r = rankingCapacidad([it('A', 900, 10), it('B', 50, 95), it('C', 300, 70), it('D', -20, null)],
    (x) => x.presupuesto.disponible)
  expect(r.conMas.map((x) => x.proyecto)).toEqual(['A', 'C', 'B', 'D'])
  expect(r.conMenos.map((x) => x.proyecto)).toEqual(['D', 'B', 'C', 'A'])
  expect(r.masLibres.map((x) => x.proyecto)).toEqual(['A', 'C', 'B'])
  expect(r.menosLibres.map((x) => x.proyecto)).toEqual(['B', 'C', 'A'])
})

// banco.ampliacion: lo que sale de la base (quién, cuánto, por qué) llega siempre; lo que
// sale del Excel (el estado del banco) llega si Graph respondió, y si no, en null. Un hipo
// de Graph nunca se come el aviso de una ampliación (decisión de Roberto, 2026-09-18).
test('datosAmpliacionHoras: con el Excel trae el banco; sin él, null pero el aviso sale', () => {
  const amp = { project: 'P', hours: 20, reason: 'Venta al cliente', entry_date: '2026-09-18' }
  const actor = { nombre: 'Marta López', email: 'marta@ejemplo.com', equipo: 'RRHH' }
  const total = nivelesDeBancos(
    [fila({ project: 'P', position: 'CRM', assigned: 100, consumed: 40, remaining: 60, status: 'disponible' })],
    new Map([['P', 20]]),
  ).find((n) => n.alcance === 'proyecto')

  const con = datosAmpliacionHoras(amp, actor, total, null, 'https://app.test/bancos/P')
  expect(con.horas_ampliacion).toBe(20)
  expect(con.horas).toEqual({ asignadas: 120, ampliadas: 20, consumidas: 40, inutilizables: 0, disponibles: 80 })
  expect(con.nivel).toBe('disponible')
  expect(con.porcentaje_consumido).toBe(33.3)

  const sin = datosAmpliacionHoras(amp, actor, undefined, null, 'https://app.test/bancos/P')
  expect(sin.horas).toBeNull()
  expect(sin.nivel).toBeNull()
  expect(sin.porcentaje_consumido).toBeNull()
  // Lo que no depende del Excel sigue ahí.
  expect(sin).toMatchObject({
    proyecto: 'P', horas_ampliacion: 20, motivo: 'Venta al cliente', dia: '2026-09-18', actor,
    enlace: 'https://app.test/bancos/P',
  })
})

test('huchasParaRanking: fuera las que no tienen presupuesto; % sobre el asignado', () => {
  const h = (id: string, asignado: number, consumido: number, nivel: Nivel | null) => ({
    id, saldo: { asignado, consumido, disponible: asignado - consumido }, nivel,
  })
  const r = huchasParaRanking([
    h('ok', 3000, 2450, 'bajo'),
    h('sin', 0, 0, null), // sin_presupuesto: nada que rankear
    h('pasada', 1000, 1200, 'excedido'),
  ])
  expect(r.map((x) => x.id)).toEqual(['ok', 'pasada'])
  // El asignado de HUCHA ya incluye las ampliaciones (lo suma el ledger), así que no
  // hay que sumarlas aparte como en el banco de horas.
  expect(r[0].porcentajeConsumido).toBe(81.7)
  expect(r[1].porcentajeConsumido).toBe(120)
})

// banco.nivel enlaza el registro que lo hizo caer. Un guardado puede partirse en varios
// registros (uno por día), y un mismo proyecto puede aparecer en varios: se enlaza el del
// día más reciente. Departamento no tiene banco, así que no entra.
test('registroPorProyecto: el registro del día más reciente de cada proyecto', () => {
  const lineas = [
    { entry_date: '2026-09-16', project: 'A' },
    { entry_date: '2026-09-18', project: 'A' },
    { entry_date: '2026-09-16', project: ' B ' },
    { entry_date: '2026-09-18', project: 'Departamento' },
  ]
  const logPorDia = new Map([['2026-09-16', 'log-16'], ['2026-09-18', 'log-18']])
  const r = registroPorProyecto(lineas, logPorDia)
  expect(r.get('A')).toEqual({ id: 'log-18', dia: '2026-09-18' })
  expect(r.get('B')).toEqual({ id: 'log-16', dia: '2026-09-16' }) // el nombre se recorta, como en el detector
  expect(r.has('Departamento')).toBe(false)
})

test('registroPorProyecto: un día sin registro resuelto no inventa uno', () => {
  const r = registroPorProyecto([{ entry_date: '2026-09-18', project: 'A' }], new Map())
  expect(r.has('A')).toBe(false)
})

// --- firma -----------------------------------------------------------------

test('firma: vector conocido', () => {
  expect(firmar('{"id":"3f1c2a9e","tipo":"registro.enviado"}', 'secreto-de-prueba', 1757851930))
    .toBe('t=1757851930,v1=5dae7559f136b97314806773982eb26b8d92158a7712f268ad95314e6440bfb9')
})

test('construirEnvio: sobre v1 y una firma que valida el código del contrato', () => {
  const salida = { id: 'e1', tipo: 'registro.enviado', datos: { dia: '2026-09-14' }, prueba: true, intentos: 1, created_at: '2026-09-14T15:32:10.412+00:00' }
  const ahora = new Date('2026-09-14T15:32:11.000Z')
  const { cuerpo, cabeceras } = construirEnvio(salida, 'secreto-de-prueba', ahora)
  expect(JSON.parse(cuerpo)).toEqual({
    id: 'e1', tipo: 'registro.enviado', version: 1, fecha: '2026-09-14T15:32:10.412Z', prueba: true, datos: { dia: '2026-09-14' },
  })
  expect(cabeceras['Content-Type']).toBe('application/json')
  expect(cabeceras['X-Avisos-Id']).toBe('e1')
  expect(cabeceras['X-Avisos-Tipo']).toBe('registro.enviado')
  // La misma verificación que el contrato le da a Julián para n8n/Zapier.
  const partes = Object.fromEntries(cabeceras['X-Avisos-Firma'].split(',').map((p) => p.split('=')))
  expect(partes.t).toBe(String(Math.floor(ahora.getTime() / 1000)))
  const esperada = createHmac('sha256', 'secreto-de-prueba').update(`${partes.t}.${cuerpo}`).digest('hex')
  expect(timingSafeEqual(Buffer.from(esperada), Buffer.from(partes.v1))).toBe(true)
})

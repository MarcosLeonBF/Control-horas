import { test, expect } from '@playwright/test'
import { TIPOS_AVISO, DESCRIPCION_TIPO, ejemplos } from '../lib/avisos/contrato'
import { appUrl, enlaceBanco, esPersonaDePrueba } from '../lib/avisos/entorno'
import { textoProyectos, descripcionLlamativo, LIMITE_PROYECTO_HORAS } from '../lib/avisos/reglas'

test('hay un ejemplo y una descripción por cada tipo', () => {
  const e = ejemplos('https://app.test')
  expect(Object.keys(e).sort()).toEqual([...TIPOS_AVISO].sort())
  for (const t of TIPOS_AVISO) expect(DESCRIPCION_TIPO[t].length).toBeGreaterThan(0)
})

test('los ejemplos cuadran con las reglas (los textos no se escriben dos veces a mano)', () => {
  const e = ejemplos('https://app.test')
  expect(textoProyectos(e['registro.enviado'].proyectos)).toBe(e['registro.enviado'].proyectos_texto)
  const l = e['registro.llamativo']
  expect(descripcionLlamativo({ regla: l.regla, valor: l.valor, limite: l.limite, proyecto: l.proyecto }, l.dia)).toBe(l.descripcion)
  expect(e['banco.al_tope'].alcance).toBe('proyecto')
  expect(e['banco.nivel'].enlace).toBe('https://app.test/bancos/Proyecto%20Ejemplo')
})

test('la prueba de registro.llamativo trae un proyecto y la de ampliación, el email de quien amplía', () => {
  const e = ejemplos('https://app.test')
  const l = e['registro.llamativo']
  expect(l.regla).toBe('proyecto_largo')
  expect(l.proyecto).toBe('Proyecto Ejemplo')
  expect(l.limite).toBe(LIMITE_PROYECTO_HORAS)
  expect(e['hucha.ampliacion'].actor).toEqual({ nombre: 'Marta López', email: 'marta.lopez@ejemplo.com', equipo: 'RRHH' })
})

// Los avisos que nacen de un registro llevan el enlace a ese registro (/registros/<id>),
// para abrirlo desde Slack. En banco.nivel, además, quién lo hizo y qué día: es lo que
// permite decir "el banco bajó por el registro de Laura" sin abrir el enlace.
test('los avisos de registro y el de nivel de banco enlazan al registro', () => {
  const e = ejemplos('https://app.test')
  expect(e['registro.enviado'].enlace_registro).toMatch(/^https:\/\/app\.test\/registros\/[0-9a-f-]{36}$/)
  expect(e['registro.llamativo'].enlace_registro).toMatch(/^https:\/\/app\.test\/registros\/[0-9a-f-]{36}$/)
  const reg = e['banco.nivel'].registro
  expect(reg?.enlace).toMatch(/^https:\/\/app\.test\/registros\/[0-9a-f-]{36}$/)
  expect(reg?.persona.nombre).toBe('Laura Gómez')
  expect(reg?.dia).toBe('2026-09-14')
})

// El equipo (0049) es lo que usan los flujos para enrutar, así que ninguna persona del
// payload puede quedarse sin la clave: si un tipo nuevo trae una persona y se olvida el
// equipo, este test lo caza antes de que Julián reciba un payload a medias.
test('toda persona del payload trae su equipo', () => {
  const e = ejemplos('https://app.test')
  expect(e['registro.enviado'].persona.equipo).toBe('Clientes')
  expect(e['registro.enviado'].manager_directo?.equipo).toBe('Clientes')
  expect(e['registro.llamativo'].persona.equipo).toBe('Clientes')
  expect(e['banco.nivel'].manager_proyecto?.equipo).toBe('Clientes')
  expect(e['hucha.ampliacion'].actor.equipo).toBe('RRHH')
  expect(e['banco.ampliacion'].actor.equipo).toBe('RRHH')
  expect(e['banco.ampliacion'].manager_proyecto?.equipo).toBe('Clientes')
  for (const t of ['hucha.proyecto_nuevo', 'hucha.ampliacion', 'hucha.nivel'] as const) {
    for (const m of e[t].managers) expect(m).toHaveProperty('equipo')
  }
})

test('appUrl: APP_URL sin barra final, o el dominio de producción de Vercel', () => {
  const antes = { app: process.env.APP_URL, vercel: process.env.VERCEL_PROJECT_PRODUCTION_URL }
  try {
    process.env.APP_URL = 'https://plataforma.test/'
    expect(appUrl()).toBe('https://plataforma.test')
    expect(enlaceBanco('Proyecto Ejemplo')).toBe('https://plataforma.test/bancos/Proyecto%20Ejemplo')
    delete process.env.APP_URL
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'control.vercel.app'
    expect(appUrl()).toBe('https://control.vercel.app')
  } finally {
    if (antes.app === undefined) delete process.env.APP_URL
    else process.env.APP_URL = antes.app
    if (antes.vercel === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = antes.vercel
  }
})

test('las personas que siembran los E2E no cuentan', () => {
  expect(esPersonaDePrueba('e2e-operativo@horas.test')).toBe(true)
  expect(esPersonaDePrueba('e2e-manager@hucha.test')).toBe(true)
  expect(esPersonaDePrueba('laura.gomez@bastidafarina.com')).toBe(false)
  expect(esPersonaDePrueba('alguien@test.com')).toBe(false)
  expect(esPersonaDePrueba(null)).toBe(false)
})

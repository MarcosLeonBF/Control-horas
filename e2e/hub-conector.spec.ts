import { test, expect } from '@playwright/test'
import {
  construirEsquema, esUuid, fichaDesdePerfil, parchePerfil, slackPedido, validarPut,
  type ContextoPut, type Ficha, type OpcionesVivas,
} from '../lib/hub/ficha'
import { cifrarEntrada, descifrarEntrada } from '../lib/hub/entrada'
import { rechazoConector } from '../lib/hub/conector'

// Conector de fichas para Acceso (docs/integrar-una-app.md §5). Puros: no tocan Supabase.
// npx playwright test -c playwright.puros.config.ts

const ID = '11111111-2222-4333-8444-555555555555'
const opciones: OpcionesVivas = {
  posiciones: [{ valor: 'pos-crm', etiqueta: 'CRM' }],
  equipos: [{ valor: 'eq-rrhh', etiqueta: 'RRHH' }],
  managers: [{ valor: 'mgr-1', etiqueta: 'Laura Gómez' }],
  areas: [{ valor: 'area-seo', etiqueta: 'SEO' }, { valor: 'area-crm', etiqueta: 'CRM' }],
}
const nuevo: ContextoPut = { id: ID, opciones, actual: null, slackDeOtro: null }
const alta = { email: 'laura@ejemplo.com', nombre: 'Laura Gómez', activo: true, datos: { slack_id: 'U01ABCD2EFG' } }
const existente: Ficha = {
  activo: true,
  datos: {
    role: 'manager', slack_id: 'U01ABCD2EFG', position_id: 'pos-vieja', equipo_id: null, manager_id: null,
    areas: ['area-vieja'], registro_dias_atras: 30, can_create_users: true,
  },
}

test('esquema: los campos de profiles, con las reglas de la base y del panel', () => {
  const { version, campos } = construirEsquema(opciones)
  expect(version).toBe(1)
  expect(campos.map((c) => c.clave)).toEqual([
    'role', 'slack_id', 'position_id', 'equipo_id', 'manager_id', 'areas', 'registro_dias_atras', 'can_create_users',
  ])
  const campo = (clave: string) => campos.find((c) => c.clave === clave)!
  expect(campo('role')).toMatchObject({ tipo: 'seleccion', requerido: true, porDefecto: 'operativo' })
  expect(campo('role').opciones!.map((o) => o.valor)).toEqual(['operativo', 'manager', 'admin'])
  // El mismo patrón que el CHECK profiles_slack_id_formato (0050).
  expect(campo('slack_id')).toMatchObject({ tipo: 'texto', requerido: true, patron: '^[UW][A-Z0-9]{8,}$' })
  expect(campo('position_id').opciones).toEqual(opciones.posiciones)
  expect(campo('manager_id').opciones).toEqual(opciones.managers)
  expect(campo('equipo_id').opciones).toEqual(opciones.equipos)
  expect(campo('areas')).toMatchObject({ tipo: 'seleccion_multiple', opciones: opciones.areas })
  // El rango del CHECK profiles_registro_dias_atras_check (0043).
  expect(campo('registro_dias_atras')).toMatchObject({ tipo: 'numero', min: 1, max: 3650 })
  expect(campo('registro_dias_atras').requerido).toBeFalsy()
  expect(campo('can_create_users')).toMatchObject({ tipo: 'booleano', porDefecto: false })
  // Ni rayas largas ni medias en lo que ve la gente.
  expect(JSON.stringify(campos)).not.toMatch(/[–—]/)
})

test('esUuid: solo UUIDs', () => {
  expect(esUuid(ID)).toBe(true)
  expect(esUuid('no-es-un-uuid')).toBe(false)
  expect(esUuid(`${ID}x`)).toBe(false)
})

test('fichaDesdePerfil: activo según status y áreas desde user_areas', () => {
  expect(fichaDesdePerfil({
    status: 'inactivo', role: 'manager', slack_id: null, position_id: 'pos-crm', equipo_id: null, manager_id: 'mgr-1',
    registro_dias_atras: null, can_create_users: null, user_areas: [{ area_id: 'b' }, { area_id: 'a' }],
  })).toEqual({
    activo: false,
    datos: {
      role: 'manager', slack_id: null, position_id: 'pos-crm', equipo_id: null, manager_id: 'mgr-1',
      areas: ['a', 'b'], registro_dias_atras: null, can_create_users: false,
    },
  })
})

test('validarPut: alta mínima con los valores por defecto', () => {
  const r = validarPut(alta, nuevo)
  expect(r).toEqual({
    ok: true,
    valor: {
      email: 'laura@ejemplo.com', nombre: 'Laura Gómez', activo: true,
      datos: {
        role: 'operativo', slack_id: 'U01ABCD2EFG', position_id: null, equipo_id: null, manager_id: null,
        areas: [], registro_dias_atras: null, can_create_users: false,
      },
    },
  })
})

test('validarPut: correo, nombre y activo', () => {
  const r = validarPut({ email: 'no-es-correo', nombre: '  ', datos: { slack_id: 'U01ABCD2EFG' } }, nuevo)
  expect(r.ok).toBe(false)
  if (r.ok) return
  expect(Object.keys(r.errores).sort()).toEqual(['activo', 'email', 'nombre'])
  expect(validarPut('texto', nuevo)).toEqual({ ok: false, errores: { cuerpo: expect.any(String) } })
  expect(validarPut({ ...alta, datos: [] }, nuevo)).toMatchObject({ ok: false, errores: { datos: expect.any(String) } })
})

test('validarPut: ID de Slack obligatorio al crear, normalizado y con formato', () => {
  expect(validarPut({ ...alta, datos: {} }, nuevo)).toMatchObject({ ok: false, errores: { slack_id: 'El ID de Slack es obligatorio.' } })
  expect(validarPut({ ...alta, datos: { slack_id: '@laura' } }, nuevo)).toMatchObject({ ok: false, errores: { slack_id: expect.stringMatching(/no es válido/) } })
  expect(validarPut({ ...alta, datos: { slack_id: 42 } }, nuevo)).toMatchObject({ ok: false, errores: { slack_id: expect.stringMatching(/no es válido/) } })
  const r = validarPut({ ...alta, datos: { slack_id: ' u01abcd2efg ' } }, nuevo)
  expect(r.ok && r.valor.datos.slack_id).toBe('U01ABCD2EFG')
})

test('validarPut: ID de Slack opcional al editar, como en /admin/usuarios', () => {
  const r = validarPut({ ...alta, datos: { slack_id: '' } }, { ...nuevo, actual: existente })
  expect(r.ok && r.valor.datos.slack_id).toBeNull()
})

test('validarPut: ID de Slack que ya tiene otra persona', () => {
  expect(validarPut(alta, { ...nuevo, slackDeOtro: 'Pedro Ruiz' }))
    .toMatchObject({ ok: false, errores: { slack_id: 'Ese ID de Slack ya lo tiene Pedro Ruiz.' } })
  expect(validarPut(alta, { ...nuevo, slackDeOtro: '' }))
    .toMatchObject({ ok: false, errores: { slack_id: 'Ese ID de Slack ya lo tiene otra persona.' } })
})

test('slackPedido: el ID normalizado que hay que comprobar en la base', () => {
  expect(slackPedido({ datos: { slack_id: ' u01abcd2efg' } })).toBe('U01ABCD2EFG')
  expect(slackPedido({ datos: { slack_id: '@laura' } })).toBeNull()
  expect(slackPedido({ datos: {} })).toBeNull()
  expect(slackPedido(null)).toBeNull()
})

test('validarPut: selecciones contra las opciones vivas', () => {
  const r = validarPut({ ...alta, datos: { ...alta.datos, role: 'manager', position_id: 'pos-crm', equipo_id: 'eq-rrhh', manager_id: 'mgr-1', areas: ['area-seo'] } }, nuevo)
  expect(r.ok && r.valor.datos).toMatchObject({ role: 'manager', position_id: 'pos-crm', equipo_id: 'eq-rrhh', manager_id: 'mgr-1', areas: ['area-seo'] })

  const malo = validarPut({ ...alta, datos: { ...alta.datos, role: 'jefe', position_id: 'x', equipo_id: 'x', manager_id: 'x', areas: ['area-seo', 'x'] } }, nuevo)
  expect(malo.ok).toBe(false)
  if (malo.ok) return
  expect(Object.keys(malo.errores).sort()).toEqual(['areas', 'equipo_id', 'manager_id', 'position_id', 'role'])
})

test('validarPut: vacío o null deja sin asignar', () => {
  const r = validarPut({ ...alta, datos: { ...alta.datos, position_id: '', equipo_id: null, manager_id: null, areas: null, registro_dias_atras: '' } }, { ...nuevo, actual: existente })
  expect(r.ok && r.valor.datos).toMatchObject({ position_id: null, equipo_id: null, manager_id: null, areas: [], registro_dias_atras: null })
})

test('validarPut: nadie es su propio manager directo', () => {
  const ctx = { ...nuevo, opciones: { ...opciones, managers: [...opciones.managers, { valor: ID, etiqueta: 'Laura' }] } }
  expect(validarPut({ ...alta, datos: { ...alta.datos, manager_id: ID } }, ctx))
    .toMatchObject({ ok: false, errores: { manager_id: 'Nadie puede ser su propio manager directo.' } })
})

test('validarPut: lo que no viene se conserva al editar (un PUT que solo cambia el nombre no borra nada)', () => {
  const r = validarPut({ email: 'otra@ejemplo.com', nombre: 'Laura G.', activo: true }, { ...nuevo, actual: existente })
  expect(r).toEqual({ ok: true, valor: { email: 'otra@ejemplo.com', nombre: 'Laura G.', activo: true, datos: existente.datos } })
})

test('validarPut: devolver lo guardado nunca es un error, aunque ya no esté entre las opciones vivas', () => {
  const r = validarPut({ ...alta, datos: existente.datos }, { ...nuevo, actual: existente })
  expect(r.ok && r.valor.datos).toEqual(existente.datos)
})

test('validarPut: días hacia atrás, enteros entre 1 y 3650', () => {
  const con = (registro_dias_atras: unknown) => validarPut({ ...alta, datos: { ...alta.datos, registro_dias_atras } }, nuevo)
  expect(con(30)).toMatchObject({ ok: true, valor: { datos: { registro_dias_atras: 30 } } })
  expect(con('45')).toMatchObject({ ok: true, valor: { datos: { registro_dias_atras: 45 } } })
  for (const malo of [0, 3651, 2.5, 'mucho', true]) {
    expect(con(malo)).toMatchObject({ ok: false, errores: { registro_dias_atras: 'Los días deben ser un número entero entre 1 y 3650.' } })
  }
})

test('validarPut: el permiso de alta es sí o no', () => {
  expect(validarPut({ ...alta, datos: { ...alta.datos, can_create_users: 'sí' } }, nuevo))
    .toMatchObject({ ok: false, errores: { can_create_users: expect.any(String) } })
})

test('validarPut: las reglas del panel según el rol', () => {
  // Operativo: sin áreas de visibilidad (registra por su posición).
  const op = validarPut({ ...alta, datos: { ...alta.datos, role: 'operativo', areas: ['area-seo'] } }, nuevo)
  expect(op.ok && op.valor.datos.areas).toEqual([])
  // Admin: sin permiso delegado de alta ni ventana ampliada, que no le hacen nada.
  const adm = validarPut({ ...alta, datos: { ...alta.datos, role: 'admin', can_create_users: true, registro_dias_atras: 30, areas: ['area-crm'] } }, nuevo)
  expect(adm.ok && adm.valor.datos).toMatchObject({ can_create_users: false, registro_dias_atras: null, areas: ['area-crm'] })
})

test('parchePerfil: las columnas de profiles, con status según activo', () => {
  const r = validarPut({ ...alta, activo: false }, nuevo)
  if (!r.ok) throw new Error('debería validar')
  expect(parchePerfil(r.valor)).toEqual({
    full_name: 'Laura Gómez', email: 'laura@ejemplo.com', status: 'inactivo', role: 'operativo', slack_id: 'U01ABCD2EFG',
    position_id: null, equipo_id: null, manager_id: null, registro_dias_atras: null, can_create_users: false,
  })
})

test('cookie de entrada: ida y vuelta, y nada si se altera o es de otra clave', async () => {
  const entrada = { verifier: 'v', state: 's', nonce: 'n', next: '/bancos' }
  const cookie = await cifrarEntrada(entrada, 'secreto-del-cliente')
  expect(cookie).not.toContain('/bancos') // cifrada, no solo firmada
  expect(await descifrarEntrada(cookie, 'secreto-del-cliente')).toEqual(entrada)
  expect(await descifrarEntrada(cookie, 'otro-secreto')).toBeNull()
  // JWE compacto: cabecera.clave.iv.cifrado.etiqueta. Se cambia el primer carácter del cifrado
  // (6 bits enteros; el último de un segmento puede ser solo relleno y no cambiar nada).
  const partes = cookie.split('.')
  partes[3] = (partes[3][0] === 'A' ? 'B' : 'A') + partes[3].slice(1)
  expect(await descifrarEntrada(partes.join('.'), 'secreto-del-cliente')).toBeNull()
  expect(await descifrarEntrada(undefined, 'secreto-del-cliente')).toBeNull()
})

test('rechazoConector: 404 sin Acceso, 401 sin el secreto, pasa con él', async () => {
  const antes = { issuer: process.env.ACCESO_ISSUER, secreto: process.env.ACCESO_CONECTOR_SECRETO }
  const pide = (auth?: string) => new Request('https://horas.test/api/hub/esquema', { headers: auth ? { authorization: auth } : {} })
  try {
    delete process.env.ACCESO_ISSUER
    process.env.ACCESO_CONECTOR_SECRETO = 'secreto-del-conector'
    expect(rechazoConector(pide('Bearer secreto-del-conector'))?.status).toBe(404)

    process.env.ACCESO_ISSUER = 'https://acceso.test/oidc'
    expect(rechazoConector(pide())?.status).toBe(401)
    expect(rechazoConector(pide('Bearer otro'))?.status).toBe(401)
    expect(rechazoConector(pide('secreto-del-conector'))?.status).toBe(401)
    expect(rechazoConector(pide('Bearer secreto-del-conector'))).toBeNull()

    delete process.env.ACCESO_CONECTOR_SECRETO // sin secreto configurado no pasa nadie
    expect(rechazoConector(pide('Bearer '))?.status).toBe(401)
  } finally {
    if (antes.issuer === undefined) delete process.env.ACCESO_ISSUER
    else process.env.ACCESO_ISSUER = antes.issuer
    if (antes.secreto === undefined) delete process.env.ACCESO_CONECTOR_SECRETO
    else process.env.ACCESO_CONECTOR_SECRETO = antes.secreto
  }
})

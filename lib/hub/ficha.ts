// Ficha de Control de Gestión en el conector de Acceso (docs/integrar-una-app.md §5): qué
// datos de la app pide Acceso al dar de alta o editar a una persona, cómo se validan y cómo
// se guardan en profiles + user_areas.
//
// Puro (sin Supabase ni Next): las reglas se prueban en e2e/hub-conector.spec.ts. La lectura
// y la escritura en la base están en lib/hub/conector.ts.
//
// Las reglas no se inventan aquí: copian las de /admin/usuarios (actions.ts y sus
// formularios) y las de la base (CHECKs de las migraciones). Si cambian allí, cambian aquí.
import { AYUDA_SLACK_ID, PATRON_SLACK_ID, normalizarSlackId } from '@/lib/slack-id'
import { DIAS_REGISTRO_POR_DEFECTO } from '@/lib/horas/ventana-registro'

export type Rol = 'operativo' | 'manager' | 'admin'

export interface Opcion { valor: string; etiqueta: string }

// Contrato de Acceso (docs/integrar-una-app.md §5).
export interface Campo {
  clave: string
  etiqueta: string
  ayuda?: string
  requerido?: boolean
  tipo: 'texto' | 'numero' | 'booleano' | 'seleccion' | 'seleccion_multiple'
  opciones?: Opcion[]
  patron?: string
  min?: number
  max?: number
  porDefecto?: unknown
}
export interface Esquema { version: 1; campos: Campo[] }

// Opciones vivas de la app, leídas en cada petición (lib/hub/conector.ts).
export interface OpcionesVivas {
  posiciones: Opcion[] // positions activas
  equipos: Opcion[] // equipos activos (0049)
  managers: Opcion[] // perfiles activos con rol manager o admin: los candidatos a manager directo
  areas: Opcion[] // áreas activas no internas: las que el panel deja marcar como visibles
}

export interface DatosFicha {
  role: Rol
  slack_id: string | null
  position_id: string | null
  equipo_id: string | null
  manager_id: string | null
  areas: string[]
  registro_dias_atras: number | null
  can_create_users: boolean
}
export interface Ficha { activo: boolean; datos: DatosFicha }

// Rango del CHECK profiles_registro_dias_atras_check (0043), el mismo que valida
// actualizarDiasRegistro.
export const DIAS_ATRAS_MIN = 1
export const DIAS_ATRAS_MAX = 3650

const ROLES: { valor: Rol; etiqueta: string }[] = [
  { valor: 'operativo', etiqueta: 'Operativo' },
  { valor: 'manager', etiqueta: 'Manager' },
  { valor: 'admin', etiqueta: 'Administrador' },
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// El {id} de las rutas es el `sub` de Acceso, que es el id de auth.users: un UUID. Lo que no
// lo sea no puede ser nadie de esta app (y Supabase lo rechazaría con un error menos claro).
export function esUuid(id: string): boolean {
  return UUID.test(id)
}

// Campos en el orden y con las etiquetas del formulario de /admin/usuarios. Obligatorios los
// mismos que en el alta de allí: el rol (siempre tiene valor) y el ID de Slack.
export function construirEsquema(o: OpcionesVivas): Esquema {
  return {
    version: 1,
    campos: [
      {
        clave: 'role', etiqueta: 'Rol', tipo: 'seleccion', requerido: true, opciones: ROLES, porDefecto: 'operativo',
        ayuda: 'Manager ve los registros, bancos y reportes de sus áreas. Administrador ve y gestiona todo.',
      },
      {
        clave: 'slack_id', etiqueta: 'ID de Slack', tipo: 'texto', requerido: true,
        patron: PATRON_SLACK_ID.source, ayuda: AYUDA_SLACK_ID,
      },
      {
        clave: 'position_id', etiqueta: 'Posición (banco de horas)', tipo: 'seleccion', opciones: o.posiciones,
        ayuda: 'De su posición sale el área con la que registra.',
      },
      {
        clave: 'equipo_id', etiqueta: 'Equipo (empresa)', tipo: 'seleccion', opciones: o.equipos,
        ayuda: 'A qué parte de la empresa pertenece. Lo usan los avisos para saber por dónde enviarlos.',
      },
      {
        clave: 'manager_id', etiqueta: 'Manager directo', tipo: 'seleccion', opciones: o.managers,
        ayuda: 'A quién escala el recordatorio de días sin registrar.',
      },
      {
        clave: 'areas', etiqueta: 'Áreas que puede ver', tipo: 'seleccion_multiple', opciones: o.areas, porDefecto: [],
        ayuda: 'Solo para manager y administrador: verá los registros, bancos y reportes de estas áreas. Con rol operativo no se guardan.',
      },
      {
        clave: 'registro_dias_atras', etiqueta: 'Días hacia atrás que puede registrar', tipo: 'numero',
        min: DIAS_ATRAS_MIN, max: DIAS_ATRAS_MAX,
        ayuda: `Vacío: la ventana normal de ${DIAS_REGISTRO_POR_DEFECTO} días. El administrador registra sin límite.`,
      },
      {
        clave: 'can_create_users', etiqueta: 'Puede dar de alta usuarios', tipo: 'booleano', porDefecto: false,
        ayuda: 'Solo operativos y managers. El administrador ya puede por su rol.',
      },
    ],
  }
}

// Fila de profiles (con sus user_areas) tal como la lee el conector.
export interface PerfilLeido {
  status: string
  role: string
  slack_id: string | null
  position_id: string | null
  equipo_id: string | null
  manager_id: string | null
  registro_dias_atras: number | null
  can_create_users: boolean | null
  user_areas?: { area_id: string }[] | null
}

export function fichaDesdePerfil(p: PerfilLeido): Ficha {
  return {
    activo: p.status === 'activo',
    datos: {
      role: esRol(p.role) ? p.role : 'operativo',
      slack_id: p.slack_id ?? null,
      position_id: p.position_id ?? null,
      equipo_id: p.equipo_id ?? null,
      manager_id: p.manager_id ?? null,
      areas: (p.user_areas ?? []).map((a) => a.area_id).sort(),
      registro_dias_atras: p.registro_dias_atras ?? null,
      can_create_users: p.can_create_users === true,
    },
  }
}

function esRol(x: unknown): x is Rol {
  return x === 'operativo' || x === 'manager' || x === 'admin'
}

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

// El ID de Slack que pide el PUT, ya normalizado, o null si no pide ninguno válido. Sirve para
// comprobar en la base, antes de validar, si ya lo tiene otra persona (índice único, 0050).
export function slackPedido(cuerpo: unknown): string | null {
  if (!esObjeto(cuerpo) || !esObjeto(cuerpo.datos)) return null
  const raw = cuerpo.datos.slack_id
  if (typeof raw !== 'string') return null
  const n = normalizarSlackId(raw)
  return n.ok ? n.valor : null
}

export interface PutValido { email: string; nombre: string; activo: boolean; datos: DatosFicha }
export type Errores = Record<string, string>
export type ResultadoPut = { ok: true; valor: PutValido } | { ok: false; errores: Errores }

export interface ContextoPut {
  id: string // la persona: nadie puede ser su propio manager directo
  opciones: OpcionesVivas
  actual: Ficha | null // su ficha de ahora; null si se crea
  slackDeOtro: string | null // nombre de quien ya tiene el ID de Slack pedido, si es otra persona
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MENSAJE_SLACK = 'El ID de Slack no es válido: es el ID de miembro, empieza por U (p. ej. U01ABCD2EFG), no el @usuario.'

// Valida el cuerpo de PUT /usuarios/{id} ({ email, nombre, activo, datos }) con autoridad:
// errores en español por clave, como pide el contrato.
//
// Una clave que no viene en `datos` conserva su valor actual (o el de por defecto si la ficha
// se crea): así un PUT que solo propaga un cambio de nombre no borra nada. Una clave que viene
// con null o "" se vacía, si el campo lo admite.
//
// Un valor que ya tiene guardado la persona se acepta aunque ya no esté entre las opciones
// vivas (una posición desactivada, un manager que dejó de serlo): devolver a Acceso su ficha
// tal cual nunca puede ser un error.
export function validarPut(cuerpo: unknown, ctx: ContextoPut): ResultadoPut {
  if (!esObjeto(cuerpo)) return { ok: false, errores: { cuerpo: 'El cuerpo tiene que ser un objeto JSON.' } }
  const errores: Errores = {}
  const actual = ctx.actual?.datos ?? null

  const email = typeof cuerpo.email === 'string' ? cuerpo.email.trim() : ''
  if (!EMAIL.test(email)) errores.email = 'El correo no es válido.'
  const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
  if (!nombre) errores.nombre = 'El nombre es obligatorio.'
  const activo = cuerpo.activo
  if (typeof activo !== 'boolean') errores.activo = 'Falta indicar si está activo (sí o no).'

  const datos = cuerpo.datos ?? {}
  if (!esObjeto(datos)) return { ok: false, errores: { ...errores, datos: 'Los datos tienen que ser un objeto.' } }
  const viene = (clave: string) => Object.prototype.hasOwnProperty.call(datos, clave)
  const vacio = (v: unknown) => v === null || v === ''

  let role: Rol = actual?.role ?? 'operativo'
  if (viene('role')) {
    if (esRol(datos.role)) role = datos.role
    else errores.role = 'El rol tiene que ser operativo, manager o administrador.'
  }

  // Formato y unicidad, como resolverSlackId de /admin/usuarios. Obligatorio solo al crear la
  // ficha, igual que allí: al editar sigue siendo opcional porque hay perfiles anteriores sin él.
  let slack = actual?.slack_id ?? null
  if (viene('slack_id')) {
    const raw = datos.slack_id
    const n = raw === null || typeof raw === 'string' ? normalizarSlackId(raw) : ({ ok: false } as const)
    if (n.ok) slack = n.valor
    else errores.slack_id = MENSAJE_SLACK
  }
  if (!errores.slack_id) {
    if (!slack && !ctx.actual) errores.slack_id = 'El ID de Slack es obligatorio.'
    else if (slack && ctx.slackDeOtro !== null) errores.slack_id = `Ese ID de Slack ya lo tiene ${ctx.slackDeOtro || 'otra persona'}.`
  }

  const seleccion = (clave: keyof DatosFicha, opciones: Opcion[], mensaje: string): string | null => {
    const guardado = (actual?.[clave] as string | null | undefined) ?? null
    if (!viene(clave)) return guardado
    const v = datos[clave]
    if (vacio(v)) return null
    if (typeof v === 'string' && (v === guardado || opciones.some((o) => o.valor === v))) return v
    errores[clave] = mensaje
    return guardado
  }
  const position_id = seleccion('position_id', ctx.opciones.posiciones, 'Esa posición no existe o está desactivada.')
  const equipo_id = seleccion('equipo_id', ctx.opciones.equipos, 'Ese equipo no existe o está desactivado.')
  const manager_id = seleccion('manager_id', ctx.opciones.managers, 'El manager directo tiene que ser un manager o un administrador activo.')
  // El CHECK profiles_manager_no_propio (0046), con el mensaje de actualizarUsuario.
  if (manager_id && manager_id === ctx.id) errores.manager_id = 'Nadie puede ser su propio manager directo.'

  let areas = actual?.areas ?? []
  if (viene('areas')) {
    const v = datos.areas
    const permitidas = new Set([...ctx.opciones.areas.map((o) => o.valor), ...(actual?.areas ?? [])])
    if (v === null) areas = []
    else if (!Array.isArray(v) || v.some((a) => typeof a !== 'string')) errores.areas = 'Las áreas tienen que ser una lista.'
    else if (v.some((a) => !permitidas.has(a))) errores.areas = 'Alguna de las áreas no existe o está desactivada.'
    else areas = [...new Set(v as string[])].sort()
  }

  let registro_dias_atras = actual?.registro_dias_atras ?? null
  if (viene('registro_dias_atras')) {
    const v = datos.registro_dias_atras
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN
    if (vacio(v)) registro_dias_atras = null
    else if (Number.isInteger(n) && n >= DIAS_ATRAS_MIN && n <= DIAS_ATRAS_MAX) registro_dias_atras = n
    else errores.registro_dias_atras = `Los días deben ser un número entero entre ${DIAS_ATRAS_MIN} y ${DIAS_ATRAS_MAX}.`
  }

  let can_create_users = actual?.can_create_users ?? false
  if (viene('can_create_users')) {
    const v = datos.can_create_users
    if (typeof v === 'boolean') can_create_users = v
    else if (v === null) can_create_users = false
    else errores.can_create_users = 'Tiene que ser sí o no.'
  }

  if (Object.keys(errores).length) return { ok: false, errores }

  // Lo que hace /admin/usuarios al guardar según el rol: el operativo no tiene áreas de
  // visibilidad (registra por su posición), y al admin se le apagan el permiso delegado de
  // alta y la ventana ampliada, que no le hacen nada.
  if (role === 'operativo') areas = []
  if (role === 'admin') {
    can_create_users = false
    registro_dias_atras = null
  }

  return {
    ok: true,
    valor: {
      email, nombre, activo: activo as boolean,
      datos: { role, slack_id: slack, position_id, equipo_id, manager_id, areas, registro_dias_atras, can_create_users },
    },
  }
}

// Columnas de profiles que escribe un PUT válido. Las áreas van aparte, a user_areas.
export function parchePerfil(v: PutValido) {
  const d = v.datos
  return {
    full_name: v.nombre,
    email: v.email,
    status: v.activo ? 'activo' : 'inactivo',
    role: d.role,
    slack_id: d.slack_id,
    position_id: d.position_id,
    equipo_id: d.equipo_id,
    manager_id: d.manager_id,
    registro_dias_atras: d.registro_dias_atras,
    can_create_users: d.can_create_users,
  }
}

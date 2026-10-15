// Conector de fichas para Acceso (docs/integrar-una-app.md §5, rutas en app/api/hub/*):
// Acceso crea, lee, edita y da de baja la ficha de Control de Gestión de cada persona. El
// {id} es el `sub` de Acceso, que aquí es el id de auth.users y de profiles.
//
// Esta app es la dueña de los datos y valida con autoridad (lib/hub/ficha.ts). Aquí solo
// está la autenticación y la lectura y escritura en Supabase, con el service role.
import { randomBytes } from 'node:crypto'
import type { User } from '@supabase/supabase-js'
import { autorizado } from '@/lib/avisos/auth'
import { hubActivo } from '@/lib/hub/config'
import {
  fichaDesdePerfil, parchePerfil, slackPedido, validarPut, type Errores, type Ficha, type OpcionesVivas, type PerfilLeido,
} from '@/lib/hub/ficha'
import { createAdminClient } from '@/lib/supabase/admin'

type Db = ReturnType<typeof createAdminClient>

// 100 años: lo que en Supabase es "baneado sin fecha de fin". Se levanta con 'none'.
const BANEO = '876000h'
const COLUMNAS_PERFIL =
  'status, role, slack_id, position_id, equipo_id, manager_id, registro_dias_atras, can_create_users, user_areas(area_id)'

// Puerta de todas las rutas del conector. Sin Acceso activo no existe (404, para no decir
// nada). Con Acceso, solo con `Authorization: Bearer ${ACCESO_CONECTOR_SECRETO}`, comparado
// en tiempo constante (autorizado, el mismo que las rutas de avisos). Sin secreto configurado
// no pasa nadie.
export function rechazoConector(req: Request): Response | null {
  if (!hubActivo()) return new Response(null, { status: 404 })
  if (!autorizado(req, process.env.ACCESO_CONECTOR_SECRETO)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  return null
}

// Un fallo de la base no es culpa de Acceso: 500 con un mensaje, y el detalle al log. Acceso
// deja el acceso "pendiente" y ofrece reintentar.
export function errorInterno(e: unknown): Response {
  console.error('[acceso] conector', e)
  return Response.json({ error: 'Error interno de Control de Gestión' }, { status: 500 })
}

export async function opcionesVivas(db: Db): Promise<OpcionesVivas> {
  const [posiciones, equipos, managers, areas] = await Promise.all([
    db.from('positions').select('id, name').eq('active', true).order('name'),
    db.from('equipos').select('id, name').eq('active', true).order('name'),
    // Los mismos candidatos que el panel de usuarios: managers y admins activos.
    db.from('profiles').select('id, full_name, email').in('role', ['manager', 'admin']).eq('status', 'activo').order('full_name'),
    // Las mismas que el panel deja marcar: activas y no internas.
    db.from('areas').select('id, name').eq('active', true).eq('is_internal', false).order('name'),
  ])
  for (const r of [posiciones, equipos, managers, areas]) if (r.error) throw new Error(r.error.message)
  return {
    posiciones: (posiciones.data ?? []).map((p) => ({ valor: p.id as string, etiqueta: p.name as string })),
    equipos: (equipos.data ?? []).map((e) => ({ valor: e.id as string, etiqueta: e.name as string })),
    managers: (managers.data ?? []).map((m) => ({ valor: m.id as string, etiqueta: (m.full_name as string) || (m.email as string) || 'Sin nombre' })),
    areas: (areas.data ?? []).map((a) => ({ valor: a.id as string, etiqueta: a.name as string })),
  }
}

export async function leerFicha(db: Db, id: string): Promise<Ficha | null> {
  const { data, error } = await db.from('profiles').select(COLUMNAS_PERFIL).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? fichaDesdePerfil(data as unknown as PerfilLeido) : null
}

// El usuario de auth, o null si no existe. Otros errores se lanzan.
async function usuarioAuth(db: Db, id: string): Promise<User | null> {
  const { data, error } = await db.auth.admin.getUserById(id)
  if (error && error.status !== 404) throw new Error(`getUserById: ${error.message}`)
  return data?.user ?? null
}

// El correo ya es de otra cuenta de Supabase: es un dato de la persona, no un fallo (422).
function errorCorreo(e: { code?: string; message: string }): Errores | null {
  return e.code === 'email_exists' || /already (been )?registered|already exists/i.test(e.message)
    ? { email: 'Ese correo ya lo usa otra cuenta de Control de Gestión.' }
    : null
}

export type ResultadoGuardar = { ok: true; ficha: Ficha } | { ok: false; errores: Errores }

// PUT /usuarios/{id}: crea la ficha si no existe y la actualiza si existe.
export async function guardarFicha(db: Db, id: string, cuerpo: unknown): Promise<ResultadoGuardar> {
  const slack = slackPedido(cuerpo)
  const [usuario, actual, opciones, slackDeOtro] = await Promise.all([
    usuarioAuth(db, id),
    leerFicha(db, id),
    opcionesVivas(db),
    slack ? quienTieneSlack(db, slack, id) : Promise.resolve(null),
  ])
  const v = validarPut(cuerpo, { id, opciones, actual, slackDeOtro })
  if (!v.ok) return v
  const { email, nombre, activo } = v.valor

  if (!usuario) {
    // Persona nueva para esta app: su usuario de Supabase con el mismo id que en Acceso, el
    // correo ya confirmado y una contraseña aleatoria que nadie conoce (se entra por Acceso).
    // El trigger on_auth_user_created (0001) crea su fila de profiles, que se completa abajo.
    // user_metadata como el alta de /admin/usuarios.
    const { error } = await db.auth.admin.createUser({
      id, email, email_confirm: true, password: randomBytes(32).toString('base64url'),
      user_metadata: { full_name: nombre },
    })
    if (error) {
      const correo = errorCorreo(error)
      if (correo) return { ok: false, errores: correo }
      throw new Error(`createUser: ${error.message}`)
    }
    if (!activo) await banear(db, id)
  } else {
    // Ya existe: el correo si cambió (confirmado, sin correo de por medio) y el baneo según
    // `activo`. Reactivar levanta el baneo que dejó una baja anterior.
    const cambiaCorreo = (usuario.email ?? '').toLowerCase() !== email.toLowerCase()
    const { error } = await db.auth.admin.updateUserById(id, {
      ...(cambiaCorreo ? { email, email_confirm: true } : {}),
      ban_duration: activo ? 'none' : BANEO,
    })
    if (error) {
      const correo = errorCorreo(error)
      if (correo) return { ok: false, errores: correo }
      throw new Error(`updateUserById: ${error.message}`)
    }
  }

  // upsert y no update: si el perfil faltara (el trigger falló, o se borró a mano), se crea.
  // must_change_password en false: con Acceso no aplica, y al crear la base lo pone en true.
  const { error: errorPerfil } = await db.from('profiles').upsert({
    id, ...parchePerfil(v.valor), ...(actual ? {} : { must_change_password: false }),
  })
  if (errorPerfil) {
    // Dos guardados a la vez pueden chocar en el índice único del ID de Slack (0050).
    if (errorPerfil.code === '23505' && errorPerfil.message.includes('slack_id')) {
      return { ok: false, errores: { slack_id: 'Ese ID de Slack ya lo tiene otra persona.' } }
    }
    throw new Error(`profiles: ${errorPerfil.message}`)
  }

  // Áreas de visibilidad: se reemplazan enteras, como en actualizarUsuario.
  const { error: errorBorrar } = await db.from('user_areas').delete().eq('user_id', id)
  if (errorBorrar) throw new Error(`user_areas (borrar): ${errorBorrar.message}`)
  if (v.valor.datos.areas.length) {
    const { error } = await db.from('user_areas').insert(v.valor.datos.areas.map((area_id) => ({ user_id: id, area_id })))
    if (error) throw new Error(`user_areas: ${error.message}`)
  }

  // Lo que quedó guardado de verdad, no lo que se pidió.
  const ficha = await leerFicha(db, id)
  if (!ficha) throw new Error('la ficha no aparece después de guardarla')
  return { ok: true, ficha }
}

// Nombre de quien ya tiene ese ID de Slack ('' si no tiene nombre), o null si nadie más lo tiene.
async function quienTieneSlack(db: Db, slack: string, id: string): Promise<string | null> {
  const { data, error } = await db.from('profiles').select('full_name').eq('slack_id', slack).neq('id', id).limit(1)
  if (error) throw new Error(`slack_id: ${error.message}`)
  return data?.length ? ((data[0].full_name as string | null) ?? '') : null
}

async function banear(db: Db, id: string): Promise<void> {
  const { error } = await db.auth.admin.updateUserById(id, { ban_duration: BANEO })
  if (error && error.status !== 404) throw new Error(`ban: ${error.message}`)
}

// POST /usuarios/{id}/baja: ficha inactiva y usuario baneado; no se borra nada.
//
// Cómo se cortan las sesiones abiertas: los layouts de Horas y HUCHA comprueban profiles.status
// en cada petición y, con Acceso, mandan a la página de "acceso desactivado" (corte inmediato
// en las páginas). El baneo impide renovar el token, así que la sesión de Supabase muere sola
// en cuanto caduca el access token. Las RPC de registro ya rechazan a un usuario inactivo.
//
// Idempotente: dar de baja a alguien sin ficha, o ya dado de baja, también es un 204.
export async function darDeBaja(db: Db, id: string): Promise<void> {
  const { error } = await db.from('profiles').update({ status: 'inactivo' }).eq('id', id)
  if (error) throw new Error(`profiles: ${error.message}`)
  await banear(db, id)
}

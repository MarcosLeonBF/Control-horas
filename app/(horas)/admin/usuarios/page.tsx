import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCatalogos } from '@/lib/horas/queries'
import UsuarioForm from '@/components/horas/UsuarioForm'
import UsuariosPanel, { type UsuarioRow, type PosicionOpt } from '@/components/horas/UsuariosPanel'
import DesactivarAusenciaBoton from '@/components/horas/DesactivarAusenciaBoton'
import { filasAusenciaDeHoy } from '@/lib/avisos/personas'
import { ausenciasHoy, ausenciasSinDesactivar, ausenciasSinUsuario, etiquetaAusencia } from '@/lib/avisos/vacaciones'
import { diaMadrid } from '@/lib/horas/auditoria-types'

interface RawUsuario {
  id: string; full_name: string; email: string; position_id: string | null
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'
  can_create_users: boolean
  registro_dias_atras: number | null
  manager_id: string | null
  equipo_id: string | null
  slack_id: string | null
  user_areas: { area_id: string }[]
}

export default async function UsuariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role, can_create_users').eq('id', user.id).single()
  const esAdmin = me?.role === 'admin'
  // Usuarios con permiso delegado (p. ej. RRHH): entran en modo lectura + alta.
  if (!esAdmin && !me?.can_create_users) redirect('/registrar')

  const { areas } = await getCatalogos()
  const { data: pos } = await supabase.from('positions').select('id, name').eq('active', true).order('name')
  const posiciones: PosicionOpt[] = (pos ?? []).map((p) => ({ id: p.id as string, name: p.name as string }))

  // Equipos de la empresa (0049), solo los activos: son las opciones asignables. El error
  // no se descarta, por lo mismo que la lista de usuarios de más abajo: sin la migración
  // aplicada el desplegable saldría vacío y parecería que no hay ninguno.
  const { data: eq, error: equiposError } = await supabase.from('equipos').select('id, name').eq('active', true).order('name')
  if (equiposError) throw new Error(`No se pudieron leer los equipos: ${equiposError.message}`)
  const equipos: PosicionOpt[] = (eq ?? []).map((e) => ({ id: e.id as string, name: e.name as string }))

  // Panel de usuarios: lista vía service role (la página ya está gated a admin).
  const admin = createAdminClient()
  // El error NO se descarta: al añadir registro_dias_atras antes de aplicar su
  // migración, este select falló en silencio y el panel se pintó vacío, como si no
  // hubiera usuarios. Una lista vacía y una consulta rota tienen que distinguirse.
  const { data: raw, error: usuariosError } = await admin
    .from('profiles')
    .select('id, full_name, email, position_id, role, status, can_create_users, registro_dias_atras, manager_id, equipo_id, slack_id, user_areas(area_id)')
    .order('full_name')
  if (usuariosError) throw new Error(`No se pudo leer la lista de usuarios: ${usuariosError.message}`)
  // Quién está de ausencia hoy, según los pulsos del flujo de Julián (0054). Por slack_id:
  // las que no casan con ningún usuario se listan aparte, debajo del panel.
  const hoy = diaMadrid(new Date().toISOString())
  const filasAusencia = await filasAusenciaDeHoy(admin, hoy)
  const ausencias = ausenciasHoy(filasAusencia, hoy)
  const slacksConUsuario = new Set(((raw ?? []) as RawUsuario[]).flatMap((u) => (u.slack_id ? [u.slack_id] : [])))
  const sinUsuario = ausenciasSinUsuario(filasAusencia, slacksConUsuario, hoy)
  // La red de las fechas, a la vista: siguen de vacaciones (las fechas no apagan solas) y hay
  // que revisar por qué no llegó el desactivar; un admin puede desactivarlas aquí.
  const nombrePorSlack = new Map(((raw ?? []) as RawUsuario[]).flatMap((u) => (u.slack_id ? [[u.slack_id, u.full_name] as const] : [])))
  const sinDesactivar = ausenciasSinDesactivar(filasAusencia, hoy)
  const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
  const usuarios: UsuarioRow[] = ((raw ?? []) as RawUsuario[]).map((u) => ({
    id: u.id, full_name: u.full_name, email: u.email, positionId: u.position_id,
    role: u.role, status: u.status, canCreateUsers: u.can_create_users, areaIds: (u.user_areas ?? []).map((a) => a.area_id),
    registroDiasAtras: u.registro_dias_atras, managerId: u.manager_id, equipoId: u.equipo_id, slackId: u.slack_id,
    ausencia: (() => {
      const a = u.slack_id ? ausencias.get(u.slack_id) : undefined
      return a ? etiquetaAusencia(a, hoy) : null
    })(),
  }))

  // Candidatos a manager directo: managers y admins activos.
  const managers: PosicionOpt[] = usuarios
    .filter((u) => (u.role === 'manager' || u.role === 'admin') && u.status === 'activo')
    .map((u) => ({ id: u.id, name: u.full_name }))

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="font-display text-2xl">Usuarios</h1>
        <UsuariosPanel usuarios={usuarios} areas={areas} posiciones={posiciones} managers={managers} equipos={equipos} readOnly={!esAdmin} />
        {/* Plegado: casi siempre será gente de Slack que no usa la plataforma. Lo que importa
            es encontrar a un usuario al que le falta cargar su ID de Slack. */}
        {sinDesactivar.length > 0 && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <p className="font-medium">No llegó el desactivar a tiempo ({sinDesactivar.length})</p>
            <p className="mt-1 text-xs">
              Su Fecha fin ya pasó y siguen de vacaciones: las fechas no desactivan a nadie solas. Si la ausencia se
              alargó, no hay que hacer nada (llegará el desactivar con la fecha nueva). Si ya volvió, desactívala aquí.
            </p>
            <ul className="mt-2 space-y-1">
              {sinDesactivar.map((a) => (
                <li key={a.slack_id + a.desde} className="flex flex-wrap items-center gap-3 text-xs">
                  <span>{nombrePorSlack.get(a.slack_id) || <span className="font-mono">{a.slack_id}</span>}</span>
                  <span>Fecha fin el {ddmm(a.fin)} (desde el {ddmm(a.desde)})</span>
                  {esAdmin && <DesactivarAusenciaBoton slackId={a.slack_id} desde={a.desde} fin={a.fin} />}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sinUsuario.length > 0 && (
          <details className="rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Ausentes hoy sin usuario en la plataforma ({sinUsuario.length})
            </summary>
            <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
              Llegan del flujo de ausencias con un ID de Slack que no es de ningún usuario. Si alguno es de un usuario de
              la plataforma, cárgale ese ID de Slack en su ficha: hasta entonces su ausencia no cuenta.
            </p>
            <ul className="mt-2 space-y-1">
              {sinUsuario.map((a) => (
                <li key={a.slack_id} className="flex gap-3 text-xs">
                  <span className="font-mono">{a.slack_id}</span>
                  <span className="text-muted-foreground">{etiquetaAusencia(a, hoy)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-xl">Alta de usuario</h2>
        <UsuarioForm areas={areas} posiciones={posiciones} equipos={equipos} allowAdminRole={esAdmin} />
      </section>
    </div>
  )
}

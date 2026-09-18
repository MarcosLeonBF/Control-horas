import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatFechaISO, formatHoras } from '@/lib/horas/format'
import { Badge } from '@/components/ui/badge'

// Un registro diario (time_log) por su id: la página a la que apunta `enlace_registro`
// en los avisos que llegan por Slack. Solo lectura.
//
// Quién lo ve NO se decide aquí: se consulta con la sesión de quien abre el enlace y
// deciden las RLS de time_logs / time_log_lines —el dueño, el admin, y un manager si la
// persona es de su equipo (manager_sees_user)—. Nunca con la clave de servicio: eso
// enseñaría cualquier registro a cualquiera que tuviera el enlace.

interface RawLinea {
  project: string
  hours: number
  description: string | null
  department: string | null
  areas: { name: string } | null
  etapas: { name: string } | null
}
interface RawRegistro {
  id: string
  entry_date: string
  total_hours: number
  status: string
  profiles: { full_name: string | null } | null
  time_log_lines: RawLinea[] | null
}

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  guardado: 'secondary', editado: 'outline', anulado: 'destructive',
}

// Un id que no es un uuid haría fallar la consulta con un error de tipo (22P02), que no
// es un fallo de la base sino un enlace roto: se trata igual que uno que no existe.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function RegistroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return <SinAcceso />

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('time_logs')
    .select('id, entry_date, total_hours, status, profiles!time_logs_user_id_fkey(full_name), time_log_lines(project, hours, description, department, areas(name), etapas(name))')
    .eq('id', id)
    .maybeSingle()
  // Un error de verdad se lanza, no se disfraza de "no tienes acceso": una consulta rota y
  // un registro ajeno tienen que poder distinguirse.
  if (error) throw new Error(`No se pudo leer el registro: ${error.message}`)
  // Sin fila hay dos casos que aquí son indistinguibles a propósito: no existe, o las RLS
  // lo ocultan. Decir cuál sería revelar qué ids existen a quien no debe verlos.
  if (!data) return <SinAcceso />

  const r = data as unknown as RawRegistro
  const lineas = r.time_log_lines ?? []
  const anulado = r.status === 'anulado'

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-(--brand)">Registro</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{r.profiles?.full_name ?? '—'}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="tabular-money">{formatFechaISO(r.entry_date)}</span>
          <span className="tabular-money font-medium text-foreground">{formatHoras(Number(r.total_hours))}</span>
          <Badge variant={STATUS_VARIANT[r.status] ?? 'outline'} className="capitalize">{r.status}</Badge>
        </div>
      </header>

      {/* El enlace puede ser de un aviso de hace días: si el registro se anuló después,
          tiene que quedar claro que esas horas ya no cuentan. */}
      {anulado && (
        <p className="rounded-xl border border-border bg-secondary px-4 py-3 text-sm text-(--brand-strong)">
          Este registro está anulado: sus horas ya no cuentan en ningún banco ni reporte.
        </p>
      )}

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        {lineas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este registro no tiene líneas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl text-sm">
              <thead>
                <tr className="text-left text-[0.7rem] uppercase tracking-wide text-muted-foreground/80">
                  <th className="py-2 pr-4 font-medium">Proyecto</th>
                  <th className="py-2 pr-4 font-medium">Área / Depto</th>
                  <th className="py-2 pr-4 font-medium">Etapa</th>
                  <th className="py-2 pr-4 font-medium text-right">Horas</th>
                  <th className="py-2 font-medium">Descripción</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((ln, i) => (
                  <tr key={i} className="border-t border-border/50 align-top">
                    <td className="py-2 pr-4 font-medium whitespace-nowrap">{ln.project}</td>
                    <td className="py-2 pr-4 text-foreground/70 whitespace-nowrap">
                      {ln.project === 'Departamento' ? (ln.department || '—') : (ln.areas?.name || '—')}
                    </td>
                    <td className="py-2 pr-4 text-foreground/70 whitespace-nowrap">{ln.etapas?.name || '—'}</td>
                    <td className="py-2 pr-4 text-right tabular-money whitespace-nowrap">{formatHoras(Number(ln.hours))}</td>
                    <td className="py-2 text-foreground/80">{ln.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// El mismo mensaje para "no existe" y "no es tuyo": ver el comentario de la consulta.
function SinAcceso() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
      <h1 className="font-display text-xl font-semibold">Registro no disponible</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Este registro no existe o no tienes acceso a él. Solo lo ven la persona que lo hizo, su manager y
        Administración.
      </p>
      <Link href="/registrar" className="mt-5 inline-block text-sm font-medium text-(--brand) hover:underline">
        Ir a mis horas
      </Link>
    </div>
  )
}

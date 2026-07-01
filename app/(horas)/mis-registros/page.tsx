import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'
import MisRegistros, { type RegistroRow } from '@/components/horas/MisRegistros'

// Formateador determinista (locale + UTC fijos) → se calcula en el servidor.
const MO = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' })

export default async function MisRegistrosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: logs } = await supabase
    .from('time_logs')
    .select('id, entry_date, total_hours, status, time_log_lines(project, hours, description)')
    .eq('user_id', user!.id)
    .order('entry_date', { ascending: false })

  type RawLog = {
    id: string; entry_date: string; total_hours: number; status: string
    time_log_lines: { project: string; hours: number; description: string }[]
  }

  // Una fila por línea de proyecto (los logs ya vienen ordenados por fecha desc).
  const rows: RegistroRow[] = []
  for (const l of (logs ?? []) as RawLog[]) {
    const d = new Date(l.entry_date + 'T00:00:00Z')
    const dateLabel = `${String(d.getUTCDate()).padStart(2, '0')} ${MO.format(d).replace('.', '')} ${String(d.getUTCFullYear()).slice(2)}`
    const status = ((l.status as RegistroRow['status']) ?? 'guardado')
    ;(l.time_log_lines ?? []).forEach((ln, i) => {
      rows.push({
        key: `${l.id}:${i}`,
        registroId: l.id,
        status,
        dateLabel,
        project: ln.project,
        hoursLabel: formatHoras(Number(ln.hours)),
        description: ln.description,
      })
    })
  }

  return (
    <div className="space-y-7">
      <header>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-(--brand)">Control de Horas</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Mis registros</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tu historial de horas registradas por proyecto, de la más reciente a la más antigua.</p>
      </header>
      <MisRegistros rows={rows} />
    </div>
  )
}

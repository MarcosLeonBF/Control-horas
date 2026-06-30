import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'
import MisRegistros, { type DiaView } from '@/components/horas/MisRegistros'

// Formateadores deterministas (locale + UTC fijos) → se calculan en el servidor.
const WD = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' })
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

  // Agrupar por fecha (ya vienen ordenados desc) y formatear en el servidor.
  const dias: DiaView[] = []
  for (const l of (logs ?? []) as RawLog[]) {
    const d = new Date(l.entry_date + 'T00:00:00Z')
    let dia = dias.find((x) => x.date === l.entry_date)
    if (!dia) {
      dia = {
        date: l.entry_date,
        day: String(d.getUTCDate()),
        weekday: WD.format(d).replace('.', ''),
        month: MO.format(d).replace('.', ''),
        registros: [],
      }
      dias.push(dia)
    }
    dia.registros.push({
      id: l.id,
      status: (l.status as DiaView['registros'][number]['status']) ?? 'guardado',
      totalLabel: formatHoras(Number(l.total_hours)),
      lines: (l.time_log_lines ?? []).map((ln) => ({
        project: ln.project,
        hoursLabel: formatHoras(Number(ln.hours)),
        description: ln.description,
      })),
    })
  }

  return (
    <div className="space-y-7">
      <header>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-(--brand)">Control de Horas</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Mis registros</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tu historial de jornadas registradas, día a día.</p>
      </header>
      <MisRegistros dias={dias} />
    </div>
  )
}

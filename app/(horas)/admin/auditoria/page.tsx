import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

interface AuditRow {
  id: string; action: 'crear' | 'editar' | 'anular'
  actor_name: string | null; subject_name: string | null
  entry_date: string | null; total_hours: number | null; at: string
}

const ACTION_STYLE: Record<AuditRow['action'], string> = {
  crear: 'bg-emerald-50 text-emerald-700',
  editar: 'bg-amber-50 text-amber-700',
  anular: 'bg-rose-50 text-rose-700',
}

export default async function AuditoriaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const { data } = await supabase
    .from('time_log_audit')
    .select('id, action, actor_name, subject_name, entry_date, total_hours, at')
    .order('at', { ascending: false })
    .limit(200)
  const rows = (data ?? []) as AuditRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl">Auditoría</h1>
        <p className="text-sm text-muted-foreground">Toda creación, edición o anulación de registros queda trazada.</p>
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
              <TableHead>Cuándo</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Registro (fecha)</TableHead>
              <TableHead>De</TableHead>
              <TableHead>Por</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Aún no hay movimientos registrados.</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="py-3 text-foreground/70">
                  {new Date(r.at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                </TableCell>
                <TableCell className="py-3">
                  <Badge className={`capitalize ${ACTION_STYLE[r.action]}`}>{r.action}</Badge>
                </TableCell>
                <TableCell className="py-3 text-foreground/70">{r.entry_date ?? '—'}</TableCell>
                <TableCell className="py-3 text-foreground/70">{r.subject_name ?? '—'}</TableCell>
                <TableCell className="py-3 text-foreground/70">{r.actor_name ?? '—'}</TableCell>
                <TableCell className="py-3 text-right tabular-money">{r.total_hours != null ? formatHoras(Number(r.total_hours)) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

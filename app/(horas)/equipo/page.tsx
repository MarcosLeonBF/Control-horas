import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  guardado: 'secondary', editado: 'outline', anulado: 'destructive',
}

export default async function EquipoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  if (me?.role !== 'manager' && me?.role !== 'admin') redirect('/registrar')

  const { data: logs } = await supabase
    .from('time_logs')
    .select('id, entry_date, total_hours, status, profiles!time_logs_user_id_fkey(full_name)')
    .order('entry_date', { ascending: false })
    .limit(200)

  type Log = { id: string; entry_date: string; total_hours: number; status: string; profiles: { full_name: string } | null }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl">Registros del equipo</h1>

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
              <TableHead>Fecha</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(logs ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">Aún no hay registros.</TableCell>
              </TableRow>
            )}
            {((logs ?? []) as unknown as Log[]).map((l) => (
              <TableRow key={l.id}>
                <TableCell className="py-3">{l.entry_date}</TableCell>
                <TableCell className="py-3 text-foreground/70">{l.profiles?.full_name ?? '—'}</TableCell>
                <TableCell className="py-3 text-right tabular-money">{formatHoras(Number(l.total_hours))}</TableCell>
                <TableCell className="py-3 text-right">
                  <Badge variant={STATUS_VARIANT[l.status] ?? 'outline'} className="capitalize">{l.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

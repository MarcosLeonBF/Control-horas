import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatHoras } from '@/lib/horas/format'
import { getAuditEntries, AUDIT_MAX_ROWS } from '@/lib/horas/auditoria'
import type { AuditDateBase } from '@/lib/horas/auditoria-types'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import NativeSelect from '@/components/ui/native-select'

const pad = (n: number) => String(n).padStart(2, '0')
const localISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const ACTION_STYLE = {
  crear: 'bg-emerald-50 text-emerald-700',
  editar: 'bg-amber-50 text-amber-700',
  anular: 'bg-rose-50 text-rose-700',
} as const

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; base?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const hoy = new Date()
  const to = sp.to || localISO(hoy)
  // Por defecto, los últimos 30 días: la ventana que se mira de verdad.
  const from = sp.from || localISO(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 30))
  const base: AuditDateBase = sp.base === 'entry_date' ? 'entry_date' : 'at'

  const { entries, truncado } = await getAuditEntries(from, to, base)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Auditoría</h1>
          <p className="text-sm text-muted-foreground">Toda creación, edición o anulación de registros queda trazada.</p>
        </div>
        <form className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Fechas por</span>
            <NativeSelect name="base" defaultValue={base} aria-label="Base de fecha" className="bg-card">
              <option value="at">Cuándo se hizo</option>
              <option value="entry_date">Fecha del registro</option>
            </NativeSelect>
          </label>
          <label className="flex flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-muted-foreground">Desde</span>
            <input type="date" name="from" defaultValue={from} max={to} className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm sm:w-auto" />
          </label>
          <label className="flex flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-muted-foreground">Hasta</span>
            <input type="date" name="to" defaultValue={to} className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm sm:w-auto" />
          </label>
          <button type="submit" className="h-9 shrink-0 rounded-lg bg-(--wine) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Aplicar
          </button>
        </form>
      </header>

      {truncado && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Mostrando los {AUDIT_MAX_ROWS.toLocaleString('es-ES')} movimientos más recientes del rango. Acota las fechas para verlo entero.
        </p>
      )}

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
            {entries.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No hay movimientos en este rango.</TableCell></TableRow>
            )}
            {entries.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="py-3 text-foreground/70">
                  {new Date(r.at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                </TableCell>
                <TableCell className="py-3">
                  <Badge className={`capitalize ${ACTION_STYLE[r.action]}`}>{r.action}</Badge>
                </TableCell>
                <TableCell className="py-3 text-foreground/70">{r.entryDate ?? '—'}</TableCell>
                <TableCell className="py-3 text-foreground/70">{r.subjectName}</TableCell>
                <TableCell className="py-3 text-foreground/70">{r.actorName}</TableCell>
                <TableCell className="py-3 text-right tabular-money">{r.totalHours != null ? formatHoras(r.totalHours) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuditEntries, AUDIT_MAX_ROWS } from '@/lib/horas/auditoria'
import type { AuditDateBase } from '@/lib/horas/auditoria-types'
import { addDiasISO, diaMadrid } from '@/lib/horas/auditoria-types'
import NativeSelect from '@/components/ui/native-select'
import AuditoriaView from '@/components/horas/AuditoriaView'

// El <input type="date"> ya fuerza este formato, pero esta es una pantalla interna
// donde el admin puede tocar la query string a mano: una fecha mal formada llegando a
// inicioDiaMadridUTC revienta con un RangeError sin capturar (500). Si no cuadra con
// YYYY-MM-DD, se descarta y cae al valor por defecto, igual que ya hacíamos con `base`.
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/
const fechaValida = (s: string | undefined): s is string => !!s && FECHA_ISO.test(s)

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

  // "Hoy" es el de Madrid, no el del reloj del servidor (UTC en producción): entre las
  // 00:00 y las 02:00 de Madrid en verano, el día del servidor va uno por detrás y el
  // rango por defecto se comería los movimientos de las últimas horas sin avisar.
  const hoyMadrid = diaMadrid(new Date().toISOString())
  const to = fechaValida(sp.to) ? sp.to : hoyMadrid
  // Por defecto, los últimos 30 días: la ventana que se mira de verdad.
  const from = fechaValida(sp.from) ? sp.from : addDiasISO(hoyMadrid, -30)
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
            <input type="date" name="to" defaultValue={to} max={hoyMadrid} className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm sm:w-auto" />
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

      <AuditoriaView entries={entries} base={base} from={from} to={to} />
    </div>
  )
}

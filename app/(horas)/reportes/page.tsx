import { redirect } from 'next/navigation'
import { getReporteLines, getReporteOptions } from '@/lib/horas/reportes'
import { getViewerScope } from '@/lib/horas/scope'
import ReportesView from '@/components/horas/ReportesView'
import { buttonVariants } from '@/components/ui/button'
import RangoDelMes from '@/components/horas/RangoDelMes'
import { hoyUTC } from '@/lib/horas/format'

export default async function ReportesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams
  const viewer = await getViewerScope()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'manager' && viewer.role !== 'admin') redirect('/registrar')

  // Del día 1 a hoy, con el día UTC (el de la base); RangoDelMes lo corrige si el de quien mira es otro mes.
  const hoy = hoyUTC()
  const from = sp.from || `${hoy.slice(0, 8)}01`
  const to = sp.to || hoy

  const [lines, options] = await Promise.all([getReporteLines(from, to), getReporteOptions(viewer)])

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Reportes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Horas registradas por el equipo.
          </p>
        </div>
        <form className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <label className="flex flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-muted-foreground">Desde</span>
            <input type="date" name="from" defaultValue={from} max={to} className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm sm:w-auto" />
          </label>
          <label className="flex flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-muted-foreground">Hasta</span>
            <input type="date" name="to" defaultValue={to} max={hoy} className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm sm:w-auto" />
          </label>
          <button type="submit" className={buttonVariants({ size: 'lg', className: 'shrink-0 px-4' })}>
            Aplicar
          </button>
        </form>
      </header>

      <ReportesView lines={lines} options={options} from={from} to={to} />
      {!sp.from && !sp.to && <RangoDelMes hasta={to} />}
    </div>
  )
}

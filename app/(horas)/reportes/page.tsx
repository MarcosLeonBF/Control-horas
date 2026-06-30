import { redirect } from 'next/navigation'
import { getReporteLines, getReporteOptions } from '@/lib/horas/reportes'
import { getViewerScope } from '@/lib/horas/scope'
import ReportesView from '@/components/horas/ReportesView'

const pad = (n: number) => String(n).padStart(2, '0')
const localISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export default async function ReportesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams
  const viewer = await getViewerScope()
  if (!viewer) redirect('/login')
  if (viewer.role !== 'manager' && viewer.role !== 'admin') redirect('/registrar')

  const now = new Date()
  const from = sp.from || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
  const to = sp.to || localISO(now)

  const [lines, options] = await Promise.all([getReporteLines(from, to), getReporteOptions(viewer)])

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Reportes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Horas registradas por el equipo. Ajusta el rango y agrupa como necesites.
          </p>
        </div>
        <form className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Desde</span>
            <input type="date" name="from" defaultValue={from} max={to} className="h-9 rounded-lg border border-border bg-card px-3 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Hasta</span>
            <input type="date" name="to" defaultValue={to} max={localISO(now)} className="h-9 rounded-lg border border-border bg-card px-3 text-sm" />
          </label>
          <button type="submit" className="h-9 rounded-lg bg-(--wine) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Aplicar
          </button>
        </form>
      </header>

      <ReportesView lines={lines} options={options} from={from} to={to} />
    </div>
  )
}

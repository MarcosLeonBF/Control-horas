'use client'

import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import type { BancoHorasRow } from '@/lib/horas/bancos-status'
import { currentMonth, mesCorto } from '@/lib/horas/format'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'

// Series del cierre de mes, con los tokens de la app (estética existente).
const config = {
  consumido: { label: 'Consumido', color: 'var(--brand)' },
  inutilizables: { label: 'Inutilizables', color: 'var(--status-excedido)' },
  libres: { label: 'Libres (carry)', color: 'var(--status-disponible)' },
  restante: { label: 'Restante (mes en curso)', color: 'var(--muted-foreground)' },
} satisfies ChartConfig

// "Cierre de mes por posición": un stacked bar por posición. La barra de cada mes
// cerrado queda llena (consumido + inutilizables + libres = asignado del mes); el mes
// en curso muestra su restante sin corte. Los meses provisionales van marcados.
export default function CarryForwardCharts({ posiciones }: { posiciones: BancoHorasRow[] }) {
  const cm = currentMonth()
  const charts = useMemo(
    () =>
      posiciones
        .filter((p) => p.monthly.length > 0)
        .map((p) => ({
          position: p.position,
          data: p.monthly.map((m) => ({
            mes: mesCorto(m.month) + (m.provisional ? ' ·prov' : ''),
            consumido: Math.min(m.consumed, m.assigned),
            inutilizables: m.inutilizables ?? 0,
            libres: m.libres ?? 0,
            restante: m.month >= cm ? Math.max(m.assigned - m.consumed, 0) : 0,
          })),
        })),
    [posiciones, cm],
  )

  if (charts.length === 0) return null

  return (
    <section className="mb-10">
      <h2 className="font-display mb-1 text-xl font-semibold">Cierre de mes por posición</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Cada mes cerrado queda contabilizado por completo: consumido, inutilizables (75% del sobrante) y libres (25%, arrastran como carry forward). El mes en curso aún no sufre el corte.
      </p>
      <div className={charts.length > 1 ? 'grid gap-4 md:grid-cols-2' : ''}>
        {charts.map((c) => (
          <div key={c.position} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="mb-3 text-sm font-medium">{c.position}</p>
            <ChartContainer config={config} className="h-48 w-full">
              <BarChart data={c.data} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="consumido" stackId="a" fill="var(--color-consumido)" />
                <Bar dataKey="inutilizables" stackId="a" fill="var(--color-inutilizables)" />
                <Bar dataKey="libres" stackId="a" fill="var(--color-libres)" />
                <Bar dataKey="restante" stackId="a" fill="var(--color-restante)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </div>
        ))}
      </div>
    </section>
  )
}

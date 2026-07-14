'use client'

import { useState, type CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import type { BancoHorasRow, BancoMensual } from '@/lib/horas/bancos-status'
import { currentMonth, formatHoras, mesCorto } from '@/lib/horas/format'
import { cn } from '@/lib/utils'

// Rayado diagonal para "inutilizables": horas muertas, deliberadamente acromáticas.
// La textura (no solo el color) las distingue del resto — legible también en
// impresión y para daltonismo. Consumido (carmín) y libres (verde) validan CVD.
// Exportado: las cards KPI del detalle usan el mismo swatch que esta leyenda.
export const HATCH: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, color-mix(in srgb, var(--foreground) 32%, transparent) 0 2px, transparent 2px 5px)',
}

function Swatch({ className, style, label }: { className?: string; style?: CSSProperties; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px]', className)} style={style} />
      {label}
    </span>
  )
}

// La barra segmentada de un mes: composición sobre el asignado del mes (orden fijo:
// consumido → inutilizables → libres; el tramo vacío del track es el restante del
// mes en curso). El detalle completo va en el title. La reusan las filas mensuales
// del despliegue y la fila colapsada de cada posición (con su mes en curso).
function BarraMes({ m, enCurso, className }: { m: BancoMensual; enCurso: boolean; className?: string }) {
  const partes: { pct: number; className?: string; style?: CSSProperties }[] = []
  if (m.assigned > 0) {
    const pct = (h: number) => (h / m.assigned) * 100
    partes.push({ pct: pct(Math.min(m.consumed, m.assigned)), className: 'bg-(--brand)' })
    if ((m.inutilizables ?? 0) > 0) partes.push({ pct: pct(m.inutilizables!), className: 'bg-foreground/10', style: HATCH })
    if ((m.libres ?? 0) > 0) partes.push({ pct: pct(m.libres!), className: 'bg-(--status-disponible)' })
  }
  const detalle = [
    `Consumido ${formatHoras(m.consumed)}`,
    (m.inutilizables ?? 0) > 0 && `Inutilizables ${formatHoras(m.inutilizables!)}`,
    (m.libres ?? 0) > 0 && `Libres ${formatHoras(m.libres!)}`,
    enCurso && m.assigned > m.consumed && `Restante ${formatHoras(m.assigned - m.consumed)} (en curso)`,
    m.provisional && 'asignado estimado (provisional)',
  ].filter(Boolean).join(' · ')

  return (
    <span title={`${mesCorto(m.month)} — ${detalle}`} className={cn('flex h-3 gap-0.5 overflow-hidden rounded-full bg-(--muted-surface)', className)}>
      {partes.filter((p) => p.pct > 0).map((p, i) => (
        <span key={i} className={p.className} style={{ width: `${p.pct}%`, ...p.style }} />
      ))}
    </span>
  )
}

// Fila de un mes en el despliegue: etiqueta + barra + cifras.
function MesBar({ m, enCurso }: { m: BancoMensual; enCurso: boolean }) {
  const excedido = m.consumed > m.assigned
  return (
    <li className="flex items-center gap-3">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-foreground/60">
        {mesCorto(m.month)}
        {m.provisional && <span className="rounded-full bg-(--brand)/10 px-1 py-px text-[0.55rem] font-medium text-(--brand)">prov</span>}
      </span>
      <BarraMes m={m} enCurso={enCurso} className="flex-1" />
      {/* Mes cerrado sano: todo quedó contabilizado → 8h/8h (la barra muestra cómo se
          repartió). Excedido o mes en curso: consumido/asignado (el número a vigilar). */}
      <span className="w-24 shrink-0 text-right text-xs tabular-money whitespace-nowrap">
        <span className={cn('font-medium', excedido && 'text-(--status-excedido)')}>
          {formatHoras(!enCurso && !excedido ? m.assigned : m.consumed)}
        </span>
        <span className="text-muted-foreground"> / {formatHoras(m.assigned)}</span>
      </span>
    </li>
  )
}

// "Cierre de mes por posición": panel colapsable por posición (patrón desplegable de
// la app, como la lista de bancos). La fila cerrada muestra la composición del MES EN
// CURSO (lo accionable) y las cifras de carry acumulado; al desplegar, una barrita por
// mes. Escala a 12 meses × muchas posiciones sin volverse una pared.
export default function CarryForwardCharts({ posiciones }: { posiciones: BancoHorasRow[] }) {
  const cm = currentMonth()
  const grupos = posiciones
    .map((p) => ({
      position: p.position,
      inutilizables: p.inutilizables,
      carryNeto: p.carryNeto,
      meses: p.monthly.filter((m) => m.assigned > 0 || m.consumed > 0),
    }))
    .filter((g) => g.meses.length > 0)

  // Con una sola posición el detalle se abre directo; con varias, panorama colapsado.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(grupos.length === 1 ? [grupos[0].position] : []))
  const toggle = (pos: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(pos)) next.delete(pos)
      else next.add(pos)
      return next
    })

  if (grupos.length === 0) return null

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="font-display mb-1 text-xl font-semibold">Cierre de mes por posición</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Cada mes cerrado queda contabilizado por completo: consumido, inutilizables (75% del sobrante) y libres (25%, arrastran como carry forward). El mes en curso aún no sufre el corte. La barra de cada posición muestra su mes en curso; desplegala para ver el cierre mes a mes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-foreground/60">
          <Swatch className="bg-(--brand)" label="Consumido" />
          <Swatch className="bg-foreground/10" style={HATCH} label="Inutilizables" />
          <Swatch className="bg-(--status-disponible)" label="Libres (carry)" />
          <Swatch className="bg-(--muted-surface) ring-1 ring-inset ring-border" label="Restante (mes en curso)" />
        </div>
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {grupos.map((g) => {
          const open = expanded.has(g.position)
          return (
            <div key={g.position}>
              <button
                type="button"
                onClick={() => toggle(g.position)}
                aria-expanded={open}
                className="group flex w-full items-center gap-3 px-5 py-3 text-left outline-none transition-colors hover:bg-(--muted-surface)/50 focus-visible:bg-(--muted-surface)/50"
              >
                <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground/60 transition-transform duration-300 group-hover:text-(--brand)', open && 'rotate-90')} />
                <span className="w-44 shrink-0 truncate text-sm font-medium">{g.position}</span>
                {(() => {
                  const mesActual = g.meses.find((m) => m.month === cm)
                  return mesActual
                    ? <BarraMes m={mesActual} enCurso className="hidden flex-1 md:flex" />
                    : <span aria-hidden title="Sin datos del mes en curso" className="hidden h-3 flex-1 rounded-full bg-(--muted-surface) md:block" />
                })()}
                <span className="min-w-0 shrink-0 text-right text-xs tabular-money whitespace-nowrap text-foreground/50">
                  {g.carryNeto > 0 && <span className="font-medium text-(--status-disponible)">+{formatHoras(g.carryNeto)} libres</span>}
                  {g.carryNeto > 0 && g.inutilizables > 0 && ' · '}
                  {g.inutilizables > 0 && <>{formatHoras(g.inutilizables)} inutilizables</>}
                  {g.carryNeto <= 0 && g.inutilizables <= 0 && <span className="text-muted-foreground/60">sin cierre aún</span>}
                </span>
              </button>

              {/* Detalle mes a mes (desplegable animado, mismo patrón que /equipo) */}
              <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                <div className="overflow-hidden">
                  <ul className="space-y-2 border-t border-border/60 bg-(--muted-surface)/40 px-5 pb-4 pt-3 md:pl-12">
                    {g.meses.map((m) => (
                      <MesBar key={m.month} m={m} enCurso={m.month >= cm} />
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

import type { CSSProperties } from 'react'
import type { BancoHorasRow, BancoMensual } from '@/lib/horas/bancos-status'
import { currentMonth, formatHoras, mesCorto } from '@/lib/horas/format'
import { cn } from '@/lib/utils'

// Piezas del "cierre de mes" del banco (spec carry forward 2026-07-14). Ya no hay una
// sección propia: la tabla "Por posición" del detalle despliega cada fila y muestra el
// cierre mes a mes ahí mismo (LeyendaCierre junto al título, CierrePosicionPanel en la
// fila expandida).

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

// Leyenda del cierre: se muestra junto al título "Por posición" (vista Total).
export function LeyendaCierre() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-foreground/60">
      <Swatch className="bg-(--brand)" label="Consumido" />
      <Swatch className="bg-foreground/10" style={HATCH} label="Inutilizables" />
      <Swatch className="bg-(--status-disponible)" label="Libres (carry)" />
      <Swatch className="bg-(--muted-surface) ring-1 ring-inset ring-border" label="Restante (mes en curso)" />
    </div>
  )
}

// La barra segmentada de un mes: composición sobre el asignado del mes (orden fijo:
// consumido → inutilizables → libres; el tramo vacío del track es el restante del
// mes en curso). El detalle completo va en el title.
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

// Fila de un mes en el despliegue: etiqueta + barra + cifras. Mes cerrado sano: todo
// quedó contabilizado → 8h/8h (la barra muestra cómo se repartió). Excedido o mes en
// curso: consumido/asignado (el número a vigilar).
function MesBar({ m, enCurso }: { m: BancoMensual; enCurso: boolean }) {
  const excedido = m.consumed > m.assigned
  return (
    <li className="flex items-center gap-3">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-foreground/60">
        {mesCorto(m.month)}
        {m.provisional && <span className="rounded-full bg-(--brand)/10 px-1 py-px text-[0.55rem] font-medium text-(--brand)">prov</span>}
      </span>
      <BarraMes m={m} enCurso={enCurso} className="flex-1" />
      <span className="w-24 shrink-0 text-right text-xs tabular-money whitespace-nowrap">
        <span className={cn('font-medium', excedido && 'text-(--status-excedido)')}>
          {formatHoras(!enCurso && !excedido ? m.assigned : m.consumed)}
        </span>
        <span className="text-muted-foreground"> / {formatHoras(m.assigned)}</span>
      </span>
    </li>
  )
}

// ¿La posición tiene meses con datos? (gate para hacer su fila desplegable)
export function tieneCierre(p: BancoHorasRow): boolean {
  return p.monthly.some((m) => m.assigned > 0 || m.consumed > 0)
}

// Composición total de una posición (mini barra bajo el nombre en la tabla): en qué
// terminó cada hora asignada. Mapea 1:1 con las columnas: carmín = Consumido,
// rayado = Inutilizables, verde + tramo vacío = Disponible real.
export function BarraComposicion({ posicion, className }: { posicion: BancoHorasRow; className?: string }) {
  let consumido = 0
  let inutil = 0
  let libres = 0
  for (const m of posicion.monthly) {
    consumido += Math.min(m.consumed, m.assigned)
    inutil += m.inutilizables ?? 0
    libres += m.libres ?? 0
  }
  const asignado = posicion.assigned
  if (asignado <= 0) return null
  const pct = (h: number) => (h / asignado) * 100
  const partes: { pct: number; className: string; style?: CSSProperties }[] = [
    { pct: pct(consumido), className: 'bg-(--brand)' },
    { pct: pct(inutil), className: 'bg-foreground/10', style: HATCH },
    { pct: pct(libres), className: 'bg-(--status-disponible)' },
  ].filter((p) => p.pct > 0)
  const detalle = [
    `Consumido ${formatHoras(consumido)}`,
    inutil > 0 && `Inutilizables ${formatHoras(inutil)}`,
    libres > 0 && `Libres ${formatHoras(libres)}`,
  ].filter(Boolean).join(' · ')
  return (
    <span title={`${detalle} — de ${formatHoras(asignado)} asignadas`} className={cn('flex gap-0.5 overflow-hidden rounded-full bg-(--muted-surface)', className)}>
      {partes.map((p, i) => (
        <span key={i} className={p.className} style={{ width: `${p.pct}%`, ...p.style }} />
      ))}
    </span>
  )
}

// Panel desplegado de una posición dentro de la tabla "Por posición": resumen del
// carry acumulado + una barrita por mes (el 16/16 de la spec).
export function CierrePosicionPanel({ posicion }: { posicion: BancoHorasRow }) {
  const cm = currentMonth()
  const meses = posicion.monthly.filter((m) => m.assigned > 0 || m.consumed > 0)
  if (meses.length === 0) return null
  return (
    <div>
      <p className="mb-2.5 text-xs tabular-money text-foreground/50">
        {posicion.carryNeto > 0 && <span className="font-medium text-(--status-disponible)">+{formatHoras(posicion.carryNeto)} libres</span>}
        {posicion.carryNeto > 0 && posicion.inutilizables > 0 && ' · '}
        {posicion.inutilizables > 0 && <>{formatHoras(posicion.inutilizables)} inutilizables</>}
        {posicion.carryNeto <= 0 && posicion.inutilizables <= 0 && <span className="text-muted-foreground/60">Sin cierre aún: no hay meses cerrados con sobrante.</span>}
      </p>
      <ul className="space-y-2">
        {meses.map((m) => (
          <MesBar key={m.month} m={m} enCurso={m.month >= cm} />
        ))}
      </ul>
    </div>
  )
}

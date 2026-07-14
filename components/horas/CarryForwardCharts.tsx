import type { CSSProperties, ReactNode } from 'react'
import type { BancoHorasRow, BancoMensual } from '@/lib/horas/bancos-status'
import { currentMonth, formatHoras, mesCorto } from '@/lib/horas/format'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

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

// ── Tooltip de desglose (burbuja oscura de shadcn: los swatches van en versión clara) ──

const HATCH_OSCURO: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, color-mix(in srgb, var(--background) 55%, transparent) 0 2px, transparent 2px 5px)',
}

function FilaDesglose({ swatch, label, value }: { swatch: ReactNode; label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-6">
      <span className="flex items-center gap-1.5 text-background/70">{swatch}{label}</span>
      <span className="tabular-money font-medium">{value}</span>
    </li>
  )
}

const sw = (className: string, style?: CSSProperties) => (
  <span aria-hidden className={cn('size-2 shrink-0 rounded-xs', className)} style={style} />
)

// Panel del tooltip: la distribución de una barra, fila por fila, con total asignado.
function Desglose({ titulo, provisional, consumido, inutilizables, libres, restante, exceso, asignado }: {
  titulo: string; provisional?: boolean
  consumido: number; inutilizables: number; libres: number; restante: number; exceso: number; asignado: number
}) {
  return (
    <div className="min-w-44">
      <p className="mb-2 flex items-center justify-between gap-3 font-medium">
        {titulo}
        {provisional && <span className="rounded-full bg-background/15 px-1.5 py-px text-[0.6rem] font-medium text-background/80">estimado</span>}
      </p>
      <ul className="space-y-1.5">
        <FilaDesglose swatch={sw('bg-(--brand)')} label="Consumido" value={formatHoras(consumido)} />
        {inutilizables > 0 && <FilaDesglose swatch={sw('bg-background/15', HATCH_OSCURO)} label="Inutilizables" value={`−${formatHoras(inutilizables)}`} />}
        {libres > 0 && <FilaDesglose swatch={sw('bg-(--status-disponible)')} label="Libres (carry)" value={`+${formatHoras(libres)}`} />}
        {restante > 0 && <FilaDesglose swatch={sw('bg-background/20 ring-1 ring-inset ring-background/30')} label="Restante" value={formatHoras(restante)} />}
        {exceso > 0 && <FilaDesglose swatch={sw('bg-(--brand)')} label="Exceso" value={`+${formatHoras(exceso)}`} />}
      </ul>
      <p className="mt-2 flex items-center justify-between gap-6 border-t border-background/20 pt-1.5">
        <span className="text-background/70">Asignado</span>
        <span className="tabular-money font-medium">{formatHoras(asignado)}</span>
      </p>
    </div>
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
// mes en curso). El detalle completo va en el title. Exportada: la matriz de la
// vista Mensual la usa como micro-barra por celda.
export function BarraMes({ m, enCurso, className }: { m: BancoMensual; enCurso: boolean; className?: string }) {
  const partes: { pct: number; className?: string; style?: CSSProperties }[] = []
  if (m.assigned > 0) {
    const pct = (h: number) => (h / m.assigned) * 100
    partes.push({ pct: pct(Math.min(m.consumed, m.assigned)), className: 'bg-(--brand)' })
    if ((m.inutilizables ?? 0) > 0) partes.push({ pct: pct(m.inutilizables!), className: 'bg-foreground/10', style: HATCH })
    if ((m.libres ?? 0) > 0) partes.push({ pct: pct(m.libres!), className: 'bg-(--status-disponible)' })
  }

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        {/* La barra misma es el trigger (ancla del tooltip). */}
        <TooltipTrigger render={<span className={cn('flex h-3 gap-0.5 overflow-hidden rounded-full bg-(--muted-surface)', className)} />}>
          {partes.filter((p) => p.pct > 0).map((p, i) => (
            <span key={i} className={p.className} style={{ width: `${p.pct}%`, ...p.style }} />
          ))}
        </TooltipTrigger>
        <TooltipContent className="block px-3 py-2.5">
          <Desglose
            titulo={mesCorto(m.month)}
            provisional={!!m.provisional}
            consumido={m.consumed}
            inutilizables={m.inutilizables ?? 0}
            libres={m.libres ?? 0}
            restante={enCurso ? Math.max(m.assigned - m.consumed, 0) : 0}
            exceso={Math.max(m.consumed - m.assigned, 0)}
            asignado={m.assigned}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger render={<span className={cn('flex gap-0.5 overflow-hidden rounded-full bg-(--muted-surface)', className)} />}>
          {partes.map((p, i) => (
            <span key={i} className={p.className} style={{ width: `${p.pct}%`, ...p.style }} />
          ))}
        </TooltipTrigger>
        <TooltipContent className="block px-3 py-2.5">
          <Desglose
            titulo="Todos los meses"
            consumido={posicion.consumed}
            inutilizables={inutil}
            libres={libres}
            restante={Math.max(asignado - consumido - inutil - libres, 0)}
            exceso={posicion.consumed - consumido}
            asignado={asignado}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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

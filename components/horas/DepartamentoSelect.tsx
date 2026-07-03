'use client'
import { Select } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { departamentoIcon } from '@/lib/horas/departamento-icon'
import type { DepartamentoRow } from '@/lib/horas/types'

interface DepartamentoSelectProps {
  value: string
  onValueChange: (value: string) => void
  departamentos: DepartamentoRow[]
  ariaLabel?: string
  className?: string
}

// Selector de departamento (Base UI Select) que muestra un icono lucide por
// departamento para diferenciarlos —el <select> nativo no puede renderizar SVG en
// sus opciones—. Renderiza en portal, así no lo recorta el overflow de la tabla
// del formulario. El icono es solo visual: el valor elegido sigue siendo d.name.
export default function DepartamentoSelect({
  value, onValueChange, departamentos, ariaLabel, className,
}: DepartamentoSelectProps) {
  return (
    <Select.Root value={value || null} onValueChange={(v) => onValueChange((v as string | null) ?? '')}>
      <Select.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 text-left text-sm text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring data-popup-open:ring-2 data-popup-open:ring-ring',
          className,
        )}
      >
        <Select.Value placeholder={<span className="text-muted-foreground">— Departamento —</span>}>
          {(val: string | null) => {
            if (!val) return <span className="text-muted-foreground">— Departamento —</span>
            const Icon = departamentoIcon(val)
            return (
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon className="size-4 shrink-0 text-(--brand)" />
                <span className="truncate">{val}</span>
              </span>
            )
          }}
        </Select.Value>
        <Select.Icon className="shrink-0 text-muted-foreground">
          <ChevronsUpDown className="size-4" />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner sideOffset={4} className="z-50">
          <Select.Popup className="max-h-72 w-56 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/5">
            {departamentos.map((d) => {
              const Icon = departamentoIcon(d.name)
              return (
                <Select.Item
                  key={d.id}
                  value={d.name}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 leading-tight data-highlighted:bg-(--brand)/10 data-selected:font-medium"
                >
                  <Icon className="size-4 shrink-0 text-(--brand)" />
                  <Select.ItemText className="min-w-0 flex-1 truncate">{d.name}</Select.ItemText>
                  <span className="flex size-4 shrink-0 items-center justify-center text-(--brand)">
                    <Select.ItemIndicator>
                      <Check className="size-4" />
                    </Select.ItemIndicator>
                  </span>
                </Select.Item>
              )
            })}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

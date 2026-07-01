'use client'
import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProjectComboboxProps {
  value: string
  onValueChange: (value: string) => void
  projects: string[]
  finishedProjects?: Set<string>
  placeholder?: string
  className?: string
  ariaLabel?: string
}

// Selector de proyecto con buscador (Base UI Combobox). Renderiza en portal, así
// que no lo recorta el overflow de la tabla del formulario. Marca los proyectos
// finalizados con una insignia.
export default function ProjectCombobox({
  value, onValueChange, projects, finishedProjects, placeholder = '— Proyecto —', className, ariaLabel,
}: ProjectComboboxProps) {
  return (
    <Combobox.Root items={projects} value={value || null} onValueChange={(v) => onValueChange(v ?? '')}>
      <Combobox.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 text-left text-sm text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring data-popup-open:ring-2 data-popup-open:ring-ring',
          className,
        )}
      >
        <Combobox.Value placeholder={<span className="text-muted-foreground">{placeholder}</span>}>
          {(val: string | null) => (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{val}</span>
              {val && finishedProjects?.has(val) && (
                <span className="shrink-0 rounded-full bg-foreground/[0.07] px-1.5 py-px text-[0.62rem] font-medium text-muted-foreground">Finalizado</span>
              )}
            </span>
          )}
        </Combobox.Value>
        <Combobox.Icon className="shrink-0 text-muted-foreground">
          <ChevronsUpDown className="size-4" />
        </Combobox.Icon>
      </Combobox.Trigger>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50">
          <Combobox.Popup className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/5">
            <div className="flex items-center gap-2 border-b border-border px-2.5">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <Combobox.Input
                placeholder="Buscar proyecto…"
                className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Combobox.Empty className="px-3 text-center text-sm text-muted-foreground not-empty:py-8">
              Sin proyectos que coincidan.
            </Combobox.Empty>
            <Combobox.List className="max-h-72 overflow-y-auto p-1">
              {(item: string) => (
                <Combobox.Item
                  key={item}
                  value={item}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 leading-tight data-highlighted:bg-(--brand)/10 data-selected:font-medium"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-(--brand)">
                    <Combobox.ItemIndicator>
                      <Check className="size-4" />
                    </Combobox.ItemIndicator>
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item}</span>
                  {finishedProjects?.has(item) && (
                    <span className="shrink-0 rounded-full bg-foreground/[0.07] px-1.5 py-px text-[0.62rem] font-medium text-muted-foreground">Finalizado</span>
                  )}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

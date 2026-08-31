'use client'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

// Acción de fila de las pantallas de administración: icono + tooltip. Con tres o cuatro
// acciones por fila, el texto suelto las convertía en una lista de enlaces donde
// "Editar" y "Eliminar" competían en rojo, y se comía el ancho de los nombres.
//
// Quien la use tiene que envolver su tabla o lista en un <TooltipProvider>.
export default function AccionIcono({ label, tooltip, onClick, disabled, destructivo, activo, children }: {
  label: string // nombre accesible: se queda fijo, es por el que preguntan los E2E
  tooltip?: string // lo que se lee al pasar por encima, si dice más que el nombre
  onClick: () => void
  disabled?: boolean
  destructivo?: boolean
  activo?: boolean // el permiso que abre esta acción está puesto: se enciende con el color de marca
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}
            className={cn(
              'text-foreground/55 hover:text-foreground',
              destructivo && 'hover:bg-destructive/10 hover:text-destructive',
              activo && 'bg-(--brand)/10 text-(--brand-strong) hover:bg-(--brand)/15 hover:text-(--brand-strong)',
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  )
}

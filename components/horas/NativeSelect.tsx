'use client'
import type { ReactNode, SelectHTMLAttributes } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// <select> nativo con flecha propia y padding consistente. Los <select> nativos no
// permiten controlar el espaciado de la flecha del navegador; aquí se oculta
// (appearance-none) y se dibuja una ChevronsUpDown a la derecha con el MISMO icono y
// separación (right-2.5) que los selectores Base UI (proyecto / departamento), para que
// todos los selectores se vean igual.
export default function NativeSelect({
  className, children, ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <div className="relative w-full">
      <select
        {...props}
        className={cn(
          'h-9 w-full appearance-none rounded-lg border border-border bg-background pl-2.5 pr-9 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        {children}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

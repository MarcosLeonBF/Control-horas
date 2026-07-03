'use client'
import type { ReactNode, SelectHTMLAttributes } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// <select> nativo con flecha propia (ChevronsUpDown) y separación consistente del borde.
// Los <select> nativos no dejan controlar el padding de la flecha del navegador; aquí se
// oculta (appearance-none) y se superpone una flecha con la misma separación (right-2.5)
// que los selectores Base UI. Ancho automático por defecto (para filtros en fila); pásale
// `fullWidth` para que ocupe todo el ancho (formularios). El padding derecho (pr-9) se
// aplica al final para que gane a cualquier px-* del className recibido.
export default function NativeSelect({
  className, fullWidth, children, ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { fullWidth?: boolean; children: ReactNode }) {
  return (
    <span className={cn('relative inline-block align-middle', fullWidth && 'block w-full')}>
      <select
        {...props}
        className={cn(
          'h-9 appearance-none rounded-lg border border-border bg-background pl-2.5 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          fullWidth && 'w-full',
          className,
          'pr-9',
        )}
      >
        {children}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  )
}

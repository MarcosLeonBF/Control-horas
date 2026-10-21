'use client'

import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'

// Se pinta dentro del menú de la app (el layout queda fuera del límite de error), así que
// siempre hay por dónde seguir. El código es el digest del log del servidor: con él un
// administrador encuentra el fallo sin que aquí se enseñe nada técnico.
export default function ErrorPagina({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
      <TriangleAlert aria-hidden className="mx-auto mb-3 size-8 text-(--status-excedido)" />
      <h1 className="font-display text-xl font-semibold">No se pudo cargar esta página</h1>
      <p className="mt-2 text-sm text-pretty text-muted-foreground">
        Suele ser un corte momentáneo con la base de datos o con el Excel. Vuelve a intentarlo y, si se repite, avisa a un administrador.
      </p>
      <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Button size="lg" className="w-full px-4 sm:w-auto" onClick={() => unstable_retry()}>Volver a intentarlo</Button>
        <Link href="/registrar" className={buttonVariants({ variant: 'outline', size: 'lg', className: 'w-full px-4 sm:w-auto' })}>Ir a Registrar</Link>
      </div>
      {error.digest && <p className="mt-4 text-xs text-muted-foreground">Código: <span className="tabular-money">{error.digest}</span></p>}
    </div>
  )
}

import Image from 'next/image'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

export default function NoEncontrada() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Image src="/logo-negro.png" alt="Bastida & Farina" width={400} height={140} priority className="h-8 w-auto" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="font-display text-xl font-semibold">Esta página no existe</h1>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">
            El enlace puede estar mal copiado, o lo que buscas se anuló o ya no está a tu alcance.
          </p>
          <Link href="/" className={buttonVariants({ size: 'lg', className: 'mt-6 px-4' })}>Ir al inicio</Link>
        </div>
      </div>
    </div>
  )
}

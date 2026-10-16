import Image from 'next/image'
import { ShieldAlert } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { urlAcceso } from '@/lib/hub/config'
import { motivoError, rutaEntrarHub, type MotivoError } from '@/lib/hub/rutas'
import { cn } from '@/lib/utils'

// Por qué no se pudo entrar por Acceso, dicho para la persona (los detalles técnicos quedan
// en el log del servidor). El motivo llega en la URL y se valida: lo que no se conoce es un
// fallo genérico, nunca texto que se pinte tal cual.
const MENSAJES: Record<MotivoError, { titulo: string; texto: string }> = {
  'sin-ficha': {
    titulo: 'Aún no tienes acceso',
    texto: 'Tu cuenta aún no tiene ficha en Control de Rentabilidad. Pide a un administrador que te dé acceso desde Acceso.',
  },
  inactivo: {
    titulo: 'Acceso desactivado',
    texto: 'Tu acceso a Control de Rentabilidad está desactivado. Si crees que es un error, habla con un administrador.',
  },
  'sin-acceso': {
    titulo: 'Sin acceso',
    texto: 'No tienes acceso a Control de Rentabilidad. Pide a un administrador que te lo dé desde Acceso.',
  },
  caducada: {
    titulo: 'La entrada caducó',
    texto: 'Pasó demasiado tiempo o la entrada se abrió en otra pestaña. Vuelve a intentarlo.',
  },
  'sin-conexion': {
    titulo: 'No pudimos conectar con Acceso',
    texto: 'Acceso no responde en este momento. Vuelve a intentarlo en unos minutos.',
  },
  fallo: {
    titulo: 'No pudimos completar la entrada',
    texto: 'Algo falló al iniciar tu sesión. Vuelve a intentarlo y, si se repite, avisa a un administrador.',
  },
}

export default async function ErrorEntradaPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string | string[]; next?: string | string[] }>
}) {
  const { motivo, next } = await searchParams
  const { titulo, texto } = MENSAJES[motivoError(motivo)]
  const acceso = urlAcceso()

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      {/* Fondo decorativo: el mismo sistema que el resto de la app */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(189,8,66,0.07),transparent_50%)]" />
        <div className="absolute -right-44 -top-52 size-168 rounded-full border border-(--brand)/7" />
        <div className="absolute -bottom-56 -left-48 size-176 rounded-full border border-(--brand)/5" />
        <svg className="absolute inset-0 size-full opacity-[0.025] mix-blend-multiply">
          <filter id="hub-error-grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" /></filter>
          <rect width="100%" height="100%" filter="url(#hub-error-grain)" />
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Image src="/logo-negro.png" alt="Bastida & Farina" width={400} height={140} priority className="h-8 w-auto" />
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto mb-3 size-8 text-(--brand)" aria-hidden />
          <h1 className="font-display text-xl font-semibold text-foreground">{titulo}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{texto}</p>

          {/* Enlaces normales y no <Link>: /auth/hub/entrar es una ruta del servidor que sale
              hacia Acceso, y Acceso es otra web. Ninguna de las dos se puede precargar. */}
          <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <a href={rutaEntrarHub(next)} className={cn(buttonVariants({ size: 'lg' }), 'w-full px-4 sm:w-auto')}>
              Volver a intentarlo
            </a>
            {acceso && (
              <a href={acceso} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full px-4 sm:w-auto')}>
                Ir a Acceso
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

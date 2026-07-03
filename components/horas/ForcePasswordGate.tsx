'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { LogOut, ShieldAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import CambiarContrasenaForm from '@/components/horas/CambiarContrasenaForm'

export default function ForcePasswordGate({ displayName }: { displayName: string }) {
  const router = useRouter()

  async function logout() {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      {/* Fondo decorativo (mismo sistema que el resto de la app) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(189,8,66,0.07),transparent_50%)]" />
        <div className="absolute -right-44 -top-52 size-168 rounded-full border border-(--brand)/7" />
        <div className="absolute -bottom-56 -left-48 size-176 rounded-full border border-(--brand)/5" />
        <svg className="absolute inset-0 size-full opacity-[0.025] mix-blend-multiply">
          <filter id="gate-grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" /></filter>
          <rect width="100%" height="100%" filter="url(#gate-grain)" />
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="flex justify-center">
          <Image src="/logo-negro.png" alt="Bastida & Farina" width={400} height={140} priority className="h-8 w-auto" />
        </div>

        {/* Alerta */}
        <div className="rounded-2xl border border-(--status-bajo)/30 bg-(--status-bajo)/5 p-4 text-center">
          <ShieldAlert className="mx-auto mb-2 size-8 text-(--status-bajo)" />
          <h1 className="font-display text-xl font-semibold text-foreground">Cambiá tu contraseña</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hola <strong className="font-medium text-foreground">{displayName}</strong>, por seguridad necesitás establecer una contraseña personal antes de continuar.
          </p>
        </div>

        {/* Formulario */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <CambiarContrasenaForm forced />
        </div>

        {/* Cerrar sesión */}
        <div className="text-center">
          <button onClick={logout} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <LogOut className="size-3.5" />
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}

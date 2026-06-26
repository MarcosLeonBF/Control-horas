'use client'

import Image from 'next/image'
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const underline = cn(
  'h-11 rounded-none border-0 border-b border-border bg-transparent px-0 text-sm',
  'shadow-none transition-colors placeholder:text-muted-foreground',
  'focus-visible:border-(--brand) focus-visible:ring-0',
)

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Email o contraseña incorrectos.')
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="grid min-h-screen md:grid-cols-[1.05fr_1fr]">
      {/* ── Panel de marca ───────────────────────────────────────────── */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#BD0842] via-[#A0073A] to-[#54123D] p-14 text-white md:flex">
        {/* atmósfera: glow radial + anillos finos + grano */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_15%,rgba(255,255,255,0.16),transparent_55%)]" />
        <div className="pointer-events-none absolute -bottom-48 -left-40 size-[34rem] rounded-full border border-white/12" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 size-[34rem] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-44 top-24 size-[30rem] rounded-full border border-white/10" />
        <svg className="pointer-events-none absolute inset-0 size-full opacity-[0.12] mix-blend-overlay" aria-hidden="true">
          <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" /></filter>
          <rect width="100%" height="100%" filter="url(#grain)" />
        </svg>

        <p className="animate-fade-up relative text-xs font-medium uppercase tracking-[0.3em] text-white/70">
          Bienvenido a
        </p>

        <div className="animate-fade-up relative flex flex-col items-center text-center [animation-delay:120ms]">
          <Image src="/logo-blanco.png" alt="Bastida &amp; Fariña" width={400} height={140} priority className="h-20 w-auto" />
          <p className="font-display mt-7 text-2xl">Control de Horas</p>
          <div className="mt-5 h-px w-12 bg-white/40" />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/75">
            Registro de horas, bancos y presupuestos del equipo de Bastida &amp; Fariña.
          </p>
        </div>

        <p className="animate-fade-up relative text-xs text-white/60 [animation-delay:200ms]">
          Bastida &amp; Fariña · Sistema interno
        </p>
      </aside>

      {/* ── Panel del formulario ─────────────────────────────────────── */}
      <main className="flex flex-col justify-center px-6 py-12 sm:px-10 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <Image src="/logo-negro.png" alt="Bastida &amp; Fariña" width={400} height={140} className="mb-10 h-9 w-auto md:hidden" />

          <p className="animate-fade-up text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Acceso
          </p>
          <h1 className="animate-fade-up font-display mt-2 text-4xl font-semibold tracking-tight text-(--brand) [animation-delay:60ms]">
            Iniciar sesión
          </h1>
          <p className="animate-fade-up mt-2 text-sm text-muted-foreground [animation-delay:100ms]">
            Ingresá tus credenciales para continuar.
          </p>

          <form onSubmit={handleLogin} className="mt-9 space-y-6">
            <div className="animate-fade-up space-y-1.5 [animation-delay:140ms]">
              <Label htmlFor="email" className="text-xs uppercase tracking-wide text-muted-foreground">Email</Label>
              <Input id="email" aria-label="Email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com"
                className={underline} />
            </div>

            <div className="animate-fade-up space-y-1.5 [animation-delay:180ms]">
              <Label htmlFor="password" className="text-xs uppercase tracking-wide text-muted-foreground">Contraseña</Label>
              <div className="relative">
                <Input id="password" aria-label="Contraseña" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                  className={cn(underline, 'pr-8')} />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar clave' : 'Mostrar clave'}
                  className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground">
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <label className="animate-fade-up flex items-center gap-2 text-sm text-muted-foreground [animation-delay:210ms]">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                className="size-4 accent-(--brand)" />
              Recordarme
            </label>

            {error && (
              <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-(--brand-strong)">{error}</p>
            )}

            <Button type="submit" disabled={loading} className="animate-fade-up h-11 w-full [animation-delay:240ms]">
              {loading ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>

          <p className="animate-fade-up mt-8 text-xs italic text-muted-foreground [animation-delay:280ms]">
            *No compartas tus credenciales con nadie.
          </p>
        </div>
      </main>
    </div>
  )
}

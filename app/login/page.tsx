'use client'

import Image from 'next/image'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  )
}

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

  const fieldClass =
    'w-full border-0 border-b border-border bg-transparent px-1 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-(--brand) focus:outline-none focus:ring-0'

  return (
    <div className="flex min-h-screen items-center justify-center bg-foreground p-3 sm:p-6">
      <div className="grid min-h-[34rem] w-full max-w-5xl overflow-hidden rounded-3xl bg-card shadow-2xl md:grid-cols-2">
        {/* Panel de marca */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#BD0842] via-[#A0073A] to-[#54123D] p-10 text-white md:flex">
          {/* formas decorativas */}
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-8 left-16 h-52 w-52 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -right-28 top-1/4 h-80 w-80 rounded-full bg-white/5" />

          <p className="relative font-display text-2xl font-semibold">Bienvenido a</p>

          <div className="relative flex flex-col items-center text-center">
            <Image src="/logo-blanco.png" alt="Bastida &amp; Fariña" width={400} height={140} priority className="h-16 w-auto" />
            <p className="mt-6 font-display text-xl">Control de Horas</p>
            <p className="mt-3 max-w-xs text-sm text-white/80">
              Registro de horas, bancos y presupuestos del equipo de Bastida &amp; Fariña.
            </p>
          </div>

          <p className="relative text-xs text-white/70">Bastida &amp; Fariña · Sistema interno</p>
        </div>

        {/* Panel del formulario */}
        <div className="flex flex-col justify-center px-8 py-12 sm:px-12">
          <Image src="/logo-negro.png" alt="Bastida &amp; Fariña" width={400} height={140} className="mb-8 h-9 w-auto md:hidden" />

          <h1 className="font-display text-3xl font-semibold text-(--brand)">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ingresá tus credenciales para continuar.</p>

          <form onSubmit={handleLogin} className="mt-8 space-y-6">
            <input
              id="email" aria-label="Email" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
              className={fieldClass}
            />

            <div className="relative">
              <input
                id="password" aria-label="Contraseña" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña"
                className={`${fieldClass} pr-8`}
              />
              <button
                type="button" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar clave' : 'Mostrar clave'}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-(--brand)" />
              Recordarme
            </label>

            {error && (
              <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-(--brand-strong)">{error}</p>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full rounded-lg bg-(--brand) px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-(--brand-strong) disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>

          <p className="mt-8 text-xs italic text-muted-foreground">*No compartas tus credenciales con nadie.</p>
        </div>
      </div>
    </div>
  )
}

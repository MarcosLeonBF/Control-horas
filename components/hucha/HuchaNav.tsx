'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function HuchaNav({ displayName, role }: { displayName: string; role?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const activePresupuestos = pathname === '/presupuestos' || (pathname.startsWith('/presupuestos') && !pathname.startsWith('/presupuestos/sincronizar'))
  const activeSincronizar = pathname.startsWith('/presupuestos/sincronizar')

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto max-w-5xl px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-display text-lg font-semibold tracking-tight">HUCHA</span>
          <nav className="flex items-center gap-6">
            <Link
              href="/presupuestos"
              className={`text-sm transition-colors ${activePresupuestos ? 'text-foreground font-medium' : 'text-foreground/60 hover:text-foreground'}`}
            >
              Presupuestos
            </Link>
            {role === 'admin' && (
              <Link
                href="/presupuestos/sincronizar"
                className={`text-sm transition-colors ${activeSincronizar ? 'text-foreground font-medium' : 'text-foreground/60 hover:text-foreground'}`}
              >
                Sincronizar
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-foreground/50 hidden sm:block">{displayName}</span>
          <button onClick={logout} className="text-xs text-foreground/60 hover:text-foreground transition-colors">
            Salir
          </button>
        </div>
      </div>
    </header>
  )
}

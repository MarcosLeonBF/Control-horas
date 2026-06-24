'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function HuchaNav({ displayName }: { displayName: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const active = pathname.startsWith('/presupuestos')

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto max-w-5xl px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-display text-lg font-semibold tracking-tight">HUCHA</span>
          <nav>
            <Link
              href="/presupuestos"
              className={`text-sm transition-colors ${active ? 'text-foreground font-medium' : 'text-foreground/60 hover:text-foreground'}`}
            >
              Presupuestos
            </Link>
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

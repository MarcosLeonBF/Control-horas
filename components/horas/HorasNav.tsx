'use client'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function HorasNav({ displayName, role }: { displayName: string; role: string }) {
  const path = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`text-sm transition-colors ${path === href ? 'font-medium text-foreground' : 'text-foreground/60 hover:text-foreground'}`}
    >
      {label}
    </Link>
  )

  const isManagerOrAdmin = role === 'manager' || role === 'admin'

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/registrar" className="flex items-center" aria-label="Bastida &amp; Farina">
            <Image src="/logo-negro.png" alt="Bastida &amp; Farina" width={400} height={140} priority className="h-7 w-auto" />
          </Link>
          <nav className="flex items-center gap-6">
            {link('/registrar', 'Registrar')}
            {link('/mis-registros', 'Mis registros')}
            {isManagerOrAdmin && link('/equipo', 'Equipo')}
            {isManagerOrAdmin && link('/bancos', 'Bancos de horas')}
            {isManagerOrAdmin && link('/reportes', 'Reportes')}
            {role === 'admin' && link('/admin/usuarios', 'Usuarios')}
            {isManagerOrAdmin && (
              <Link href="/presupuestos" className="text-sm text-(--brand) transition-colors hover:text-(--brand-strong)">
                Presupuestos
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-xs text-foreground/50 sm:block">{displayName}</span>
          <button onClick={logout} className="text-xs text-foreground/60 transition-colors hover:text-foreground">
            Salir
          </button>
        </div>
      </div>
    </header>
  )
}

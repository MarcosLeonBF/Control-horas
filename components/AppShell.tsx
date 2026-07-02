'use client'

import { useEffect, useState, type ComponentType } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Clock, FileText, Users, Wallet, BarChart3, PiggyBank, LayoutDashboard,
  RefreshCw, UserCog, History, Tags, LogOut, ChevronsLeft, ChevronsRight, Menu, X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

type Icon = ComponentType<{ className?: string }>
interface Item { href: string; label: string; icon: Icon; show: boolean }
interface Section { title: string; items: Item[] }

function buildSections(role: string): Section[] {
  const isMgr = role === 'manager' || role === 'admin'
  const isAdmin = role === 'admin'
  const raw: Section[] = [
    {
      title: 'Control de Horas',
      items: [
        { href: '/registrar', label: 'Registrar', icon: Clock, show: true },
        { href: '/mis-registros', label: 'Mis registros', icon: FileText, show: true },
        { href: '/equipo', label: 'Equipo', icon: Users, show: isMgr },
        { href: '/bancos', label: 'Bancos de horas', icon: Wallet, show: isMgr },
        { href: '/reportes', label: 'Reportes', icon: BarChart3, show: isMgr },
      ],
    },
    {
      title: 'HUCHA',
      items: [
        { href: '/presupuestos', label: 'HUCHA', icon: PiggyBank, show: isMgr },
        { href: '/presupuestos/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: isAdmin },
        { href: '/presupuestos/sincronizar', label: 'Sincronizar', icon: RefreshCw, show: isAdmin },
      ],
    },
    {
      title: 'Administración',
      items: [
        { href: '/admin/usuarios', label: 'Usuarios', icon: UserCog, show: isAdmin },
        { href: '/admin/catalogos', label: 'Catálogos', icon: Tags, show: isAdmin },
        { href: '/admin/auditoria', label: 'Auditoría', icon: History, show: isAdmin },
      ],
    },
  ]
  return raw
    .map((s) => ({ ...s, items: s.items.filter((i) => i.show) }))
    .filter((s) => s.items.length > 0)
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '·'
}

export default function AppShell({ displayName, role, children }: { displayName: string; role: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [pathname])

  const sections = buildSections(role)
  const hrefs = sections.flatMap((s) => s.items.map((i) => i.href))
  const activeHref = hrefs
    .filter((h) => pathname === h || pathname.startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0] ?? null

  async function logout() {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const NavLink = ({ item }: { item: Item }) => {
    const active = item.href === activeHref
    return (
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={cn(
          'group relative flex items-center gap-3 rounded-lg py-2 text-sm transition-colors',
          collapsed ? 'justify-center px-0' : 'px-3',
          active ? 'bg-white/[0.09] text-white' : 'text-white/55 hover:bg-white/[0.05] hover:text-white',
        )}
      >
        {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-(--brand)" />}
        <item.icon className={cn('size-[18px] shrink-0 transition-colors', active ? 'text-(--brand)' : 'text-white/45 group-hover:text-white/80')} />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Barra superior solo móvil */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setMobileOpen(true)} aria-label="Abrir menú" className="text-foreground/70 hover:text-foreground">
          <Menu className="size-5" />
        </button>
        <Image src="/logo-negro.png" alt="Bastida &amp; Farina" width={400} height={140} priority className="h-6 w-auto" />
      </div>

      {/* Backdrop móvil */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col bg-gradient-to-b from-[#2a0f22] via-[#1b0a16] to-[#130710] text-white transition-all duration-300 ease-out',
          collapsed ? 'w-[76px]' : 'w-64',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* glow sutil */}
        <div className="pointer-events-none absolute -left-10 top-0 h-48 w-48 rounded-full bg-(--brand)/20 blur-3xl" />

        {/* Marca + colapsar */}
        <div className={cn('relative flex h-16 items-center', collapsed ? 'justify-center px-0' : 'justify-between px-5')}>
          <Link href="/registrar" aria-label="Bastida &amp; Farina" className="flex items-center">
            {collapsed ? (
              <span className="grid size-9 place-items-center rounded-lg bg-(--brand) font-display text-sm font-bold text-white">BF</span>
            ) : (
              <Image src="/logo-blanco.png" alt="Bastida &amp; Farina" width={400} height={140} priority className="h-7 w-auto" />
            )}
          </Link>
          <button onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" className="text-white/60 hover:text-white lg:hidden">
            <X className="size-5" />
          </button>
        </div>

        {/* Navegación */}
        <nav className="relative flex-1 overflow-y-auto px-3 pb-4">
          {sections.map((section, si) => (
            <div key={section.title}>
              {collapsed
                ? si > 0 && <div className="mx-auto my-3 h-px w-8 bg-white/10" />
                : <p className="px-3 pt-5 pb-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/30">{section.title}</p>}
              <div className="space-y-0.5">
                {section.items.map((item) => <NavLink key={item.href} item={item} />)}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer usuario */}
        <div className="relative border-t border-white/10 p-3">
          <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--brand)/90 text-xs font-semibold text-white">{initials(displayName)}</span>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{displayName}</p>
                <p className="truncate text-xs capitalize text-white/45">{role}</p>
              </div>
            )}
            <button onClick={logout} title="Salir" aria-label="Salir" className={cn('text-white/50 transition-colors hover:text-white', collapsed && 'hidden')}>
              <LogOut className="size-4" />
            </button>
          </div>
          {collapsed && (
            <button onClick={logout} title="Salir" aria-label="Salir" className="mt-3 flex w-full justify-center text-white/50 transition-colors hover:text-white">
              <LogOut className="size-4" />
            </button>
          )}
        </div>

        {/* Colapsar (escritorio) */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          className="absolute -right-3 top-20 hidden size-6 place-items-center rounded-full border border-border bg-card text-foreground/60 shadow-sm transition-colors hover:text-foreground lg:grid"
        >
          {collapsed ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
        </button>
      </aside>

      {/* Contenido */}
      <div className={cn('relative min-h-screen transition-[padding] duration-300 ease-out', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        {/* Fondo decorativo: mismo sistema que el login (glow + anillos concéntricos + grano). */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          {/* Glow de marca */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_88%_-8%,rgba(189,8,66,0.06),transparent_44%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_-8%_108%,rgba(189,8,66,0.04),transparent_48%)]" />
          {/* Anillos concéntricos finos sangrando por las esquinas (motivo del login) */}
          <div className="absolute -right-44 -top-52 size-168 rounded-full border border-(--brand)/7" />
          <div className="absolute -right-28 -top-40 size-168 rounded-full border border-(--brand)/5" />
          <div className="absolute -bottom-56 -left-48 size-176 rounded-full border border-(--brand)/6" />
          <div className="absolute -bottom-40 -left-32 size-176 rounded-full border border-(--brand)/4" />
          {/* Grano sutil */}
          <svg className="absolute inset-0 size-full opacity-[0.025] mix-blend-multiply">
            <filter id="app-grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" /></filter>
            <rect width="100%" height="100%" filter="url(#app-grain)" />
          </svg>
        </div>
        <main className="relative z-10 mx-auto max-w-6xl px-5 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  )
}

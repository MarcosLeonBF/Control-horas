'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function HorasNav({ displayName, role }: { displayName: string; role: string }) {
  const path = usePathname()
  const link = (href: string, label: string) => (
    <Link href={href} className={`text-sm ${path === href ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{label}</Link>
  )
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="font-display text-base">Control de Horas</span>
          {link('/registrar', 'Registrar')}
          {link('/mis-registros', 'Mis registros')}
          {(role === 'manager' || role === 'admin') && link('/equipo', 'Equipo')}
          {role === 'admin' && link('/admin/usuarios', 'Usuarios')}
        </div>
        <span className="text-sm text-muted-foreground">{displayName}</span>
      </div>
    </header>
  )
}

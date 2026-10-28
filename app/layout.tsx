import type { Metadata } from 'next'
import './globals.css'
import { fraunces, geistSans, geistMono } from '@/lib/fonts'
import { Toaster } from '@/components/ui/sonner'
import { ConfirmarProvider } from '@/components/ui/confirmar'

export const metadata: Metadata = {
  title: 'Control de Rentabilidad',
  description: 'Registro de horas, bancos y HUCHA.',
  // Favicon: app/icon.svg, icon.png y apple-icon.png, la B de Bastida&Farina con sus barras en carmesí. Es el mismo en
  // todas las apps; se genera con scripts/generar-iconos.ts del repo de Acceso (acceso-bf) y se copia aquí.
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" suppressHydrationWarning className={`${fraunces.variable} ${geistSans.variable} ${geistMono.variable}`}>
      <body suppressHydrationWarning className="min-h-screen antialiased">
        <ConfirmarProvider>{children}</ConfirmarProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}

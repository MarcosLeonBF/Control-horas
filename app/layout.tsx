import type { Metadata } from 'next'
import './globals.css'
import { fraunces, geistSans, geistMono } from '@/lib/fonts'
import { Toaster } from '@/components/ui/sonner'

export const metadata: Metadata = {
  title: 'Control de Gestión — Bastida & Farina',
  description: 'Sistema interno de control y gestión del equipo de Bastida & Farina',
  // Favicon: ícono cuadrado generado en app/icon.tsx (el logo es un wordmark ancho que
  // se veía ilegible aplastado en la pestaña).
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" suppressHydrationWarning className={`${fraunces.variable} ${geistSans.variable} ${geistMono.variable}`}>
      <body suppressHydrationWarning className="min-h-screen antialiased">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}

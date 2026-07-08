import type { Metadata } from 'next'
import './globals.css'
import { fraunces, geistSans, geistMono } from '@/lib/fonts'
import { Toaster } from '@/components/ui/sonner'

export const metadata: Metadata = {
  title: 'Control de Gestión — Bastida & Farina',
  description: 'Sistema interno de control y gestión del equipo de Bastida & Farina',
  // Favicon = logo de la marca. Negro para pestañas claras, blanco para oscuras.
  icons: {
    icon: [
      { url: '/logo-negro.png', media: '(prefers-color-scheme: light)' },
      { url: '/logo-blanco.png', media: '(prefers-color-scheme: dark)' },
    ],
  },
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

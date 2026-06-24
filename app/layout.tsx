import type { Metadata } from 'next'
import './globals.css'
import { fraunces, geistSans, geistMono } from '@/lib/fonts'

export const metadata: Metadata = {
  title: 'Control de Horas — Bastida & Fariña',
  description: 'Sistema interno de registro y seguimiento de horas por proyecto',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={`${fraunces.variable} ${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  )
}

import { Fraunces } from 'next/font/google'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'

export const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
})

export const geistSans = GeistSans   // exposes .variable = '--font-geist-sans'
export const geistMono = GeistMono   // exposes .variable = '--font-geist-mono'

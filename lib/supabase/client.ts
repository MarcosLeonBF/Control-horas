import { createBrowserClient } from '@supabase/ssr'

// Cliente para usar en componentes del lado del cliente (navegador)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

import { createClient } from '@supabase/supabase-js'

// Cliente con service_role: bypasa RLS, solo usar en el servidor.
// Nunca importar en componentes del cliente ('use client').
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

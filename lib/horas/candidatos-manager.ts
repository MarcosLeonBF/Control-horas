import { createAdminClient } from '@/lib/supabase/admin'
import type { CandidatoManager } from '@/lib/horas/ampliar-permisos'

// Quién puede figurar como «Manager del proyecto» del Excel: managers y admins activos, no
// todos los perfiles, para que "Estefania" no choque con una operativa del mismo nombre.
// Lo comparten el filtro Manager de /bancos y el permiso de ampliar horas.
export async function candidatosManager(): Promise<CandidatoManager[]> {
  const { data, error } = await createAdminClient()
    .from('profiles').select('id, full_name').in('role', ['manager', 'admin']).eq('status', 'activo')
  if (error) throw new Error(`profiles: ${error.message}`)
  return (data ?? []) as CandidatoManager[]
}

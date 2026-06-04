import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCachedBancoHoras } from '@/lib/graph/client'
import RegistrarForm from '@/components/RegistrarForm'

export interface ProjectSummary {
  project: string
  totalHours: number
  consumed: number
}

export default async function RegistrarPage() {
  const supabase      = await createClient()
  const adminSupabase = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()

  // Proyectos del Excel
  let bancoHoras: { project: string; totalHours: number }[] = []
  try {
    bancoHoras = await getCachedBancoHoras()
  } catch {
    // Si falla Graph API, el formulario muestra solo "Departamento"
  }

  // Horas consumidas por proyecto (todos los usuarios, para mostrar el estado del banco)
  const { data: consumidos } = await adminSupabase
    .from('time_entries')
    .select('project, hours')

  const consumidoMap: Record<string, number> = {}
  for (const row of consumidos ?? []) {
    consumidoMap[row.project] = (consumidoMap[row.project] ?? 0) + Number(row.hours)
  }

  const projectSummaries: ProjectSummary[] = bancoHoras.map((item) => ({
    project:    item.project,
    totalHours: item.totalHours,
    consumed:   consumidoMap[item.project] ?? 0,
  }))

  const allProjects = [...bancoHoras.map((b) => b.project), 'Departamento']

  const userEmail = user?.email ?? ''
  const userName  = user?.user_metadata?.full_name ?? user?.email ?? ''

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Registrar horas</h1>
        <p className="mt-1 text-sm text-gray-500">
          {allProjects.length > 1
            ? `${allProjects.length - 1} proyectos disponibles`
            : 'No se pudieron cargar los proyectos del Excel'}
        </p>
      </div>

      <RegistrarForm
        projects={allProjects}
        projectSummaries={projectSummaries}
        userEmail={userEmail}
        userName={userName}
      />
    </div>
  )
}

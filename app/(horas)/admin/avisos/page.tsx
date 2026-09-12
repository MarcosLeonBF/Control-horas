import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/avisos/entorno'
import AvisosPanel, { type EnvioRow } from '@/components/horas/AvisosPanel'

export default async function AvisosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const admin = createAdminClient()
  const [cfg, envios] = await Promise.all([
    admin.from('avisos_config').select('url, tipos_activos').eq('id', true).single(),
    admin.from('avisos_salientes')
      .select('id, tipo, estado, motivo_descarte, intentos, ultimo_codigo, ultimo_error, prueba, created_at, enviado_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ])
  // Una consulta rota no puede pintarse como "sin envíos": mejor un error visible.
  if (cfg.error) throw new Error(`No se pudo leer la configuración de avisos: ${cfg.error.message}`)
  if (envios.error) throw new Error(`No se pudo leer el historial de avisos: ${envios.error.message}`)

  const base = appUrl()
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl">Avisos</h1>
        <p className="text-sm text-muted-foreground">
          Salen hacia el webhook de los flujos de Zapier o n8n, que deciden a qué canal va cada uno.
        </p>
      </header>
      <AvisosPanel
        url={(cfg.data.url as string | null) ?? ''}
        tiposActivos={(cfg.data.tipos_activos as string[] | null) ?? []}
        envios={(envios.data ?? []) as EnvioRow[]}
        consultas={[`${base}/api/avisos/v1/resumen-capacidad`, `${base}/api/avisos/v1/dias-sin-registrar`]}
        faltaSecreto={!process.env.AVISOS_FIRMA_SECRETO}
      />
    </div>
  )
}

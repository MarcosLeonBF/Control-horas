import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/avisos/entorno'
import AvisosPanel, { type EnvioRow } from '@/components/horas/AvisosPanel'
import AvisosRecibidos, { type RecibidoRow } from '@/components/horas/AvisosRecibidos'
import { recibidosParaVer } from '@/lib/avisos/entrantes'

export default async function AvisosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const admin = createAdminClient()
  const hace30Dias = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const COLUMNAS_RECIBIDO = 'id, created_at, tipo, status, error, resumen, cuerpo, cuerpo_texto'
  const [cfg, envios, recibidos, rechazos] = await Promise.all([
    admin.from('avisos_config').select('url, tipos_activos').eq('id', true).single(),
    admin.from('avisos_salientes')
      .select('id, tipo, estado, motivo_descarte, intentos, ultimo_codigo, ultimo_error, prueba, created_at, enviado_at')
      .order('created_at', { ascending: false })
      .limit(50),
    admin.from('avisos_entrantes').select(COLUMNAS_RECIBIDO).order('created_at', { ascending: false }).limit(30),
    // Aparte, los rechazos del último mes: una carga de muchas filas no debe taparlos.
    admin.from('avisos_entrantes').select(COLUMNAS_RECIBIDO).neq('status', 200).gte('created_at', hace30Dias)
      .order('created_at', { ascending: false }).limit(30),
  ])
  // Una consulta rota no puede pintarse como "sin envíos": mejor un error visible.
  if (cfg.error) throw new Error(`No se pudo leer la configuración de avisos: ${cfg.error.message}`)
  if (envios.error) throw new Error(`No se pudo leer el historial de avisos: ${envios.error.message}`)
  if (recibidos.error) throw new Error(`No se pudo leer lo recibido: ${recibidos.error.message}`)
  if (rechazos.error) throw new Error(`No se pudo leer lo recibido: ${rechazos.error.message}`)

  const base = appUrl()
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl">Avisos</h1>
        <p className="text-sm text-muted-foreground">
          Salen hacia el webhook de los flujos de Zapier o n8n, que deciden a qué canal va cada uno. Abajo, en
          Recibidos, lo que esos flujos le mandan a la plataforma.
        </p>
      </header>
      <AvisosPanel
        url={(cfg.data.url as string | null) ?? ''}
        tiposActivos={(cfg.data.tipos_activos as string[] | null) ?? []}
        envios={(envios.data ?? []) as EnvioRow[]}
        consultas={[`${base}/api/avisos/v1/resumen-capacidad`, `${base}/api/avisos/v1/dias-sin-registrar`]}
        faltaSecreto={!process.env.AVISOS_FIRMA_SECRETO}
      />
      <div className="pt-2">
        <AvisosRecibidos
          recibidos={recibidosParaVer((recibidos.data ?? []) as RecibidoRow[], (rechazos.data ?? []) as RecibidoRow[])}
          url={`${base}/api/avisos/v1/vacaciones`}
        />
      </div>
    </div>
  )
}

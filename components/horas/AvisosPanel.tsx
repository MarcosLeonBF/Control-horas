'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { guardarUrl, activarTipo, probarAviso } from '@/app/(horas)/admin/avisos/actions'
import { TIPOS_AVISO, DESCRIPCION_TIPO, type TipoAviso } from '@/lib/avisos/contrato'
import { cn } from '@/lib/utils'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

export interface EnvioRow {
  id: string
  tipo: string
  estado: 'pendiente' | 'enviando' | 'enviado' | 'fallido' | 'descartado'
  motivo_descarte: string | null
  intentos: number
  ultimo_codigo: number | null
  ultimo_error: string | null
  prueba: boolean
  created_at: string
  enviado_at: string | null
}

const ESTADO_CLASE: Record<EnvioRow['estado'], string> = {
  enviado: 'bg-(--status-disponible)/12 text-(--status-disponible)',
  pendiente: 'bg-(--status-bajo)/12 text-(--status-bajo)',
  enviando: 'bg-(--status-bajo)/12 text-(--status-bajo)',
  fallido: 'bg-(--status-excedido)/12 text-(--status-excedido)',
  descartado: 'bg-neutral-100 text-neutral-500',
}

// La hora que ve el admin es la de Madrid, no la del servidor (UTC).
const FECHA = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})

function respuesta(e: EnvioRow): string {
  if (e.estado === 'descartado') return e.motivo_descarte === 'sin_destino' ? 'Sin destino: tipo pausado o sin URL' : 'Descartado'
  const codigo = e.ultimo_codigo ? `HTTP ${e.ultimo_codigo}` : ''
  return [codigo, e.ultimo_error ?? ''].filter(Boolean).join(' · ') || '—'
}

export default function AvisosPanel({ url, tiposActivos, envios, consultas }: {
  url: string; tiposActivos: string[]; envios: EnvioRow[]; consultas: string[]
}) {
  const router = useRouter()
  const [valor, setValor] = useState(url)
  const [guardando, setGuardando] = useState(false)
  const [ocupado, setOcupado] = useState<TipoAviso | null>(null)
  const [resultados, setResultados] = useState<Partial<Record<TipoAviso, { ok: boolean; mensaje: string }>>>({})
  const activos = new Set(tiposActivos)

  async function guardar() {
    setGuardando(true)
    const res = await guardarUrl(valor)
    setGuardando(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(valor.trim() ? 'URL guardada' : 'URL quitada: ya no sale ningún aviso')
    router.refresh()
  }

  async function alternar(tipo: TipoAviso, activo: boolean) {
    setOcupado(tipo)
    const res = await activarTipo(tipo, activo)
    setOcupado(null)
    if (!res.ok) { toast.error(res.error); return }
    router.refresh()
  }

  async function probar(tipo: TipoAviso) {
    setOcupado(tipo)
    const res = await probarAviso(tipo)
    setOcupado(null)
    setResultados((r) => ({ ...r, [tipo]: res }))
    router.refresh()
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-display text-lg">Webhook</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Una sola URL para todos los avisos; cada uno trae su tipo en el campo <code>tipo</code>. Vacía, no sale ningún aviso.
        </p>
        <div className="flex max-w-2xl gap-2">
          <Input
            aria-label="URL del webhook" placeholder="https://hooks.zapier.com/…" value={valor}
            onChange={(e) => setValor(e.target.value)} className="h-9"
          />
          <Button onClick={guardar} disabled={guardando || valor.trim() === url}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg">Tipos de aviso</h2>
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
                  <TableHead>Aviso</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Prueba</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TIPOS_AVISO.map((tipo) => {
                  const r = resultados[tipo]
                  const activo = activos.has(tipo)
                  return (
                    <TableRow key={tipo}>
                      <TableCell className="py-3">
                        <div className="font-mono text-xs text-foreground">{tipo}</div>
                        <div className="text-sm text-muted-foreground">{DESCRIPCION_TIPO[tipo]}</div>
                      </TableCell>
                      <TableCell className="py-3">
                        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground/80">
                          <input
                            type="checkbox" className="size-4 accent-(--brand)" aria-label={`Activar ${tipo}`}
                            checked={activo} disabled={ocupado === tipo}
                            onChange={(e) => alternar(tipo, e.target.checked)}
                          />
                          {activo ? 'Activo' : 'Pausado'}
                        </label>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-col items-end gap-1">
                          <Button variant="outline" size="sm" disabled={!url || ocupado === tipo} onClick={() => probar(tipo)}>
                            <Send />
                            Enviar prueba
                          </Button>
                          {r && (
                            <span className={cn('text-xs', r.ok ? 'text-(--status-disponible)' : 'text-(--status-excedido)')}>
                              {r.mensaje}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg">Consultas</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Las pide el flujo cuando quiera, con la cabecera <code>Authorization: Bearer</code> y la clave <code>AVISOS_API_KEY</code> de Vercel.
        </p>
        <ul className="space-y-1">
          {consultas.map((c) => <li key={c} className="break-all font-mono text-xs text-foreground/80">GET {c}</li>)}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg">Últimos envíos</h2>
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Intentos</TableHead>
                  <TableHead>Respuesta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {envios.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      Todavía no ha salido ningún aviso.
                    </TableCell>
                  </TableRow>
                )}
                {envios.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="py-2.5 tabular-nums text-foreground/70">{FECHA.format(new Date(e.created_at))}</TableCell>
                    <TableCell className="py-2.5">
                      <span className="font-mono text-xs">{e.tipo}</span>
                      {e.prueba && <Badge className="ml-2 bg-sky-50 text-sky-700">Prueba</Badge>}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <Badge className={cn('capitalize', ESTADO_CLASE[e.estado])}>{e.estado}</Badge>
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums">{e.intentos}</TableCell>
                    <TableCell className="max-w-md truncate py-2.5 text-xs text-muted-foreground" title={respuesta(e)}>
                      {respuesta(e)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>
    </div>
  )
}

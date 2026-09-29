// Lo que los flujos le mandan a la plataforma (avisos_entrantes, 0053): cada envío con la
// clave correcta, aceptado o rechazado, con lo que llegó. Para seguir la integración sin
// tener que pedirle a quien manda que mire su n8n. Solo lectura, sin estado de cliente.
import { cn } from '@/lib/utils'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export interface RecibidoRow {
  id: number
  created_at: string
  tipo: string
  status: number
  error: string | null
  airtable_id: string | null
  persona_nombre: string | null
  cuerpo: unknown
  cuerpo_texto: string | null
}

// La hora que ve el admin es la de Madrid, no la del servidor (UTC).
const FECHA = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function resultado(status: number): { texto: string; clase: string } {
  if (status === 200) return { texto: 'Guardado', clase: 'bg-(--status-disponible)/12 text-(--status-disponible)' }
  if (status >= 500) return { texto: `Error ${status}`, clase: 'bg-(--status-bajo)/12 text-(--status-bajo)' }
  return { texto: `Rechazado ${status}`, clase: 'bg-(--status-excedido)/12 text-(--status-excedido)' }
}

function contenido(r: RecibidoRow): string | null {
  if (r.cuerpo !== null && r.cuerpo !== undefined) return JSON.stringify(r.cuerpo, null, 2)
  if (r.cuerpo_texto === '') return '(vacío)'
  return r.cuerpo_texto
}

export default function AvisosRecibidos({ recibidos, url }: { recibidos: RecibidoRow[]; url: string }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg">Recibidos</h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Lo que el flujo le manda a la plataforma, aceptado o no, con la misma clave que las consultas. Los envíos sin
        clave no se guardan.
      </p>
      <p className="break-all font-mono text-xs text-foreground/80">POST {url}</p>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
                <TableHead>Fecha</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Fila de Airtable</TableHead>
                <TableHead>Persona</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Lo que llegó</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recibidos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    Todavía no ha llegado nada.
                  </TableCell>
                </TableRow>
              )}
              {recibidos.map((r) => {
                const res = resultado(r.status)
                const llego = contenido(r)
                return (
                  <TableRow key={r.id} className="align-top">
                    <TableCell className="py-2.5 tabular-nums text-foreground/70">{FECHA.format(new Date(r.created_at))}</TableCell>
                    <TableCell className="py-2.5">
                      <Badge className={cn(res.clase)}>{res.texto}</Badge>
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs">{r.airtable_id ?? '—'}</TableCell>
                    <TableCell className="py-2.5 text-sm">
                      {r.status !== 200
                        ? <span className="text-muted-foreground">—</span>
                        : r.persona_nombre || <span className="text-muted-foreground">Sin usuario en la plataforma</span>}
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal py-2.5 text-xs text-muted-foreground">{r.error ?? '—'}</TableCell>
                    <TableCell className="py-2.5 text-xs">
                      {llego === null ? <span className="text-muted-foreground">—</span> : (
                        <details>
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Ver</summary>
                          <pre className="mt-2 max-h-64 max-w-md overflow-auto rounded-md bg-(--muted-surface) p-2 font-mono text-[11px] leading-snug">
                            {llego}
                          </pre>
                        </details>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  )
}

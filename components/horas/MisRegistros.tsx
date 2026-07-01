'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Ban } from 'lucide-react'
import { anularRegistro } from '@/app/(horas)/mis-registros/actions'
import { cn } from '@/lib/utils'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export interface RegistroRow {
  key: string
  registroId: string
  status: 'guardado' | 'editado' | 'anulado'
  dateLabel: string
  project: string
  hoursLabel: string
  description: string
}

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  guardado: 'secondary', editado: 'outline', anulado: 'destructive',
}

export default function MisRegistros({ rows }: { rows: RegistroRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function onAnular(id: string) {
    if (!confirm('¿Anular este registro? Devolverá las horas al banco correspondiente.')) return
    setBusy(id)
    const res = await anularRegistro(id)
    setBusy(null)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Registro anulado'); router.refresh()
  }

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">Todavía no registraste horas.</p>
        <Link href="/registrar" className="mt-3 inline-block text-sm font-medium text-(--brand) transition-colors hover:text-(--brand-strong)">
          Registrar mi primera jornada →
        </Link>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
            <TableHead className="w-30">Fecha</TableHead>
            <TableHead>Proyecto</TableHead>
            <TableHead className="hidden sm:table-cell">Descripción</TableHead>
            <TableHead className="text-right">Horas</TableHead>
            <TableHead className="text-right">Estado</TableHead>
            <TableHead className="w-[1%] text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const anulado = r.status === 'anulado'
            return (
              <TableRow key={r.key} className={cn(anulado && 'opacity-60')}>
                <TableCell className="py-3 tabular-nums text-foreground/65">{r.dateLabel}</TableCell>
                <TableCell className={cn('max-w-56 truncate py-3 font-medium text-foreground/90', anulado && 'line-through')} title={r.project}>
                  {r.project}
                </TableCell>
                <TableCell className="hidden max-w-[24rem] truncate py-3 text-muted-foreground sm:table-cell" title={r.description}>
                  {r.description || '—'}
                </TableCell>
                <TableCell className={cn('py-3 text-right tabular-money font-medium', anulado && 'line-through')}>
                  {r.hoursLabel}
                </TableCell>
                <TableCell className="py-3 text-right">
                  <Badge variant={STATUS_VARIANT[r.status] ?? 'outline'} className="capitalize">{r.status}</Badge>
                </TableCell>
                <TableCell className="py-2 text-right">
                  {anulado ? (
                    <span className="text-muted-foreground/40">—</span>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/registrar?edit=${r.registroId}`}
                        title="Editar registro"
                        aria-label="Editar registro"
                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-(--brand)/10 hover:text-(--brand)"
                      >
                        <Pencil className="size-4" />
                      </Link>
                      <button
                        onClick={() => onAnular(r.registroId)}
                        disabled={busy === r.registroId}
                        title="Anular registro"
                        aria-label="Anular registro"
                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        <Ban className="size-4" />
                      </button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { anularRegistro } from '@/app/(horas)/mis-registros/actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface Log {
  id: string; entry_date: string; totalLabel: string; status: string
  time_log_lines: { project: string; hours: number; description: string }[]
}

export default function MisRegistros({ logs }: { logs: Log[] }) {
  const router = useRouter()
  async function onAnular(id: string) {
    const res = await anularRegistro(id)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Registro anulado'); router.refresh()
  }
  if (!logs.length) return <p className="text-muted-foreground">Todavía no registraste horas.</p>
  return (
    <ul className="space-y-3">
      {logs.map((l) => (
        <li key={l.id} className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">{l.entry_date} · {l.totalLabel}</span>
            <Badge variant={l.status === 'anulado' ? 'destructive' : 'outline'} className="capitalize">{l.status}</Badge>
          </div>
          <ul className="mt-2 text-sm text-muted-foreground">
            {l.time_log_lines.map((line, i) => <li key={i}>{line.project} — {line.hours}h — {line.description}</li>)}
          </ul>
          {l.status !== 'anulado' && (
            <div className="mt-2 flex items-center gap-3">
              <Link href={`/registrar?edit=${l.id}`} className="text-sm font-medium text-(--brand) transition-colors hover:text-(--brand-strong)">Editar</Link>
              <Button onClick={() => onAnular(l.id)} variant="ghost" size="sm" className="text-(--status-excedido) hover:text-(--status-excedido)">Anular</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

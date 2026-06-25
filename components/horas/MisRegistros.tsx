'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { anularRegistro } from '@/app/(horas)/mis-registros/actions'

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
            <span className="text-xs text-muted-foreground">{l.status}</span>
          </div>
          <ul className="mt-2 text-sm text-muted-foreground">
            {l.time_log_lines.map((line, i) => <li key={i}>{line.project} — {line.hours}h — {line.description}</li>)}
          </ul>
          {l.status !== 'anulado' && (
            <div className="mt-2 flex gap-3">
              <Link href={`/registrar?edit=${l.id}`} className="text-xs text-brand">Editar</Link>
              <button onClick={() => onAnular(l.id)} className="text-xs text-(--excedido)">Anular</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

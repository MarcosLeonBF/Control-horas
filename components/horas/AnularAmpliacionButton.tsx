'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { anularAmpliacionHoras } from '@/app/(horas)/bancos/[project]/actions'

export default function AnularAmpliacionButton({ id, project }: { id: string; project: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onClick() {
    if (!confirm('¿Anular esta ampliación de horas? Dejará de sumar al asignado.')) return
    setBusy(true)
    const res = await anularAmpliacionHoras(id, project)
    setBusy(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Ampliación anulada')
    router.refresh()
  }

  return (
    <button onClick={onClick} disabled={busy}
      className="text-xs text-(--status-excedido) transition-colors hover:underline disabled:opacity-50">
      {busy ? 'Anulando…' : 'Anular'}
    </button>
  )
}

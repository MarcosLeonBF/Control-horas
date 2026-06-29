'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { anularAmpliacionHoras } from '@/app/(horas)/bancos/[project]/actions'
import { Button } from '@/components/ui/button'

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
    <Button onClick={onClick} disabled={busy} variant="ghost" size="sm" className="text-(--status-excedido) hover:text-(--status-excedido)">
      {busy ? 'Anulando…' : 'Anular'}
    </Button>
  )
}

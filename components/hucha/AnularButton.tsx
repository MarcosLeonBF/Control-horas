'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { anularMovimiento } from '@/app/(hucha)/presupuestos/[id]/actions'

export default function AnularButton({ projectId, movementId, disabled }: {
  projectId: string; movementId: string; disabled: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  if (disabled) return <span className="text-xs text-foreground/30">—</span>
  async function onClick() {
    if (!confirm('¿Anular este movimiento? Se registrará una reversión.')) return
    setLoading(true)
    const res = await anularMovimiento(projectId, movementId)
    setLoading(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Movimiento anulado')
    router.refresh()
  }
  return (
    <button onClick={onClick} disabled={loading} className="text-xs text-(--excedido) hover:underline">
      {loading ? 'Anulando…' : 'Anular'}
    </button>
  )
}

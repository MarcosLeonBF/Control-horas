'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { anularMovimiento } from '@/app/(hucha)/presupuestos/[id]/actions'
import { Button } from '@/components/ui/button'

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
    <Button onClick={onClick} disabled={loading} variant="ghost" size="sm" className="text-(--status-excedido) hover:text-(--status-excedido)">
      {loading ? 'Anulando…' : 'Anular'}
    </Button>
  )
}

'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ampliarPresupuesto } from './actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const today = () => new Date().toISOString().slice(0, 10)

export default function AmpliarForm({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [monto, setMonto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [fecha, setFecha] = useState(today())
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await ampliarPresupuesto(projectId, { monto: Number(monto), motivo, referencia, fecha })
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Presupuesto ampliado')
    setMonto(''); setMotivo(''); setReferencia(''); setFecha(today())
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3">
      <h3 className="font-display text-base font-semibold">Ampliar presupuesto</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input aria-label="Monto" type="number" step="0.01" min="0" placeholder="Monto (€)" value={monto}
          onChange={(e) => setMonto(e.target.value)} />
        <Input aria-label="Fecha" type="date" max={today()} value={fecha}
          onChange={(e) => setFecha(e.target.value)} />
        <Input aria-label="Motivo" placeholder="Motivo" value={motivo}
          onChange={(e) => setMotivo(e.target.value)} className="sm:col-span-2" />
        <Input aria-label="Referencia" placeholder="Referencia (opcional)" value={referencia}
          onChange={(e) => setReferencia(e.target.value)} className="sm:col-span-2" />
      </div>
      <Button type="submit" disabled={saving} size="lg">{saving ? 'Ampliando…' : 'Ampliar'}</Button>
    </form>
  )
}

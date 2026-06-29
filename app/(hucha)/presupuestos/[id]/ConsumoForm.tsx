'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { registrarConsumo } from './actions'
import { formatEUR } from '@/lib/hucha/format'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

function todayISO() { return new Date().toISOString().slice(0, 10) }

export default function ConsumoForm({ projectId, remaining }: { projectId: string; remaining: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [entryDate, setEntryDate] = useState(todayISO())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const numericAmount = Number(amount)
  const willExceed = Number.isFinite(numericAmount) && numericAmount > remaining

  function reset() {
    setAmount(''); setDescription(''); setEntryDate(todayISO()); setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('El importe debe ser mayor a 0.'); return
    }
    if (!description.trim()) { setError('La descripción es obligatoria.'); return }
    if (willExceed && !confirm('Este consumo excederá el presupuesto disponible. ¿Continuar?')) return

    const fd = new FormData()
    fd.set('project_id', projectId)
    fd.set('amount', amount)
    fd.set('description', description)
    fd.set('entry_date', entryDate)

    startTransition(async () => {
      const res = await registrarConsumo(fd)
      if (!res.ok) { setError(res.error); return }
      toast.success('Consumo registrado')
      reset(); setOpen(false); router.refresh()
    })
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)} size="lg">Registrar consumo</Button>
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-md">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Registrar consumo</h3>
        <span className="text-xs text-foreground/50">Disponible: <span className="tabular-money">{formatEUR(remaining)}</span></span>
      </div>
      <div className="space-y-3">
        <div>
          <label htmlFor="amount" className="mb-1 block text-sm font-medium">Importe (€)</label>
          <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </div>
        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium">Descripción</label>
          <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Motivo del consumo" />
        </div>
        <div>
          <label htmlFor="entry_date" className="mb-1 block text-sm font-medium">Fecha</label>
          <Input id="entry_date" type="date" max={todayISO()} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </div>
        {willExceed && <p className="text-xs text-amber-700">Atención: excede el presupuesto disponible.</p>}
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button type="submit" disabled={pending} size="lg">{pending ? 'Guardando…' : 'Guardar'}</Button>
          <Button type="button" variant="ghost" size="lg" onClick={() => { reset(); setOpen(false) }}>Cancelar</Button>
        </div>
      </div>
    </form>
  )
}

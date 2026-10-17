'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Receipt } from 'lucide-react'
import { registrarConsumo } from './actions'
import { formatEUR } from '@/lib/hucha/format'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'

function todayISO() { return new Date().toISOString().slice(0, 10) }
// Admite la coma decimal ("12,50"): Number() solo entiende el punto.
const aNumero = (s: string) => Number(s.trim().replace(',', '.'))

export default function ConsumoDialog({ projectId, projectName, remaining }: { projectId: string; projectName: string; remaining: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [entryDate, setEntryDate] = useState(todayISO())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const numericAmount = aNumero(amount)
  const valido = amount.trim() !== '' && Number.isFinite(numericAmount) && numericAmount > 0
  const willExceed = valido && numericAmount > remaining

  function onOpenChange(o: boolean) {
    setOpen(o)
    if (!o) { setAmount(''); setDescription(''); setEntryDate(todayISO()); setError(null) }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!valido) { setError('El importe debe ser mayor a 0.'); return }
    if (!description.trim()) { setError('La descripción es obligatoria.'); return }

    const fd = new FormData()
    fd.set('project_id', projectId)
    fd.set('amount', String(numericAmount))
    fd.set('description', description)
    fd.set('entry_date', entryDate)

    startTransition(async () => {
      const res = await registrarConsumo(fd)
      if (!res.ok) { setError(res.error); return }
      toast.success('Consumo registrado')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="lg" />}>
        <Receipt aria-hidden /> Registrar consumo
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Registrar consumo</DialogTitle>
            <DialogDescription>{projectName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="consumo-importe">Importe (€)</Label>
              <Input id="consumo-importe" inputMode="decimal" autoComplete="off" placeholder="0,00" value={amount}
                onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="consumo-fecha">Fecha</Label>
              <Input id="consumo-fecha" type="date" max={todayISO()} value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="consumo-descripcion">Descripción</Label>
              <Input id="consumo-descripcion" value={description}
                onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          {/* Lo que deja el consumo, antes de guardarlo. Si se pasa del disponible, lo dice aquí
              y el botón pasa a «Guardar igualmente». */}
          <div
            aria-live="polite"
            className={cn(
              'flex items-baseline justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
              willExceed ? 'bg-(--status-excedido)/8 text-(--status-excedido)' : 'bg-(--muted-surface) text-muted-foreground',
            )}
          >
            <span>{!valido ? 'Disponible' : willExceed ? 'Excede el presupuesto en' : 'Saldo tras el consumo'}</span>
            <span className={cn('tabular-money font-semibold', !willExceed && 'text-foreground')}>
              {formatEUR(!valido ? remaining : willExceed ? numericAmount - remaining : remaining - numericAmount)}
            </span>
          </div>

          {error && <p role="alert" className="rounded-lg bg-(--status-excedido)/8 px-3 py-2 text-sm text-(--status-excedido)">{error}</p>}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={pending} variant={willExceed ? 'destructive' : 'default'}>
              {pending ? 'Guardando…' : willExceed ? 'Guardar igualmente' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

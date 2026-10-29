'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { ampliarPresupuesto } from './actions'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { hoyISO } from '@/lib/horas/format'

// Ampliar presupuesto (solo admin). Es ocasional: un botón junto a «Registrar consumo»
// que abre el formulario, como «Ampliar horas» en Bancos de horas.
export default function AmpliarDialog({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [monto, setMonto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function onOpenChange(o: boolean) {
    setOpen(o)
    if (!o) { setMonto(''); setMotivo(''); setReferencia(''); setFecha(hoyISO()); setError(null) }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    // Admite la coma decimal ("250,50").
    const res = await ampliarPresupuesto(projectId, { monto: Number(monto.trim().replace(',', '.')), motivo, referencia, fecha })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    toast.success('Presupuesto ampliado')
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="lg" />}>
        <Plus aria-hidden /> Ampliar presupuesto
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Ampliar presupuesto</DialogTitle>
            <DialogDescription>{projectName}. Se suma al presupuesto del Excel.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ampliar-monto">Monto (€)</Label>
              <Input id="ampliar-monto" inputMode="decimal" autoComplete="off" placeholder="0,00" value={monto}
                onChange={(e) => setMonto(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ampliar-fecha">Fecha</Label>
              <Input id="ampliar-fecha" type="date" max={hoyISO()} value={fecha}
                onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="ampliar-motivo">Motivo</Label>
              <Input id="ampliar-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="ampliar-referencia">Referencia <span className="font-normal text-muted-foreground">(opcional)</span></Label>
              <Input id="ampliar-referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </div>
          </div>

          {error && <p role="alert" className="rounded-lg bg-(--status-excedido)/8 px-3 py-2 text-sm text-(--status-excedido)">{error}</p>}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={saving}>{saving ? 'Ampliando…' : 'Ampliar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

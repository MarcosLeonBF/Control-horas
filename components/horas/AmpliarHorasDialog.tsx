'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { ampliarHoras } from '@/app/(horas)/bancos/[project]/actions'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'

const today = () => new Date().toISOString().slice(0, 10)

// Ampliar horas (solo admin): un botón en la cabecera del detalle que abre el formulario.
// Antes era un formulario fijo encima de las cifras; es una acción ocasional, así que
// las cifras van primero.
export default function AmpliarHorasDialog({ project }: { project: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [horas, setHoras] = useState('')
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState(today())
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await ampliarHoras(project, { hours: Number(horas), reason: motivo, entry_date: fecha })
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Horas ampliadas')
    setHoras(''); setMotivo(''); setFecha(today())
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="lg" />}>
        <Plus aria-hidden /> Ampliar horas
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Ampliar horas</DialogTitle>
            <DialogDescription>{project}. Las horas se suman al asignado del mes de la fecha.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ampliar-horas">Horas</Label>
              <Input id="ampliar-horas" type="number" step="0.5" min="0" required value={horas}
                onChange={(e) => setHoras(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ampliar-fecha">Fecha</Label>
              <Input id="ampliar-fecha" type="date" max={today()} required value={fecha}
                onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="ampliar-motivo">Motivo</Label>
              <Input id="ampliar-motivo" required value={motivo}
                onChange={(e) => setMotivo(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={saving}>{saving ? 'Ampliando…' : 'Ampliar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

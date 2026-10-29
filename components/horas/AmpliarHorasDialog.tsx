'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { ampliarHoras } from '@/app/(horas)/bancos/[project]/actions'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import NativeSelect from '@/components/ui/native-select'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { hoyLocal } from '@/lib/horas/format'

// Ampliar horas (admin o manager del proyecto): un botón en la cabecera del detalle que
// abre el formulario. Es una acción ocasional, así que las cifras van primero.
// Toda ampliación es de una posición (spec 2026-10-15): primero las que ya tiene el
// proyecto; luego el resto del catálogo de quien amplía, por si se vende una posición
// que el proyecto aún no tenía.
export default function AmpliarHorasDialog({ project, posicionesProyecto, posicionesAlcance }: {
  project: string
  posicionesProyecto: string[]
  posicionesAlcance: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [posicion, setPosicion] = useState('')
  const [horas, setHoras] = useState('')
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState(hoyLocal())
  const [saving, setSaving] = useState(false)

  const delProyecto = posicionesAlcance.filter((p) => posicionesProyecto.includes(p))
  const otras = posicionesAlcance.filter((p) => !posicionesProyecto.includes(p))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await ampliarHoras(project, { position: posicion, hours: Number(horas), reason: motivo, entry_date: fecha })
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(`Horas ampliadas en ${posicion}`)
    setPosicion(''); setHoras(''); setMotivo(''); setFecha(hoyLocal())
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
            <DialogDescription>{project}. Estas horas no se pierden al cerrar el mes.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="ampliar-posicion">Posición</Label>
              <NativeSelect id="ampliar-posicion" fullWidth required value={posicion} onChange={(e) => setPosicion(e.target.value)}>
                <option value="" disabled>Elige la posición…</option>
                {delProyecto.length > 0 && (
                  <optgroup label="Del proyecto">
                    {delProyecto.map((p) => <option key={p} value={p}>{p}</option>)}
                  </optgroup>
                )}
                {otras.length > 0 && (
                  <optgroup label="Otras posiciones">
                    {otras.map((p) => <option key={p} value={p}>{p}</option>)}
                  </optgroup>
                )}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ampliar-horas">Horas</Label>
              <Input id="ampliar-horas" type="number" step="0.5" min="0" required value={horas}
                onChange={(e) => setHoras(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ampliar-fecha">Fecha</Label>
              <Input id="ampliar-fecha" type="date" max={hoyLocal()} required value={fecha}
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

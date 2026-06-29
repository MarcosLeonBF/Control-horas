'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ampliarHoras } from '@/app/(horas)/bancos/[project]/actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const today = () => new Date().toISOString().slice(0, 10)

export default function AmpliarHorasForm({ project }: { project: string }) {
  const router = useRouter()
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
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3">
      <h3 className="font-display text-base font-semibold">Ampliar horas</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input aria-label="Horas" type="number" step="0.5" min="0" placeholder="Horas" value={horas}
          onChange={(e) => setHoras(e.target.value)} />
        <Input aria-label="Fecha" type="date" max={today()} value={fecha}
          onChange={(e) => setFecha(e.target.value)} />
        <Input aria-label="Motivo" placeholder="Motivo" value={motivo}
          onChange={(e) => setMotivo(e.target.value)} className="sm:col-span-2" />
      </div>
      <Button type="submit" disabled={saving} size="lg">{saving ? 'Ampliando…' : 'Ampliar'}</Button>
    </form>
  )
}

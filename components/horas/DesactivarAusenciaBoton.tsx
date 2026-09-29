'use client'
// Botón de la lista «No llegó el desactivar a tiempo» del panel de usuarios: apaga a mano
// la ausencia en su Fecha fin. Solo lo ve un admin.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { desactivarAusencia } from '@/app/(horas)/admin/usuarios/actions'
import { Button } from '@/components/ui/button'

export default function DesactivarAusenciaBoton({ slackId, desde, fin }: { slackId: string; desde: string; fin: string }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)

  async function desactivar() {
    setOcupado(true)
    const res = await desactivarAusencia(slackId, desde)
    setOcupado(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(`Desactivada en su Fecha fin (${fin.slice(8, 10)}/${fin.slice(5, 7)})`)
    router.refresh()
  }

  return (
    <Button size="sm" variant="outline" disabled={ocupado} onClick={desactivar}>
      Desactivar en su Fecha fin
    </Button>
  )
}

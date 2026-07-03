'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'
import { cambiarContrasena } from '@/app/(horas)/perfil/actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export default function CambiarContrasenaForm({ forced }: { forced?: boolean }) {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('Las contraseñas no coinciden.')
      return
    }
    if (newPassword.length < 8) {
      toast.error('La nueva contraseña debe tener al menos 8 caracteres.')
      return
    }
    setSaving(true)
    const res = await cambiarContrasena(currentPassword, newPassword)
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Contraseña actualizada correctamente.')
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    if (forced) {
      // Tras cambiar, redirigir a la app
      router.push('/registrar')
      router.refresh()
    } else {
      router.refresh()
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Contraseña actual */}
      <div className="space-y-1.5">
        <Label htmlFor="current-password" className="text-xs uppercase tracking-wide text-muted-foreground">
          Contraseña actual
        </Label>
        <div className="relative">
          <Input id="current-password" type={showCurrent ? 'text' : 'password'} autoComplete="current-password"
            required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="••••••••" className="pr-9" />
          <button type="button" onClick={() => setShowCurrent((v) => !v)}
            aria-label={showCurrent ? 'Ocultar' : 'Mostrar'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground">
            {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      {/* Nueva contraseña */}
      <div className="space-y-1.5">
        <Label htmlFor="new-password" className="text-xs uppercase tracking-wide text-muted-foreground">
          Nueva contraseña
        </Label>
        <div className="relative">
          <Input id="new-password" type={showNew ? 'text' : 'password'} autoComplete="new-password"
            required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres" className="pr-9" />
          <button type="button" onClick={() => setShowNew((v) => !v)}
            aria-label={showNew ? 'Ocultar' : 'Mostrar'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground">
            {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      {/* Confirmar */}
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password" className="text-xs uppercase tracking-wide text-muted-foreground">
          Confirmar contraseña
        </Label>
        <Input id="confirm-password" type={showNew ? 'text' : 'password'} autoComplete="new-password"
          required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Repetí la nueva contraseña" />
      </div>

      <Button type="submit" disabled={saving} className="w-full sm:w-auto">
        {saving ? 'Cambiando…' : 'Cambiar contraseña'}
      </Button>
    </form>
  )
}

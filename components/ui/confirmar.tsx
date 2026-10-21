'use client'

import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface Pregunta {
  titulo: string
  texto: string // la consecuencia, en concreto: qué se pierde o qué vuelve a dónde
  accion: string // el verbo del botón ("Anular", "Eliminar"), nunca "Aceptar"
}

const ConfirmarCtx = createContext<((p: Pregunta) => Promise<boolean>) | null>(null)

// En lugar del confirm() del navegador ("localhost dice…"). Se usa igual que él:
// `if (!(await confirmar({ … }))) return`, pero con el diálogo de la app.
export function ConfirmarProvider({ children }: { children: ReactNode }) {
  // La pregunta se queda al cerrar: así el texto no se vacía durante la animación de salida.
  const [pregunta, setPregunta] = useState<Pregunta | null>(null)
  const [abierto, setAbierto] = useState(false)
  const responder = useRef<((ok: boolean) => void) | null>(null)

  function confirmar(p: Pregunta) {
    responder.current?.(false)
    setPregunta(p)
    setAbierto(true)
    return new Promise<boolean>((resolve) => { responder.current = resolve })
  }

  function cerrar(ok: boolean) {
    responder.current?.(ok)
    responder.current = null
    setAbierto(false)
  }

  return (
    <ConfirmarCtx value={confirmar}>
      {children}
      <Dialog open={abierto} onOpenChange={(open) => { if (!open) cerrar(false) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{pregunta?.titulo}</DialogTitle>
            <DialogDescription>{pregunta?.texto}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="button" variant="destructive" onClick={() => cerrar(true)}>{pregunta?.accion}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmarCtx>
  )
}

export function useConfirmar() {
  const confirmar = useContext(ConfirmarCtx)
  if (!confirmar) throw new Error('useConfirmar necesita <ConfirmarProvider> (app/layout.tsx)')
  return confirmar
}

// Después de responder al usuario: corre el detector y despacha lo que haya generado.
// El guardado nunca espera a la red, y un fallo aquí nunca le llega al usuario.
import { after } from 'next/server'
import { despacharPendientes } from '@/lib/avisos/bandeja'

export function trasResponder(trabajo: () => Promise<void>): void {
  after(async () => {
    try { await trabajo() } catch (e) { console.error('[avisos]', e instanceof Error ? e.message : e) }
    try { await despacharPendientes() } catch (e) { console.error('[avisos] despacho:', e instanceof Error ? e.message : e) }
  })
}

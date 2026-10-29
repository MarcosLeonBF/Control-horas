import { useSyncExternalStore } from 'react'
import { hoyLocal, hoyUTC } from '@/lib/horas/format'

const sinSuscripcion = () => () => {}

// hoyLocal en un componente que también pinta el servidor. El servidor solo sabe el día UTC:
// con ese se pinta y se hidrata, y justo después React repinta con el local si es otro
// (desde América, a partir de las 21:00), sin desajuste de hidratación.
export function useHoy(): string {
  return useSyncExternalStore(sinSuscripcion, hoyLocal, hoyUTC)
}

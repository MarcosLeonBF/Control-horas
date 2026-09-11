// Formato de cable de un aviso: el sobre v1 y la firma HMAC. Es lo que documenta el
// contrato (docs/avisos/contrato-avisos-v1.md); puro, lo prueba node-avisos.
import { createHmac } from 'node:crypto'

// X-Avisos-Firma: t=<segundos unix>,v1=<HMAC-SHA256 hex de "<t>.<cuerpo>">.
export function firmar(cuerpo: string, secreto: string, t: number): string {
  const v1 = createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')
  return `t=${t},v1=${v1}`
}

// Una fila de avisos_salientes tal como la devuelve avisos_reclamar.
export interface FilaSaliente {
  id: string
  tipo: string
  datos: unknown
  prueba: boolean
  intentos: number
  created_at: string
}

// `fecha` es la del hecho (created_at) y no cambia entre reintentos; `t` es el momento
// del envío, que es lo que el receptor compara con su reloj.
export function construirEnvio(fila: FilaSaliente, secreto: string, ahora: Date): { cuerpo: string; cabeceras: Record<string, string> } {
  const cuerpo = JSON.stringify({
    id: fila.id, tipo: fila.tipo, version: 1, fecha: new Date(fila.created_at).toISOString(), prueba: fila.prueba, datos: fila.datos,
  })
  const t = Math.floor(ahora.getTime() / 1000)
  return {
    cuerpo,
    cabeceras: {
      'Content-Type': 'application/json',
      'X-Avisos-Id': fila.id,
      'X-Avisos-Tipo': fila.tipo,
      'X-Avisos-Firma': firmar(cuerpo, secreto, t),
    },
  }
}

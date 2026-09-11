// Autenticación de las consultas y del cron: `Authorization: Bearer <secreto>`, comparada
// en tiempo constante. Sin secreto configurado no pasa nadie.
import { timingSafeEqual } from 'node:crypto'

export function autorizado(req: Request, secreto: string | undefined): boolean {
  if (!secreto) return false
  const recibido = Buffer.from(req.headers.get('authorization') ?? '')
  const esperado = Buffer.from(`Bearer ${secreto}`)
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado)
}

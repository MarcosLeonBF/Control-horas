'use client'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useHoy } from '@/lib/horas/use-hoy'

// El rango por defecto de Reportes y Estructura (del día 1 a hoy) lo pone el servidor con su
// día UTC. Si el mes de quien mira es otro (desde América, el último día por la noche el UTC
// ya es el siguiente), pide el rango de su mes. `hasta` es el hoy que usó el servidor.
export default function RangoDelMes({ hasta }: { hasta: string }) {
  const hoy = useHoy()
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    if (hoy.slice(0, 7) !== hasta.slice(0, 7)) router.replace(`${pathname}?from=${hoy.slice(0, 8)}01&to=${hoy}`, { scroll: false })
  }, [hoy, hasta, router, pathname])
  return null
}

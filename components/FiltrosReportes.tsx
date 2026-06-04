'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'

interface Props {
  proyectos:     string[]
  especialistas: { email: string; name: string }[]
}

export default function FiltrosReportes({ proyectos, especialistas }: Props) {
  const router     = useRouter()
  const pathname   = usePathname()
  const params     = useSearchParams()

  const get = (key: string) => params.get(key) ?? ''

  const update = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    router.push(`${pathname}?${next.toString()}`)
  }, [params, pathname, router])

  function limpiar() {
    router.push(pathname)
  }

  const hayFiltros = !!(get('proyecto') || get('especialista') || get('desde') || get('hasta'))

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Proyecto</label>
          <select
            value={get('proyecto')}
            onChange={(e) => update('proyecto', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todos</option>
            {proyectos.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Especialista</label>
          <select
            value={get('especialista')}
            onChange={(e) => update('especialista', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todos</option>
            {especialistas.map((e) => (
              <option key={e.email} value={e.email}>{e.name || e.email}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
          <input
            type="date"
            value={get('desde')}
            onChange={(e) => update('desde', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Hasta</label>
          <input
            type="date"
            value={get('hasta')}
            onChange={(e) => update('hasta', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {hayFiltros && (
        <button
          onClick={limpiar}
          className="mt-3 text-xs text-blue-600 hover:underline"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ActualizarBancoButton() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleClick() {
    setLoading(true)
    await fetch('/api/banco-horas', { method: 'POST' })
    router.refresh()
    setLoading(false)
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
    >
      {loading ? 'Actualizando...' : 'Actualizar banco'}
    </button>
  )
}

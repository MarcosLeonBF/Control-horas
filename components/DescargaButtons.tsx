'use client'

import type { TimeEntry } from '@/lib/types'

interface Props {
  entries: TimeEntry[]
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function fmt(n: number) {
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

// ─── CSV ────────────────────────────────────────────────────
function generarCSV(entries: TimeEntry[]): string {
  const cols = ['Especialista', 'Proyecto', 'Etapa', 'Departamento', 'Fecha', 'Horas', 'Descripción']
  const rows = entries.map((e) => [
    e.specialist_name || e.specialist_email,
    e.project,
    e.stage,
    e.department,
    fmtDate(e.entry_date),
    fmt(Number(e.hours)),
    e.description ?? '',
  ])

  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const lines   = [cols, ...rows].map((row) => row.map(escape).join(','))
  return lines.join('\r\n')
}

function descargar(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Excel (SheetJS) ─────────────────────────────────────────
async function generarExcel(entries: TimeEntry[]) {
  const XLSX = await import('xlsx')

  // Hoja 1: Detalle completo
  const detalle = entries.map((e) => ({
    Especialista: e.specialist_name || e.specialist_email,
    Proyecto:     e.project,
    Etapa:        e.stage,
    Departamento: e.department,
    Fecha:        fmtDate(e.entry_date),
    Horas:        Number(e.hours),
    Descripción:  e.description ?? '',
  }))

  // Hoja 2: Totales por proyecto
  const porProyecto: Record<string, number> = {}
  for (const e of entries) {
    porProyecto[e.project] = (porProyecto[e.project] ?? 0) + Number(e.hours)
  }
  const resumenProyecto = Object.entries(porProyecto)
    .sort((a, b) => b[1] - a[1])
    .map(([Proyecto, Horas]) => ({ Proyecto, Horas }))

  // Hoja 3: Totales por especialista
  const porEspecialista: Record<string, number> = {}
  for (const e of entries) {
    const k = e.specialist_name || e.specialist_email
    porEspecialista[k] = (porEspecialista[k] ?? 0) + Number(e.hours)
  }
  const resumenEspecialista = Object.entries(porEspecialista)
    .sort((a, b) => b[1] - a[1])
    .map(([Especialista, Horas]) => ({ Especialista, Horas }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalle),             'Detalle')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumenProyecto),     'Por Proyecto')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumenEspecialista), 'Por Especialista')

  XLSX.writeFile(wb, 'reporte-horas.xlsx')
}

// ─── Componente ──────────────────────────────────────────────
export default function DescargaButtons({ entries }: Props) {
  const total = entries.reduce((s, e) => s + Number(e.hours), 0)
  const label = `${entries.length} registro${entries.length !== 1 ? 's' : ''} · ${fmt(total)}h totales`

  return (
    <div className="flex items-center gap-3 flex-wrap mb-6">
      <span className="text-sm text-gray-500">{label}</span>
      <div className="flex gap-2 ml-auto">
        <button
          onClick={() => descargar(generarCSV(entries), 'reporte-horas.csv', 'text/csv;charset=utf-8;')}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Descargar CSV
        </button>
        <button
          onClick={() => generarExcel(entries)}
          className="text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
        >
          Descargar Excel
        </button>
      </div>
    </div>
  )
}

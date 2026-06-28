// Utilidades de descarga (cliente). Excel vía SheetJS (import dinámico) + CSV.
export type ExportRow = Record<string, string | number>

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadXlsx(filename: string, rows: ExportRow[], sheetName = 'Datos') {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  )
}

export function downloadCsv(filename: string, rows: ExportRow[]) {
  const cols = rows.length ? Object.keys(rows[0]) : []
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const lines = [cols.map(esc), ...rows.map((r) => cols.map((c) => esc(r[c] ?? '')))].map((r) => r.join(','))
  triggerDownload(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }), filename)
}

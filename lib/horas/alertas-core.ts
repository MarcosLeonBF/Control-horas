// Núcleo puro de las alertas de banco de horas (sin IO). Testeable en node.
export type Threshold = '80' | '100' | 'exceso'
export const SEVERITY: Threshold[] = ['80', '100', 'exceso']

// Umbrales alcanzados por el consumo actual (subconjunto de SEVERITY).
export function nivelesAlcanzados(assigned: number, consumed: number): Threshold[] {
  if (assigned <= 0) return []
  const out: Threshold[] = []
  if (consumed >= 0.8 * assigned) out.push('80')
  if (consumed >= assigned) out.push('100')
  if (consumed > assigned) out.push('exceso')
  return out
}

// El umbral más severo de un conjunto, o null.
export function masSevero(niveles: Threshold[]): Threshold | null {
  for (let i = SEVERITY.length - 1; i >= 0; i--) {
    if (niveles.includes(SEVERITY[i])) return SEVERITY[i]
  }
  return null
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function mensajeAlerta(project: string, t: Threshold, assigned: number, consumed: number): string {
  if (t === '80') {
    return `⚠️ El proyecto *${project}* consumió el 80% de su banco de horas. Quedan ${fmt(assigned - consumed)} de ${fmt(assigned)} horas.`
  }
  if (t === '100') {
    return `🔴 El proyecto *${project}* consumió el 100% de su banco de horas. No quedan horas disponibles (${fmt(assigned)} h).`
  }
  return `🚨 El proyecto *${project}* excedió su banco de horas. Contratadas: ${fmt(assigned)} h · consumidas: ${fmt(consumed)} h · exceso: ${fmt(consumed - assigned)} h.`
}

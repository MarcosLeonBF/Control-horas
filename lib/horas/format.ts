export function formatHoras(n: number): string {
  const v = Number(n)
  return (v % 1 === 0 ? String(v) : v.toFixed(1)) + 'h'
}

// PostgREST devuelve como mucho 1.000 filas por petición (tope de Supabase). Una
// consulta que pueda superarlas se trunca EN SILENCIO: no da error, simplemente
// faltan filas y los totales salen cortos. Ya pasó con horas_historicas (1.967
// filas): el banco sumaba solo las 1.000 primeras.
//
// Cualquier consulta sin filtro acotado —o con un rango amplio— debe pasar por aquí.
const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  page: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const todas: T[] = []
  for (let desde = 0; ; desde += PAGE_SIZE) {
    const { data } = await page(desde, desde + PAGE_SIZE - 1)
    const chunk = (data ?? []) as T[]
    todas.push(...chunk)
    // Una página incompleta significa que ya no quedan más filas.
    if (chunk.length < PAGE_SIZE) break
  }
  return todas
}

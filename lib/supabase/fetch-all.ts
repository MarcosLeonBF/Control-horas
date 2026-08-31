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
    const { data, error } = await page(desde, desde + PAGE_SIZE - 1)
    // El error NO se descarta, y aquí importa más que en ningún sitio: con `data` a null
    // el trozo sale vacío, "vacío" se lee como "ya no hay más filas" y la función
    // devolvería datos PARCIALES haciéndolos pasar por completos. Justo el fallo que
    // esta función existe para evitar, solo que por otra puerta. Y lo que se cuenta con
    // estos datos son horas facturables: mejor un error visible que un total corto.
    if (error) {
      const mensaje = (error as { message?: string })?.message ?? String(error)
      throw new Error(`Lectura paginada incompleta a partir de la fila ${desde}: ${mensaje}`)
    }
    const chunk = (data ?? []) as T[]
    todas.push(...chunk)
    // Una página incompleta significa que ya no quedan más filas.
    if (chunk.length < PAGE_SIZE) break
  }
  return todas
}

// Casar un nombre suelto —el «Manager del proyecto» del Excel de bancos y del de HUCHA—
// con UNA persona. El Excel trae casi siempre el nombre de pila ("Antonio", "Juan Fran",
// "Jen") y el perfil, el completo ("Antonio Parrilla"): con la igualdad exacta no casaba
// ninguno (2026-10-02). Se prueba de lo más exacto a lo más laxo y se para en el primer
// nivel que encuentre a alguien:
//   1. el nombre completo, igual;
//   2. las palabras del Excel son las primeras del perfil ("Antonio" → "Antonio Parrilla");
//   3. cada palabra del Excel abre la del perfil en su sitio ("Juan Fran" → "Juan Francisco …").
// Siempre sin mayúsculas, tildes ni espacios de más. Si en ese nivel hay más de una, null:
// mencionar a una de las dos sería avisar a la persona equivocada.

function palabras(s: string): string[] {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean)
}

const NIVELES: ((buscado: string[], perfil: string[]) => boolean)[] = [
  (b, p) => b.length === p.length && b.every((w, i) => w === p[i]),
  (b, p) => b.length <= p.length && b.every((w, i) => w === p[i]),
  (b, p) => b.length <= p.length && b.every((w, i) => p[i].startsWith(w)),
]

export function casarPorNombre<T>(nombre: string, candidatos: T[], nombreDe: (c: T) => string): T | null {
  const buscado = palabras(nombre)
  if (buscado.length === 0) return null
  const conPalabras = candidatos.map((c) => ({ c, p: palabras(nombreDe(c)) }))
  for (const casa of NIVELES) {
    const iguales = conPalabras.filter(({ p }) => casa(buscado, p))
    if (iguales.length === 1) return iguales[0].c
    if (iguales.length > 1) return null
  }
  return null
}

// Color por ETAPA para el desglose de /reportes. Mismo criterio de "solo presentación"
// que area-icon.ts y departamento-icon.ts: no se guarda, no se valida, no toca el dato.
//
// Por qué etapa y no proyecto: hay ~70 proyectos y solo caben 4 tonos, así que un color
// por proyecto se repetía cada 17 y no distinguía nada (en una lista de 4 registros,
// 91% de probabilidad de tonos repetidos). Las etapas de cliente son 6, y tres de ellas
// copan el 95% de las líneas: ahí 4 tonos sí alcanzan, y el color significa algo estable
// —dos puntos iguales SON la misma etapa—.
//
// Cuatro tonos y no más: con el carmín de marca y los seis colores de estado de HUCHA ya
// ocupados, es el máximo que pasa las comprobaciones de daltonismo (azul y violeta
// colapsan entre sí bajo deuteranopía, igual que oliva y naranja). Validados en claro y
// en oscuro con los mismos valores; viven en globals.css como --etapa-1..4.
export const PALETA_ETAPA = [
  'var(--etapa-1)',
  'var(--etapa-2)',
  'var(--etapa-3)',
  'var(--etapa-4)',
] as const

// Minúsculas, sin acentos, sin espacios en los bordes — igual que area-icon.ts.
function normalizar(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Reparto fijo de las 11 etapas del catálogo. No es decorativo y no se deja al hash: un
// hash agolpa (la primera versión dejaba el rosa sin usar y el violeta en cuatro etapas).
//
// Con 11 etapas y 4 tonos, repetir es inevitable —eso no lo arregla ningún reparto—. Lo
// que sí se puede garantizar, y es lo que hace esta tabla:
//   · los cuatro tonos se usan;
//   · las etapas que más aparecen salen todas distintas;
//   · dentro de la familia "Gastos Generales", que se ve junta en las filas internas,
//     ninguna comparte tono con otra de la familia.
// Si una etapa nueva se vuelve importante, se añade aquí a mano: una decisión, no un
// sorteo.
const SLOT_FIJO: Readonly<Record<string, number>> = {
  // Cliente, por volumen de líneas
  'servicios mensuales': 0,
  setup: 1,
  'sales coach': 2,
  'captacion de talento': 1,
  crm: 2,
  'servicios adicionales': 3,
  // Internas: la familia entera separada entre sí
  'gastos generales clientes': 3,
  'gastos generales corporativos': 0,
  'gastos generales ventas': 1,
  'gastos generales marketing': 2,
  'gastos indirectos captacion': 3,
}

export function etapaColor(etapa: string): string {
  const n = normalizar(etapa)
  const fijo = SLOT_FIJO[n]
  if (fijo !== undefined) return PALETA_ETAPA[fijo]

  // Etapa nueva: no se queda sin color. Hash estable (djb2) sobre la misma paleta, así
  // que el mismo nombre da siempre el mismo tono entre sesiones y entre pantallas, sin
  // depender de cuántas etapas haya ni del orden en que se creen.
  let h = 5381
  for (let i = 0; i < n.length; i++) h = ((h << 5) + h + n.charCodeAt(i)) | 0
  return PALETA_ETAPA[Math.abs(h) % PALETA_ETAPA.length]
}

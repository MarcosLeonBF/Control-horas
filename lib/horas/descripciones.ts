// Reglas puras de las descripciones del proyecto "Departamento". Quién puede usar cada
// una lo decide el servidor (guardar_registro, migración 0044); aquí solo vive lo que
// necesita la interfaz para pintar el desplegable y para avisar de una mal configurada.

export interface GruposDescripcion {
  generales: string[]
  posicion: string[]
}

// Agrupa para el desplegable: las generales por un lado y las específicas de la posición
// por otro. Una descripción es general O específica, nunca las dos; si aun así un nombre
// llegara en ambas listas gana el de la posición, porque si no saldría repetido.
export function agruparDescripciones(generales: string[], deLaPosicion: string[]): GruposDescripcion {
  const alfabetico = (a: string, b: string) => a.localeCompare(b)
  const posicion = [...new Set(deLaPosicion)].sort(alfabetico)
  const enPosicion = new Set(posicion)
  return {
    generales: [...new Set(generales)].filter((n) => !enPosicion.has(n)).sort(alfabetico),
    posicion,
  }
}

// Específica que no se asignó a ninguna posición: existe, puede estar activa, y no la ve
// nadie. El panel de catálogos la señala para que no se quede así por descuido.
export function esDescripcionHuerfana(d: { alcance: string; positionIds: string[] }): boolean {
  return d.alcance === 'posicion' && d.positionIds.length === 0
}

// ¿Vale esta descripción para una línea del proyecto "Departamento"? Espejo exacto de lo
// que comprueba guardar_registro (0044): con libertad basta con que no esté vacía, y sin
// ella tiene que salir del catálogo. La libertad añade, no sustituye: quien la tiene
// sigue pudiendo elegir de la lista.
//
// El formulario la usa para NO borrar lo que hay escrito al entrar en "Departamento".
export function descripcionValidaEnDepartamento(desc: string, permitidas: string[], libre: boolean): boolean {
  if (!desc.trim()) return false
  return permitidas.includes(desc) || libre
}

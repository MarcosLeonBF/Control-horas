// Contrato v1 de los avisos, en código (docs/avisos/contrato-avisos-v1.md es su versión
// para Julián). Tipos de cada aviso y un ejemplo de cada uno, que es lo que manda el
// botón «Enviar prueba» de Administración → Avisos.
import type { Nivel } from '@/lib/avisos/reglas'

export const TIPOS_AVISO = [
  'registro.enviado', 'registro.llamativo', 'banco.nivel', 'banco.al_tope',
  'hucha.proyecto_nuevo', 'hucha.ampliacion', 'hucha.nivel',
] as const
export type TipoAviso = (typeof TIPOS_AVISO)[number]

export const DESCRIPCION_TIPO: Record<TipoAviso, string> = {
  'registro.enviado': 'Cada registro diario que se da de alta (el pulso)',
  'registro.llamativo': 'Un día con muchas horas, o muchas horas a un solo proyecto',
  'banco.nivel': 'Un banco de horas, por posición o total, empeora de nivel',
  'banco.al_tope': 'El total de un proyecto llega al 100%',
  'hucha.proyecto_nuevo': 'Entra un proyecto nuevo con HUCHA al sincronizar',
  'hucha.ampliacion': 'Se amplía el presupuesto de una HUCHA',
  'hucha.nivel': 'Una HUCHA empeora de nivel (baja, agotada o excedida)',
}

export interface PersonaAviso { id: string; nombre: string; email: string; posicion: string | null; rol: string }
export interface ManagerAviso { id: string | null; nombre: string; email: string | null }
export interface HorasAviso { asignadas: number; ampliadas: number; consumidas: number; inutilizables: number; disponibles: number }
export interface SaldoHucha { asignado: number; consumido: number; disponible: number }

export interface DatosRegistroEnviado {
  persona: PersonaAviso; manager_directo: ManagerAviso | null; dia: string
  horas_registro: number; horas_dia: number
  proyectos: { proyecto: string; horas: number }[]; proyectos_texto: string
}
export interface DatosRegistroLlamativo {
  persona: PersonaAviso; manager_directo: ManagerAviso | null; dia: string
  regla: 'dia_largo' | 'proyecto_largo'; valor: number; limite: number; proyecto: string | null
  horas_dia: number; descripcion: string
}
export interface DatosBanco {
  proyecto: string; alcance: 'posicion' | 'proyecto'; posicion: string | null
  nivel: Nivel; nivel_anterior: Nivel; horas: HorasAviso; porcentaje_consumido: number | null
  estado_proyecto: string | null; manager_proyecto: ManagerAviso | null; enlace: string
}
export interface DatosHuchaNuevo {
  proyecto: string; proyecto_id: string; presupuesto: number; moneda: string; managers: ManagerAviso[]; enlace: string
}
export interface DatosHuchaAmpliacion {
  proyecto: string; proyecto_id: string; importe: number; moneda: string; motivo: string; referencia: string | null
  dia: string; actor: { nombre: string; email: string | null }; saldo: SaldoHucha; nivel: Nivel | null; managers: ManagerAviso[]; enlace: string
}
export interface DatosHuchaNivel {
  proyecto: string; proyecto_id: string; nivel: Nivel; nivel_anterior: Nivel; moneda: string
  saldo: SaldoHucha; managers: ManagerAviso[]; enlace: string
}

export interface DatosPorTipo {
  'registro.enviado': DatosRegistroEnviado
  'registro.llamativo': DatosRegistroLlamativo
  'banco.nivel': DatosBanco
  'banco.al_tope': DatosBanco
  'hucha.proyecto_nuevo': DatosHuchaNuevo
  'hucha.ampliacion': DatosHuchaAmpliacion
  'hucha.nivel': DatosHuchaNivel
}

// Los mismos ejemplos que el contrato. `base` = appUrl(), para que los enlaces sean reales.
export function ejemplos(base: string): { [K in TipoAviso]: DatosPorTipo[K] } {
  const persona: PersonaAviso = {
    id: '00000000-0000-4000-8000-00000000a1b2', nombre: 'Laura Gómez', email: 'laura.gomez@ejemplo.com',
    posicion: 'SEO Strategist', rol: 'operativo',
  }
  const manager: ManagerAviso = { id: '00000000-0000-4000-8000-00000000c3d4', nombre: 'Carlos Ruiz', email: 'carlos.ruiz@ejemplo.com' }
  const proyectoId = '00000000-0000-4000-8000-00000000e5f6'
  const enlaceHucha = `${base}/presupuestos/${proyectoId}`
  const banco: DatosBanco = {
    proyecto: 'Proyecto Ejemplo', alcance: 'posicion', posicion: 'SEO Strategist', nivel: 'bajo', nivel_anterior: 'disponible',
    horas: { asignadas: 40, ampliadas: 0, consumidas: 33.5, inutilizables: 0, disponibles: 6.5 }, porcentaje_consumido: 83.8,
    estado_proyecto: 'Activo', manager_proyecto: manager, enlace: `${base}/bancos/Proyecto%20Ejemplo`,
  }
  return {
    'registro.enviado': {
      persona, manager_directo: manager, dia: '2026-09-14', horas_registro: 7.5, horas_dia: 7.5,
      proyectos: [{ proyecto: 'Proyecto Ejemplo', horas: 5 }, { proyecto: 'Departamento', horas: 2.5 }],
      proyectos_texto: 'Proyecto Ejemplo (5 h), Departamento (2,5 h)',
    },
    // Distinto del contrato a propósito: la prueba enseña el caso con proyecto (en dia_largo
    // `proyecto` siempre es null), que es el que Julián no podía ver.
    'registro.llamativo': {
      persona, manager_directo: manager, dia: '2026-09-14', regla: 'proyecto_largo', valor: 6, limite: 5,
      proyecto: 'Proyecto Ejemplo', horas_dia: 8, descripcion: '6 h a Proyecto Ejemplo el 14/09 (límite: 5 h)',
    },
    'banco.nivel': banco,
    'banco.al_tope': {
      ...banco, alcance: 'proyecto', posicion: null, nivel: 'consumido', nivel_anterior: 'bajo',
      horas: { asignadas: 120, ampliadas: 20, consumidas: 120, inutilizables: 0, disponibles: 0 }, porcentaje_consumido: 100,
    },
    'hucha.proyecto_nuevo': {
      proyecto: 'Proyecto Ejemplo', proyecto_id: proyectoId, presupuesto: 2500, moneda: 'EUR', managers: [manager], enlace: enlaceHucha,
    },
    'hucha.ampliacion': {
      proyecto: 'Proyecto Ejemplo', proyecto_id: proyectoId, importe: 500, moneda: 'EUR',
      motivo: 'Ampliación aprobada por el cliente', referencia: 'PO-2026-118', dia: '2026-09-14',
      actor: { nombre: 'Marta López', email: 'marta.lopez@ejemplo.com' },
      saldo: { asignado: 3000, consumido: 2450, disponible: 550 }, nivel: 'bajo', managers: [manager], enlace: enlaceHucha,
    },
    'hucha.nivel': {
      proyecto: 'Proyecto Ejemplo', proyecto_id: proyectoId, nivel: 'consumido', nivel_anterior: 'bajo', moneda: 'EUR',
      saldo: { asignado: 3000, consumido: 3000, disponible: 0 }, managers: [manager], enlace: enlaceHucha,
    },
  }
}

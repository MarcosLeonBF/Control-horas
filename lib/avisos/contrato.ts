// Contrato v1 de los avisos, en código (docs/avisos/contrato-avisos-v1.md es su versión
// para Julián). Tipos de cada aviso y un ejemplo de cada uno, que es lo que manda el
// botón «Enviar prueba» de Administración → Avisos.
import type { Nivel } from '@/lib/avisos/reglas'

export const TIPOS_AVISO = [
  'registro.enviado', 'registro.llamativo', 'banco.nivel', 'banco.al_tope', 'banco.ampliacion',
  'hucha.proyecto_nuevo', 'hucha.ampliacion', 'hucha.nivel',
] as const
export type TipoAviso = (typeof TIPOS_AVISO)[number]

export const DESCRIPCION_TIPO: Record<TipoAviso, string> = {
  'registro.enviado': 'Cada registro diario que se da de alta (el pulso)',
  'registro.llamativo': 'Un día con muchas horas, o muchas horas a un solo proyecto',
  'banco.nivel': 'Un banco de horas, por posición o total, empeora de nivel',
  'banco.al_tope': 'El total de un proyecto llega al 100%',
  'banco.ampliacion': 'Se amplían las horas del banco de un proyecto',
  'hucha.proyecto_nuevo': 'Entra un proyecto nuevo con HUCHA al sincronizar',
  'hucha.ampliacion': 'Se amplía el presupuesto de una HUCHA',
  'hucha.nivel': 'Una HUCHA empeora de nivel (baja, agotada o excedida)',
}

// `equipo` es el equipo de la EMPRESA (organigrama: Clientes, RRHH…, tabla `equipos`,
// migración 0049), con el que los flujos deciden a qué canal va cada aviso. No confundir
// con el `department` de una línea de registro (Clientes, Ventas, Marketing, Todos), que
// es otra lista y no viaja en los avisos. Va en TODA persona del payload —persona,
// managers y actor— para que ningún tipo de aviso se quede sin por dónde enrutar.
// null = esa persona todavía no tiene equipo asignado, o no se pudo resolver quién es.
export interface PersonaAviso { id: string; nombre: string; email: string; posicion: string | null; equipo: string | null; rol: string }
export interface ManagerAviso { id: string | null; nombre: string; email: string | null; equipo: string | null }
export interface ActorAviso { nombre: string; email: string | null; equipo: string | null }
export interface HorasAviso { asignadas: number; ampliadas: number; consumidas: number; inutilizables: number; disponibles: number }
export interface SaldoHucha { asignado: number; consumido: number; disponible: number }

// El registro que provocó un aviso de banco: quién, qué día y el enlace para abrirlo.
export interface RegistroAviso { persona: PersonaAviso; dia: string; enlace: string }

// `enlace_registro` lleva a /registros/<id>: el registro de ESTE guardado para ese día
// (un guardado se parte en uno por día). Lo abre quien ya podía verlo: el dueño, su
// manager y Administración.
export interface DatosRegistroEnviado {
  persona: PersonaAviso; manager_directo: ManagerAviso | null; dia: string
  horas_registro: number; horas_dia: number
  proyectos: { proyecto: string; horas: number }[]; proyectos_texto: string
  enlace_registro: string
}
export interface DatosRegistroLlamativo {
  persona: PersonaAviso; manager_directo: ManagerAviso | null; dia: string
  regla: 'dia_largo' | 'proyecto_largo'; valor: number; limite: number; proyecto: string | null
  horas_dia: number; descripcion: string
  enlace_registro: string
}
// `registro` es el registro que hizo caer el banco. null cuando no lo provocó un
// registro: el cron diario, una sincronización del Excel o anular una ampliación.
export interface DatosBanco {
  proyecto: string; alcance: 'posicion' | 'proyecto'; posicion: string | null
  nivel: Nivel; nivel_anterior: Nivel; horas: HorasAviso; porcentaje_consumido: number | null
  estado_proyecto: string | null; manager_proyecto: ManagerAviso | null; enlace: string
  registro: RegistroAviso | null
}
// El gemelo de hucha.ampliacion, en horas. Lo que sale de la base (proyecto, horas de
// esta ampliación, motivo, día, actor, enlace) llega SIEMPRE. Lo que sale del Excel de
// SharePoint —el estado del banco tras ampliar y el manager del proyecto— llega en null
// si Graph no respondió: así un fallo ajeno nunca se come el aviso de una ampliación.
//
// `horas_ampliacion` son las horas de ESTA ampliación; `horas.ampliadas`, el total
// ampliado del proyecto, ésta incluida. Van con nombres distintos a propósito.
export interface DatosBancoAmpliacion {
  proyecto: string; horas_ampliacion: number; motivo: string; dia: string; actor: ActorAviso
  horas: HorasAviso | null; nivel: Nivel | null; porcentaje_consumido: number | null
  manager_proyecto: ManagerAviso | null; enlace: string
}
export interface DatosHuchaNuevo {
  proyecto: string; proyecto_id: string; presupuesto: number; moneda: string; managers: ManagerAviso[]; enlace: string
}
export interface DatosHuchaAmpliacion {
  proyecto: string; proyecto_id: string; importe: number; moneda: string; motivo: string; referencia: string | null
  dia: string; actor: ActorAviso; saldo: SaldoHucha; nivel: Nivel | null; managers: ManagerAviso[]; enlace: string
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
  'banco.ampliacion': DatosBancoAmpliacion
  'hucha.proyecto_nuevo': DatosHuchaNuevo
  'hucha.ampliacion': DatosHuchaAmpliacion
  'hucha.nivel': DatosHuchaNivel
}

// Los mismos ejemplos que el contrato. `base` = appUrl(), para que los enlaces sean reales.
export function ejemplos(base: string): { [K in TipoAviso]: DatosPorTipo[K] } {
  const persona: PersonaAviso = {
    id: '00000000-0000-4000-8000-00000000a1b2', nombre: 'Laura Gómez', email: 'laura.gomez@ejemplo.com',
    posicion: 'SEO Strategist', equipo: 'Clientes', rol: 'operativo',
  }
  const manager: ManagerAviso = { id: '00000000-0000-4000-8000-00000000c3d4', nombre: 'Carlos Ruiz', email: 'carlos.ruiz@ejemplo.com', equipo: 'Clientes' }
  const proyectoId = '00000000-0000-4000-8000-00000000e5f6'
  const enlaceHucha = `${base}/presupuestos/${proyectoId}`
  // Un id que no existe: en la prueba, el enlace abre «Registro no disponible», que es
  // justo lo que tiene que pasar con un id que no es de nadie.
  const enlaceRegistro = `${base}/registros/00000000-0000-4000-8000-0000000017a9`
  const banco: DatosBanco = {
    proyecto: 'Proyecto Ejemplo', alcance: 'posicion', posicion: 'SEO Strategist', nivel: 'bajo', nivel_anterior: 'disponible',
    horas: { asignadas: 40, ampliadas: 0, consumidas: 33.5, inutilizables: 0, disponibles: 6.5 }, porcentaje_consumido: 83.8,
    estado_proyecto: 'Activo', manager_proyecto: manager, enlace: `${base}/bancos/Proyecto%20Ejemplo`,
    registro: { persona, dia: '2026-09-14', enlace: enlaceRegistro },
  }
  return {
    'registro.enviado': {
      persona, manager_directo: manager, dia: '2026-09-14', horas_registro: 7.5, horas_dia: 7.5,
      proyectos: [{ proyecto: 'Proyecto Ejemplo', horas: 5 }, { proyecto: 'Departamento', horas: 2.5 }],
      proyectos_texto: 'Proyecto Ejemplo (5 h), Departamento (2,5 h)',
      enlace_registro: enlaceRegistro,
    },
    // Distinto del contrato a propósito: la prueba enseña el caso con proyecto (en dia_largo
    // `proyecto` siempre es null), que es el que Julián no podía ver.
    'registro.llamativo': {
      persona, manager_directo: manager, dia: '2026-09-14', regla: 'proyecto_largo', valor: 6, limite: 5,
      proyecto: 'Proyecto Ejemplo', horas_dia: 8, descripcion: '6 h a Proyecto Ejemplo el 14/09 (límite: 5 h)',
      enlace_registro: enlaceRegistro,
    },
    'banco.nivel': banco,
    'banco.al_tope': {
      ...banco, alcance: 'proyecto', posicion: null, nivel: 'consumido', nivel_anterior: 'bajo',
      horas: { asignadas: 120, ampliadas: 20, consumidas: 120, inutilizables: 0, disponibles: 0 }, porcentaje_consumido: 100,
    },
    // El caso con el Excel respondiendo, que es el normal. Que `horas`, `nivel` y
    // `manager_proyecto` puedan llegar en null lo cuenta el contrato, no la prueba.
    'banco.ampliacion': {
      proyecto: 'Proyecto Ejemplo', horas_ampliacion: 20, motivo: 'Ampliación aprobada por el cliente', dia: '2026-09-18',
      actor: { nombre: 'Marta López', email: 'marta.lopez@ejemplo.com', equipo: 'RRHH' },
      horas: { asignadas: 180, ampliadas: 20, consumidas: 120, inutilizables: 0, disponibles: 60 },
      nivel: 'disponible', porcentaje_consumido: 66.7,
      manager_proyecto: manager, enlace: `${base}/bancos/Proyecto%20Ejemplo`,
    },
    'hucha.proyecto_nuevo': {
      proyecto: 'Proyecto Ejemplo', proyecto_id: proyectoId, presupuesto: 2500, moneda: 'EUR', managers: [manager], enlace: enlaceHucha,
    },
    'hucha.ampliacion': {
      proyecto: 'Proyecto Ejemplo', proyecto_id: proyectoId, importe: 500, moneda: 'EUR',
      motivo: 'Ampliación aprobada por el cliente', referencia: 'PO-2026-118', dia: '2026-09-14',
      actor: { nombre: 'Marta López', email: 'marta.lopez@ejemplo.com', equipo: 'RRHH' },
      saldo: { asignado: 3000, consumido: 2450, disponible: 550 }, nivel: 'bajo', managers: [manager], enlace: enlaceHucha,
    },
    'hucha.nivel': {
      proyecto: 'Proyecto Ejemplo', proyecto_id: proyectoId, nivel: 'consumido', nivel_anterior: 'bajo', moneda: 'EUR',
      saldo: { asignado: 3000, consumido: 3000, disponible: 0 }, managers: [manager], enlace: enlaceHucha,
    },
  }
}

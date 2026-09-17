'use client'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { guardarRegistro, type LineInput } from '@/app/(horas)/registrar/actions'
import { formatHoras, hmAHoras, horasAHM } from '@/lib/horas/format'
import type { AreaRow, EtapaRow, DepartamentoRow } from '@/lib/horas/types'
import { DIAS_REGISTRO_POR_DEFECTO } from '@/lib/horas/ventana-registro'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { TriangleAlert, CircleHelp, List } from 'lucide-react'
import ProjectCombobox from '@/components/horas/ProjectCombobox'
import DepartamentoSelect from '@/components/horas/DepartamentoSelect'
import NativeSelect from '@/components/ui/native-select'
import { agruparDescripciones, descripcionValidaEnDepartamento } from '@/lib/horas/descripciones'

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
// El departamento solo aplica al proyecto "Departamento". El resto de líneas lo
// llevan fijo en 'Clientes' (valor canónico histórico; la RPC también lo normaliza).
// No usar departamentos[0]: el catálogo es editable y su primer nombre cambia.
const CLIENTES_DEP = 'Clientes'
// Valor de la opción "Otra" del desplegable de descripción (0044). No es una
// descripción: es la señal de que esa línea pasa a escribirse a mano. Va entre guiones
// bajos para no chocar con un nombre real del catálogo.
const OTRA = '__otra__'
// Lo que hay escrito en las dos casillas del campo de tiempo, como texto. Se guarda
// aparte de `hours` para que teclear un "0" no se desvanezca: si el valor mostrado se
// derivara de `hours`, un 0 daría 0 horas y el campo volvería a pintarse vacío.
type TiempoBorrador = { h: string; m: string }

// Lo que admite una casilla del reloj: hasta dos cifras y nada más (vacío incluido).
const DOS_CIFRAS = /^\d{0,2}$/

// Sin spinners: en dos casillas estrechas ocupan más que las cifras. El ancho lo pone
// cada casilla (las cifras mandan), no este base: así el campo mide lo que mide "0:00h".
const casillaTiempo =
  'min-w-0 bg-transparent py-2 text-sm text-foreground tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
const emptyLine = (areaId: string, date: string): LineInput => ({ entry_date: date, project: '', area_id: areaId, department: CLIENTES_DEP, etapa_id: '', hours: 0, description: '' })

// Validación previa al guardado, acotada a los campos uuid (area_id, etapa_id) que son
// NOT NULL en la BD: si llegan vacíos ('') el motor hace ''::uuid y Postgres devuelve el
// error críptico "invalid input syntax for type uuid". El caso típico: la posición del
// usuario no tiene área/etapa asignada, así que quedan ''. Lo convertimos en un mensaje
// claro. El resto de validaciones (descripción, horas) ya las reporta el motor con
// mensajes legibles. Devuelve el primer problema o null si todo ok.
export function primerErrorLinea(lines: LineInput[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const n = i + 1
    if (!l.project) return `Línea ${n}: elegí un proyecto.`
    if (!l.area_id) return `Línea ${n}: tu posición no tiene un área asignada. Pedile al administrador que le asigne un área a tu posición en Catálogos → Posiciones.`
    if (!l.etapa_id) return `Línea ${n}: falta la etapa. Elegí una o, si el desplegable está vacío, pedile al admin que asigne etapas a tu posición.`
  }
  return null
}

const field =
  'w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

// La cabecera de Tiempo explica el formato al pasar por encima. El circulito es la
// señal de que hay algo que leer: apagado hasta que el puntero llega a la etiqueta, para
// que no compita con los nombres de las columnas. La etiqueta entera es el disparador,
// no solo el icono: 14px es un blanco pequeño para apuntar.
function EtiquetaTiempo() {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger render={<span className="group inline-flex cursor-help items-center gap-1" />}>
          Tiempo
          <CircleHelp aria-hidden className="size-3.5 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
        </TooltipTrigger>
        <TooltipContent className="block px-3 py-2.5">
          <p className="font-medium">Escribe horas y minutos</p>
          {/* Las cifras enseñan el formato; la glosa dice qué significan. */}
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-background/70">
            <dt className="tabular-nums text-background">3:30</dt><dd>tres horas y media</dd>
            <dt className="tabular-nums text-background">3:15</dt><dd>tres y cuarto</dd>
            <dt className="tabular-nums text-background">0:10</dt><dd>diez minutos</dd>
          </dl>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Campo etiquetado para la vista móvil (label arriba + control).
function MobileField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export default function RegistroForm({ projects, finishedProjects, pausedProjects, exceededProjects, areas, etapas, clientEtapas, descripciones, descripcionesPosicion = [], descripcionLibre = false, departamentos, internalAreaId, canBackdate = false, diasAtras = DIAS_REGISTRO_POR_DEFECTO, initial, returnTo = '/mis-registros' }: {
  projects: string[]; finishedProjects: string[]; pausedProjects: string[]; exceededProjects: string[]; areas: AreaRow[]; etapas: EtapaRow[]; clientEtapas: EtapaRow[]; descripciones: string[]; departamentos: DepartamentoRow[]; internalAreaId: string
  // Descripciones específicas de la posición del dueño (0044). Se muestran en su propio
  // grupo del desplegable de "Departamento"; sin ellas, el campo se ve como siempre.
  descripcionesPosicion?: string[]
  // La posición del dueño puede escribir la descripción a mano en "Departamento" (0044).
  // Añade a la lista, no la sustituye: aparece como una opción más del desplegable.
  descripcionLibre?: boolean
  canBackdate?: boolean // admin: puede registrar sin límite de fecha hacia atrás
  // Días hacia atrás que puede registrar este usuario: 7, o los que el admin le haya
  // concedido (profiles.registro_dias_atras, migración 0043). Solo pista de UI: el
  // piso que manda lo calcula guardar_registro con el mismo criterio.
  diasAtras?: number
  initial?: { id: string; lines: LineInput[] }
  returnTo?: string // a dónde volver al guardar (default: mis registros; /equipo al editar ajeno)
}) {
  const router = useRouter()
  const minDate = daysAgo(diasAtras)
  // Generales y específicas de la posición, ya separadas y ordenadas para el desplegable.
  // `permitidas` es la unión: lo que el motor aceptará en "Departamento".
  const grupos = agruparDescripciones(descripciones, descripcionesPosicion)
  const permitidas = [...grupos.generales, ...grupos.posicion]
  const finishedSet = new Set(finishedProjects)
  const pausedSet = new Set(pausedProjects)
  const exceededSet = new Set(exceededProjects)
  // Confirmación al elegir un proyecto finalizado, pausado y/o con el banco excedido.
  const [projectWarning, setProjectWarning] = useState<{ index: number; project: string; finished: boolean; paused: boolean; exceeded: boolean } | null>(null)
  // Fecha por defecto: la heredan las líneas nuevas y las que aún la seguían.
  const [defaultDate, setDefaultDate] = useState(initial?.lines[0]?.entry_date ?? today())
  // Departamento inicial al entrar al proyecto "Departamento" (única pantalla donde se elige).
  const defaultDep = departamentos[0]?.name ?? CLIENTES_DEP
  const [lines, setLines] = useState<LineInput[]>(initial?.lines ?? [emptyLine(areas[0]?.id ?? '', today())])
  // Lo tecleado en las casillas H y M de cada línea. Es estado de UI: NO viaja al
  // servidor. `hours` (decimal) sigue siendo la única fuente de verdad y lo único que
  // se guarda; estas casillas solo son la forma de escribirlo. El array va en paralelo
  // a `lines` (mismo índice) y se mantiene en los dos únicos sitios que cambian su
  // longitud: quitar línea y añadir línea.
  const [tiempos, setTiempos] = useState<TiempoBorrador[]>(() =>
    (initial?.lines ?? [null]).map((l) => {
      if (!l?.hours) return { h: '', m: '' }
      const { h, m } = horasAHM(l.hours)
      return { h: String(h), m: String(m).padStart(2, '0') }
    }),
  )
  // Qué líneas están escribiendo la descripción a mano en "Departamento" (0044). Es
  // estado de UI, como `tiempos`: va en paralelo a `lines` y se mantiene en los mismos
  // dos sitios. Al editar un registro, una descripción que ya no está en el catálogo
  // solo pudo escribirse a mano, así que la línea entra en ese modo.
  const [descLibres, setDescLibres] = useState<boolean[]>(() =>
    (initial?.lines ?? [null]).map((l) => !!l?.description && !permitidas.includes(l.description)),
  )
  const [saving, setSaving] = useState(false)

  const total = lines.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  // Subtotales por fecha (se muestran solo cuando hay más de una fecha).
  const byDate = lines.reduce<Record<string, number>>((acc, l) => {
    acc[l.entry_date] = (acc[l.entry_date] ?? 0) + (Number(l.hours) || 0); return acc
  }, {})
  const dates = Object.keys(byDate).sort()
  const isDepartamento = (p: string) => p === 'Departamento'
  // La columna Departamento solo aplica al proyecto interno "Departamento":
  // se muestra únicamente si alguna línea lo usa.
  const showDepartamento = lines.some((l) => isDepartamento(l.project))
  // La columna Etapa solo aplica a proyectos cliente (en Departamento la etapa
  // viene predefinida por el departamento): se oculta si todas las líneas son Departamento.
  const showEtapa = lines.some((l) => !isDepartamento(l.project))

  function update(i: number, patch: Partial<LineInput>) {
    setLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const next = { ...l, ...patch }
      
      let checkEtapaForDep = false

      if (patch.project !== undefined) {
        if (isDepartamento(patch.project)) { 
          next.area_id = internalAreaId
          if (!departamentos.some(d => d.name === next.department)) {
            next.department = defaultDep
          }
          checkEtapaForDep = true
        } else {
          next.department = CLIENTES_DEP
          if (next.area_id === internalAreaId) next.area_id = areas[0]?.id ?? ''
          // Al salir de "Departamento", limpiar la etapa si no es válida para proyecto
          // cliente (las etapas de departamento no aplican en proyectos generales).
          if (next.etapa_id && !clientEtapas.some((e) => e.id === next.etapa_id)) next.etapa_id = ''
        }
      }

      if (patch.department !== undefined && isDepartamento(next.project)) {
        checkEtapaForDep = true
      }

      if (checkEtapaForDep) {
        const dep = departamentos.find((d) => d.name === next.department)
        if (dep && dep.etapaIds.length === 1) {
          next.etapa_id = dep.etapaIds[0]
        } else if (dep && !dep.etapaIds.includes(next.etapa_id)) {
          next.etapa_id = '' // clear if current etapa is not allowed in this new department
        }
      }

      // Descripción: en "Departamento" debe estar en la lista general; al entrar a
      // "Departamento", si la actual (texto libre) no está en la lista, se limpia. Fuera
      // de "Departamento" es texto libre.
      if (patch.project !== undefined && isDepartamento(next.project)) {
        if (next.description && !descripcionValidaEnDepartamento(next.description, permitidas, descripcionLibre)) next.description = ''
      }

      return next
    }))
  }

  // Cambiar la fecha por defecto arrastra a las líneas que aún la seguían;
  // las que el usuario cambió a mano conservan su fecha.
  function changeDefaultDate(newDate: string) {
    setLines((prev) => prev.map((l) => (l.entry_date === defaultDate ? { ...l, entry_date: newDate } : l)))
    setDefaultDate(newDate)
  }

  async function onSave() {
    // Guard: no dejamos que un uuid vacío (área/etapa sin asignar) llegue al motor y
    // devuelva el error críptico de Postgres; mostramos un mensaje claro.
    const err = primerErrorLinea(lines)
    if (err) { toast.error(err); return }
    setSaving(true)
    const res = await guardarRegistro(lines, initial?.id ?? null)
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(initial ? 'Registro actualizado' : 'Registro guardado')
    router.push(returnTo)
  }

  // Controles de una línea, reutilizados por la tabla (escritorio) y las tarjetas (móvil).
  function lineControls(l: LineInput, i: number) {
    const isDep = isDepartamento(l.project)
    const lineClientEtapas = l.etapa_id && !clientEtapas.some((e) => e.id === l.etapa_id)
      ? [...clientEtapas, ...etapas.filter((e) => e.id === l.etapa_id)]
      : clientEtapas
    // Descripción: en "Departamento" es la lista general (compartida); en el resto, texto libre.
    const deptDescripciones = isDep ? permitidas : []

    const fecha = (
      <Input aria-label="Fecha" type="date" value={l.entry_date} max={today()} min={canBackdate ? undefined : minDate}
        onChange={(e) => update(i, { entry_date: e.target.value })} />
    )
    const proyecto = (
      <ProjectCombobox ariaLabel="Proyecto" value={l.project} projects={projects}
        finishedProjects={finishedSet} pausedProjects={pausedSet} exceededProjects={exceededSet}
        onValueChange={(v) => {
          const finished = !!v && finishedSet.has(v)
          const paused = !!v && pausedSet.has(v)
          const exceeded = !!v && exceededSet.has(v)
          if (finished || paused || exceeded) { setProjectWarning({ index: i, project: v, finished, paused, exceeded }); return }
          update(i, { project: v })
        }} />
    )
    const depto = departamentos.length === 0 ? (
      <NativeSelect aria-label="Departamento" value="" disabled fullWidth><option value="">— Sin departamentos (contacta al admin) —</option></NativeSelect>
    ) : (
      <DepartamentoSelect ariaLabel="Departamento" value={l.department} departamentos={departamentos}
        onValueChange={(v) => update(i, { department: v })} />
    )
    const etapa = lineClientEtapas.length === 0 ? (
      <NativeSelect aria-label="Etapa" value="" disabled fullWidth><option value="">— Sin etapas asignadas (contacta al admin) —</option></NativeSelect>
    ) : (
      <NativeSelect aria-label="Etapa" value={l.etapa_id} onChange={(e) => update(i, { etapa_id: e.target.value })} fullWidth>
        <option value="">— Etapa —</option>
        {lineClientEtapas.map((et) => <option key={et.id} value={et.id}>{et.name}</option>)}
      </NativeSelect>
    )
    const t = tiempos[i] ?? { h: '', m: '' }
    // Cada tecleo reescribe el borrador Y recalcula las horas decimales, que es lo
    // único que se guarda. Un campo vacío cuenta como 0: escribir solo minutos es el
    // caso corriente (0:15) y no debe obligar a teclear el cero de las horas.
    const setTiempo = (patch: Partial<TiempoBorrador>) => {
      // Dos cifras por casilla, las que caben y las que tiene un reloj: la tercera
      // tecla no entra. Antes un "300" por dedazo se aceptaba y quedaba a medio ver
      // dentro de la casilla. Se valida solo lo que se acaba de teclear, no el estado
      // entero, para que un valor guardado fuera de rango no bloquee la otra casilla.
      if (patch.h !== undefined && !DOS_CIFRAS.test(patch.h)) return
      if (patch.m !== undefined && !DOS_CIFRAS.test(patch.m)) return
      const next = { ...t, ...patch }
      setTiempos((p) => p.map((prev, idx) => (idx === i ? next : prev)))
      update(i, { hours: hmAHoras(Number(next.h) || 0, Number(next.m) || 0) })
    }
    // Al salir de los minutos, un dígito suelto se completa a dos: se escribe "5" y se
    // lee "0:05h", que es el formato que el campo promete. No toca las horas guardadas
    // (el cero a la izquierda no cambia el número).
    const padMinutos = () => { if (t.m.length === 1) setTiempo({ m: t.m.padStart(2, '0') }) }
    // La unidad sigue al dato: "0:10h" se lee como una décima de hora, así que cuando
    // no hay horas la casilla dice "min". El campo en 0:00 (vacío o a cero) se queda en
    // "h": ahí la unidad no describe nada, enseña el formato que hay que escribir.
    const soloMinutos = (Number(t.h) || 0) === 0 && (Number(t.m) || 0) > 0
    const horas = (
      // Las dos casillas, los dos puntos y la "h" comparten borde y anillo de foco: el
      // campo entero se lee como un reloj, no como dos números sueltos. El ancho es el
      // del contenido ("0:00h") porque el tiempo es un dato corto, no una frase.
      // El padding horizontal va aquí y no en las casillas: con box-border, un pl-2.5
      // dentro de un w-[2ch] se comería la cifra.
      <div className="inline-flex w-fit items-center rounded-lg border border-border bg-background px-2.5 focus-within:border-transparent focus-within:ring-2 focus-within:ring-ring">
        <input
          aria-label="Horas"
          type="number" inputMode="numeric" min="0" step="1" placeholder="0"
          value={t.h}
          onChange={(e) => setTiempo({ h: e.target.value })}
          className={`${casillaTiempo} w-[2ch] text-right`}
        />
        <span aria-hidden className="px-0.5 text-sm text-muted-foreground">:</span>
        <input
          aria-label="Minutos"
          // Tope en 59: es la semántica de la casilla. Un 75 se puede teclear y queda
          // marcado, pero ya no puede convertirse en horas sin que nadie lo note.
          type="number" inputMode="numeric" min="0" max="59" step="1" placeholder="00"
          value={t.m}
          onChange={(e) => setTiempo({ m: e.target.value })}
          onBlur={padMinutos}
          className={`${casillaTiempo} w-[2ch]`}
        />
        {/* La unidad, no un dato: en el gris de las etiquetas y fuera del árbol de accesibilidad
            (las casillas ya se anuncian "Horas" y "Minutos"). */}
        <span aria-hidden className="text-sm text-muted-foreground">{soloMinutos ? 'min' : 'h'}</span>
      </div>
    )
    // En "Departamento": desplegable del catálogo. Las específicas de la posición van en
    // su propio grupo, y solo se separan si las hay: con una sola lista, un encabezado
    // "Generales" no distinguiría nada de nada. En el resto de proyectos: texto libre
    // (obligatorio; el motor exige no vacía).
    const opciones = (nombres: string[]) => nombres.map((name) => <option key={name} value={name}>{name}</option>)
    // Una línea escribiendo a mano enseña la casilla de texto, con un botón para volver
    // a la lista. El resto del tiempo el campo es el desplegable de siempre: la libertad
    // es una opción MÁS del desplegable, no otro tipo de campo.
    // El modo también se deduce del propio texto: una descripción que no está en el
    // catálogo solo pudo escribirse a mano. Así, ir a un proyecto cliente y volver a
    // "Departamento" no deja el desplegable en blanco con un texto que no puede mostrar.
    const enModoLibre = descripcionLibre && (descLibres[i] || (!!l.description && !permitidas.includes(l.description)))
    const desc = isDep ? (
      enModoLibre ? (
        <div className="flex items-center gap-1">
          <input aria-label="Descripción" type="text" value={l.description} autoFocus
            onChange={(e) => update(i, { description: e.target.value })} placeholder="Escribe la descripción…" className={field} />
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Elegir de la lista"
            className="shrink-0 text-foreground/55 hover:text-foreground"
            onClick={() => { setDescLibres((p) => p.map((v, idx) => (idx === i ? false : v))); update(i, { description: '' }) }}>
            <List />
          </Button>
        </div>
      ) : deptDescripciones.length === 0 && !descripcionLibre ? (
        <NativeSelect aria-label="Descripción" value="" disabled fullWidth><option value="">— Sin descripciones (contacta al admin) —</option></NativeSelect>
      ) : (
        <NativeSelect
          aria-label="Descripción" value={l.description} fullWidth
          onChange={(e) => {
            if (e.target.value === OTRA) { setDescLibres((p) => p.map((v, idx) => (idx === i ? true : v))); update(i, { description: '' }) }
            else update(i, { description: e.target.value })
          }}
        >
          <option value="">— Descripción —</option>
          {grupos.posicion.length === 0 ? (
            opciones(grupos.generales)
          ) : (
            <>
              {grupos.generales.length > 0 && <optgroup label="Generales">{opciones(grupos.generales)}</optgroup>}
              <optgroup label="De tu posición">{opciones(grupos.posicion)}</optgroup>
            </>
          )}
          {/* La libertad de la posición (0044) entra como una opción más, al final y en
              el carmín de la marca: es la única del desplegable que no elige un texto
              sino que abre uno. El color en <option> lo respetan Chrome y Firefox; donde
              no, la propia frase ya la distingue. */}
          {descripcionLibre && (
            <option value={OTRA} style={{ color: 'var(--brand-strong)', fontWeight: 500 }}>
              ✎ Otra — escribir a mano
            </option>
          )}
        </NativeSelect>
      )
    ) : (
      <input aria-label="Descripción" type="text" value={l.description}
        onChange={(e) => update(i, { description: e.target.value })} placeholder="Descripción…" className={field} />
    )
    const emptyPlaceholder = <span className="flex h-9 items-center px-2.5 text-sm text-muted-foreground/40">—</span>
    return { isDep, fecha, proyecto, depto, etapa, horas, desc, emptyPlaceholder }
  }

  const removeBtn = (i: number) => (
    <Button type="button" variant="ghost" size="icon-sm" onClick={() => { setLines((p) => p.filter((_, idx) => idx !== i)); setTiempos((p) => p.filter((_, idx) => idx !== i)); setDescLibres((p) => p.filter((_, idx) => idx !== i)) }}
      disabled={lines.length === 1} aria-label="Eliminar línea" className="text-foreground/40 hover:text-(--status-excedido)">✕</Button>
  )

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="fecha" className="text-sm font-medium text-foreground">Fecha por defecto</label>
        <Input
          id="fecha" type="date" value={defaultDate} max={today()} min={canBackdate ? undefined : minDate}
          onChange={(e) => changeDefaultDate(e.target.value)} className="w-auto"
        />
        {!canBackdate && <span className="text-xs text-muted-foreground">Hasta {diasAtras} días atrás</span>}
      </div>

      {/* Escritorio: tabla */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="pb-1 pr-3 font-medium">Fecha</th>
              <th className="pb-1 pr-3 font-medium">Proyecto</th>
              {showDepartamento && <th className="pb-1 pr-3 font-medium">Departamento</th>}
              {showEtapa && <th className="pb-1 pr-3 font-medium">Etapa</th>}
              <th className="pb-1 pr-3 font-medium"><EtiquetaTiempo /></th>
              <th className="pb-1 pr-3 font-medium">Descripción</th>
              <th className="w-8 pb-1"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const c = lineControls(l, i)
              return (
                <tr key={i}>
                  <td className="min-w-37 pr-3 align-top">{c.fecha}</td>
                  <td className="min-w-45 pr-3 align-top">{c.proyecto}</td>
                  {showDepartamento && <td className="min-w-32.5 pr-3 align-top">{c.isDep ? c.depto : c.emptyPlaceholder}</td>}
                  {showEtapa && <td className="min-w-35 pr-3 align-top">{c.isDep ? c.emptyPlaceholder : c.etapa}</td>}
                  <td className="w-24 pr-3 align-top">{c.horas}</td>
                  <td className="min-w-50 pr-3 align-top">{c.desc}</td>
                  <td className="align-middle">{removeBtn(i)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Móvil: una tarjeta por línea */}
      <div className="space-y-3 md:hidden">
        {lines.map((l, i) => {
          const c = lineControls(l, i)
          return (
            <div key={i} className="rounded-xl border border-border bg-(--muted-surface) p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Línea {i + 1}</span>
                {removeBtn(i)}
              </div>
              <div className="space-y-3">
                <MobileField label="Fecha">{c.fecha}</MobileField>
                <MobileField label="Proyecto">{c.proyecto}</MobileField>
                {c.isDep ? <MobileField label="Departamento">{c.depto}</MobileField> : <MobileField label="Etapa">{c.etapa}</MobileField>}
                <MobileField label={<EtiquetaTiempo />}>{c.horas}</MobileField>
                <MobileField label="Descripción">{c.desc}</MobileField>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex items-start justify-between border-t border-border pt-4">
        <Button type="button" variant="link" size="sm" className="px-0" onClick={() => { setLines((p) => [...p, emptyLine(areas[0]?.id ?? '', defaultDate)]); setTiempos((p) => [...p, { h: '', m: '' }]); setDescLibres((p) => [...p, false]) }}>
          + Añadir línea
        </Button>
        <div className="text-right">
          <span className="text-sm text-muted-foreground">
            Total: <strong className="tabular-money ml-1 text-base text-foreground">{formatHoras(total)}</strong>
          </span>
          {dates.length > 1 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {dates.map((d) => `${d}: ${formatHoras(byDate[d])}`).join(' · ')}
            </div>
          )}
        </div>
      </div>

      <Button type="button" onClick={onSave} disabled={saving} size="lg" className="mt-6">
        {saving ? 'Guardando…' : 'Guardar registro'}
      </Button>

      <Dialog open={projectWarning !== null} onOpenChange={(open) => { if (!open) setProjectWarning(null) }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-(--status-bajo)" />
              {projectWarning?.finished && projectWarning?.exceeded
                ? 'Proyecto finalizado y excedido'
                : projectWarning?.paused && projectWarning?.exceeded
                ? 'Proyecto pausado y excedido'
                : projectWarning?.exceeded
                ? 'Banco de horas excedido'
                : projectWarning?.finished
                ? 'Proyecto finalizado'
                : 'Proyecto pausado'}
            </DialogTitle>
            <DialogDescription>
              El proyecto <strong className="font-medium text-foreground">{projectWarning?.project}</strong>{' '}
              {projectWarning?.finished && projectWarning?.exceeded
                ? 'está marcado como finalizado y el banco de horas de tu posición está excedido.'
                : projectWarning?.paused && projectWarning?.exceeded
                ? 'está pausado y el banco de horas de tu posición está excedido.'
                : projectWarning?.exceeded
                ? 'tiene el banco de horas de tu posición excedido.'
                : projectWarning?.finished
                ? 'está marcado como finalizado en el Excel.'
                : 'está pausado en el Excel.'}{' '}
              ¿Deseas registrar horas de todas formas?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectWarning(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (projectWarning) update(projectWarning.index, { project: projectWarning.project })
                setProjectWarning(null)
              }}
            >
              Registrar de todas formas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

# Espera de 5 minutos para los avisos de registro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los avisos que dispara un guardado de /registrar salgan 5 minutos después del último cambio, armados con cómo quedaron los registros.

**Architecture:** Al guardar, la app anota una espera en `avisos_por_revisar` (una edición de un registro que espera se suma y la reinicia). Una tarea `pg_cron` por minuto llama con `pg_net` a `POST /api/avisos/revisar` solo si hay trabajo vencido; la ruta reserva las esperas, arma los avisos con el estado actual (lógica pura en `reglas.ts`) y despacha la bandeja.

**Tech Stack:** Next.js 16 (route handlers, `after`), supabase-js con service role, Postgres 17 en Supabase (`pg_cron`, `pg_net`, Vault), Playwright en modo node para las pruebas puras.

**Spec:** `docs/superpowers/specs/2026-10-14-avisos-espera-registro-design.md`

## Global Constraints

- Espera: `ESPERA_REGISTRO_MINUTOS = 5`; cada edición que se suma la reinicia (`vence_at = now() + 5 min`).
- Reintentos de una espera: `MAX_INTENTOS_REVISION = 3`; después, `fallida`.
- Rescate de reservadas: 10 minutos (igual que `avisos_reclamar`).
- URL de la tarea: `https://control-horas-theta.vercel.app/api/avisos/revisar`; secreto en Vault `avisos_cron_secret` (= `CRON_SECRET`).
- Payload de los avisos sin cambios (no se quita ni renombra nada del contrato).
- Solo producción (`esProduccion()`) anota y procesa esperas.
- Pruebas: solo puras (`npx playwright test -c pw-node-only.config.ts e2e/avisos-espera.spec.ts`); las que siembran escriben en producción.
- Gate de compilación: `npx tsc --noEmit` y `npm run build` (lint roto repo-wide).

## Review Focus

- Una espera que se reprocesa tras emitir (la función se cortó antes de cerrarla) no debe duplicar pulsos → clave `pulso:<espera>:<dia>` en `registro.enviado` (Task 3).
- Fallo de lectura a mitad de `revisarGuardado` no debe dejar avisos a medias → todas las lecturas antes de la primera emisión (Task 3).
- Edición que llega mientras la espera está `procesando` → no se suma; crea su propia espera (`avisos_esperar_guardado` solo toca `pendiente`) (Task 2, ensayo).
- Todos los registros de la espera anulados → no sale nada (Task 1, prueba).
- Secreto ausente en Vault → la tarea llama con `Bearer ` vacío, la ruta responde 401, nada se procesa (Task 2, comprobación).

---

### Task 1: Lógica pura de la espera

**Files:**
- Modify: `lib/avisos/reglas.ts` (añadir sección «Espera de los avisos de un registro»)
- Create: `e2e/avisos-espera.spec.ts`

**Interfaces — Produces:**
- `ESPERA_REGISTRO_MINUTOS: 5`, `MAX_INTENTOS_REVISION: 3`
- `interface LineaGuardada { entry_date: string; project: string; hours: number }` (se mueve aquí desde `detector-registro.ts`)
- `interface RegistroActual { id: string; entry_date: string; status: string; lineas: { project: string; hours: number }[] }`
- `armarGuardado(registros: RegistroActual[]): { lineas: LineaGuardada[]; logPorDia: Map<string, string> }`
- `interface PulsoPlan { dia: string; horasRegistro: number; horasDia: number; proyectos: { proyecto: string; horas: number }[] }`
- `interface LlamativoPlan { dia: string; motivo: MotivoLlamativo; horasDia: number }`
- `planAvisosRegistro(args: { esAlta: boolean; lineas: LineaGuardada[]; totales: Map<string, DiaResumido> }): { pulsos: PulsoPlan[]; llamativos: LlamativoPlan[] }`
- `estadoTrasFallo(intentos: number): 'pendiente' | 'fallida'`

- [ ] **Step 1: Pruebas** — `e2e/avisos-espera.spec.ts` con: caso Estefania (dos registros que acaban el 08/10 → 4 líneas el 08/10, enlaza el de 7 h; plan con un pulso de 8 h y sin llamativo con total 8); anulado excluido y todo anulado → vacío; empate de horas → id menor; día con 15,5 h → `dia_largo` y con 8,5 h → nada; `esAlta: false` → sin pulsos y con llamativos; pulsos ordenados por fecha; `estadoTrasFallo(1|2) = 'pendiente'`, `estadoTrasFallo(3) = 'fallida'`.
- [ ] **Step 2:** Correrlas y ver que fallan (no existen las funciones).
- [ ] **Step 3:** Implementar en `reglas.ts` (código abajo).
- [ ] **Step 4:** Correrlas: pasan. Correr también `e2e/avisos-reglas.spec.ts` (no se rompió nada).
- [ ] **Step 5:** Commit `feat(avisos): lógica pura de la espera de los avisos de registro`.

```ts
// --- Espera de los avisos de un registro (0061) -------------------------------

export const ESPERA_REGISTRO_MINUTOS = 5
export const MAX_INTENTOS_REVISION = 3

export interface LineaGuardada { entry_date: string; project: string; hours: number }

export interface RegistroActual {
  id: string
  entry_date: string
  status: string
  lineas: { project: string; hours: number }[]
}

export function armarGuardado(registros: RegistroActual[]): { lineas: LineaGuardada[]; logPorDia: Map<string, string> } {
  const vivos = registros.filter((r) => r.status !== 'anulado').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lineas: LineaGuardada[] = []
  const mejor = new Map<string, { id: string; horas: number }>()
  for (const r of vivos) {
    let horas = 0
    for (const l of r.lineas) {
      lineas.push({ entry_date: r.entry_date, project: l.project, hours: Number(l.hours) })
      horas = centesimas(horas + Number(l.hours))
    }
    const previo = mejor.get(r.entry_date)
    if (!previo || horas > previo.horas) mejor.set(r.entry_date, { id: r.id, horas })
  }
  return { lineas, logPorDia: new Map([...mejor].map(([dia, m]) => [dia, m.id])) }
}

export function planAvisosRegistro(args: { esAlta: boolean; lineas: LineaGuardada[]; totales: Map<string, DiaResumido> }) {
  const deEste = resumirPorDia(args.lineas.map((l) => ({ dia: l.entry_date, proyecto: l.project.trim(), horas: Number(l.hours) })))
  const pulsos: PulsoPlan[] = []
  const llamativos: LlamativoPlan[] = []
  for (const dia of [...deEste.keys()].sort()) {
    const total = args.totales.get(dia) ?? { total: 0, porProyecto: new Map<string, number>() }
    const este = deEste.get(dia)!
    if (args.esAlta) pulsos.push({ dia, horasRegistro: este.total, horasDia: total.total, proyectos: [...este.porProyecto].map(([proyecto, horas]) => ({ proyecto, horas })) })
    for (const motivo of motivosLlamativo(total)) llamativos.push({ dia, motivo, horasDia: total.total })
  }
  return { pulsos, llamativos }
}

export function estadoTrasFallo(intentos: number): 'pendiente' | 'fallida' {
  return intentos >= MAX_INTENTOS_REVISION ? 'fallida' : 'pendiente'
}
```

### Task 2: Migración 0061 (tabla, funciones, reloj) y ensayo en producción

**Files:**
- Create: `supabase/migrations/0061_avisos_espera_registro.sql`

**Interfaces — Produces:**
- Tabla `public.avisos_por_revisar(id, user_id, log_ids uuid[], es_alta, vence_at, estado, intentos, reclamado_at, ultimo_error, created_at)`.
- `public.avisos_esperar_guardado(p_user_id uuid, p_log_ids uuid[], p_ancla uuid, p_es_alta boolean, p_espera interval) returns uuid`
- `public.avisos_reclamar_revisiones(p_limite integer default 20) returns setof public.avisos_por_revisar`
- Tareas pg_cron `avisos-revisar` (cada minuto) y `avisos-limpiar-historial-cron` (diaria, borra `cron.job_run_details` de más de 7 días: con una tarea por minuto crece ~1.440 filas al día y no se limpia sola).

- [ ] **Step 1:** Escribir la migración (extensiones `pg_cron` en `pg_catalog` y `pg_net` en `extensions` según la doc de Supabase; tabla con RLS y lectura admin como `avisos_salientes`; funciones con `revoke`/`grant` como `avisos_reclamar`; las dos tareas).
- [ ] **Step 2:** Aplicarla por MCP (`apply_migration`, nombre `0061_avisos_espera_registro`).
- [ ] **Step 3:** Ensayo dentro de un `do $$ ... raise exception $$` (no deja rastro): alta → espera nueva; edición del ancla → se suma, sin repetidos, `vence_at` reiniciado; espera puesta en `procesando` → la edición crea otra; `avisos_reclamar_revisiones` solo toma vencidas y suma intento.
- [ ] **Step 4:** `get_advisors` (security) sin avisos nuevos de la tabla/funciones; `cron.job` muestra las dos tareas.
- [ ] **Step 5:** Commit `feat(db): 0061 espera de los avisos de registro y reloj por minuto`.

### Task 3: Detector: anotar la espera al guardar y armar al vencer

**Files:**
- Modify: `lib/avisos/detector-registro.ts` (todo el archivo)
- Modify: `app/(horas)/registrar/actions.ts:25-26`

**Interfaces:**
- Consumes: Task 1 (`armarGuardado`, `planAvisosRegistro`, `ESPERA_REGISTRO_MINUTOS`, `RegistroActual`), Task 2 (`avisos_esperar_guardado`).
- Produces: `alGuardarRegistro(args: { logId: string; anclaId: string | null }): Promise<void>` (nunca lanza); `interface EsperaGuardado { id: string; log_ids: string[]; es_alta: boolean }`; `revisarGuardado(espera: EsperaGuardado): Promise<void>` (lanza solo antes de emitir).

- [ ] **Step 1:** `alGuardarRegistro`: lee `user_id, updated_at` del id devuelto, busca los registros del guardado por `updated_at`, llama a `avisos_esperar_guardado` con `p_espera: '5 minutes'`.
- [ ] **Step 2:** `revisarGuardado`: lee los registros actuales con sus líneas, `armarGuardado`, perfiles, totales del día (todas las lecturas antes de emitir); emite según `planAvisosRegistro`, con clave `pulso:<espera.id>:<dia>` en `registro.enviado` y `claveLlamativo` en los llamativos; luego `evaluarBancos` con origen.
- [ ] **Step 3:** `actions.ts`: `trasResponder(() => alGuardarRegistro({ logId: id, anclaId: logId }))`.
- [ ] **Step 4:** `npx tsc --noEmit` limpio.
- [ ] **Step 5:** Commit `feat(avisos): los avisos de un registro se arman al vencer la espera`.

### Task 4: Procesar las esperas: `revisarPendientes`, ruta del reloj y red del cron diario

**Files:**
- Create: `lib/avisos/revisiones.ts`
- Create: `app/api/avisos/revisar/route.ts`
- Modify: `app/api/avisos/cron/route.ts`

**Interfaces:**
- Consumes: Task 3 (`revisarGuardado`, `EsperaGuardado`), Task 1 (`estadoTrasFallo`, `MAX_INTENTOS_REVISION`), Task 2 (`avisos_reclamar_revisiones`).
- Produces: `revisarPendientes(limite?: number, plazoMs?: number): Promise<{ hechas: number; fallidas: number }>`; `POST /api/avisos/revisar` (401 sin clave; 202 y trabajo en `after()`).

- [ ] **Step 1:** `revisarPendientes`: reserva, procesa una a una con plazo (lo que no cabe vuelve a `pendiente` descontando el intento), `hecha` / `estadoTrasFallo` / `fallida` si viene rescatada con más de 3 intentos.
- [ ] **Step 2:** Ruta `POST /api/avisos/revisar`: `autorizado(req, CRON_SECRET)`, `esProduccion()`, `after(revisarPendientes(20, 25s) + despacharPendientes(50, 25s))`, responde 202.
- [ ] **Step 3:** Cron diario: `revisarPendientes(100, 10s)` antes del despacho; despacho a 35 s para seguir por debajo de `maxDuration = 60`.
- [ ] **Step 4:** `npx tsc --noEmit` y `npm run build` limpios.
- [ ] **Step 5:** Commit `feat(avisos): ruta del reloj por minuto y red en el cron diario`.

### Task 5: Contrato y cierre

**Files:**
- Modify: `docs/avisos/contrato-avisos-v1.md` (entrada en «Cambios de versión»)

- [ ] **Step 1:** Añadir la entrada del 14/10/2026 (texto del spec, sección «Para Julián»).
- [ ] **Step 2:** Pruebas puras + `tsc` + build de nuevo.
- [ ] **Step 3:** Commit `docs(avisos): los avisos de registro llegan 5 minutos después`.
- [ ] **Step 4:** Revisión final de toda la rama (un revisor nuevo).
- [ ] **Step 5:** Puesta en marcha con Roberto: secreto en Vault → push `master:main` → comprobación con guardados reales.

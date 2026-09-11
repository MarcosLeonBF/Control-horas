# Avisos automáticos para Zapier / n8n — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La plataforma detecta y emite avisos firmados (registro, bancos, HUCHA) a un único webhook de los flujos de Julián y expone dos consultas autenticadas (resumen de capacidad y días sin registrar), con bandeja de salida, reintentos, revisión diaria y pantalla de administración.

**Architecture:** Server actions y un cron diario llaman a detectores (`lib/avisos/detector-*.ts`) que comparan el estado actual con `avisos_estado` y encolan avisos en `avisos_salientes`; un despachador los envía firmados después de responder (`after()`), con reintentos. La lógica pura (reglas, calendario, capacidad, firma) vive aparte y se prueba con el proyecto `node-avisos` de Playwright.

**Tech Stack:** Next.js 16 (App Router, server actions, `after` de `next/server`), Supabase (Postgres + supabase-js con service role), Playwright como runner de tests de node, Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-09-10-avisos-webhooks-design.md` · **Contrato (campos exactos):** `docs/avisos/contrato-avisos-v1.md`

## Global Constraints

- Estilo del repo: TypeScript sin punto y coma, comillas simples, 2 espacios, comentarios en español explicando el porqué.
- Gate de cada tarea: `npx tsc --noEmit` y, en las tareas que tocan `app/` o `components/`, `npm run build`. **`npm run lint` está roto en todo el repo: no cuenta.**
- **Nunca correr la suite E2E completa ni `npx playwright test` con la config normal:** su `globalSetup` siembra usuarios en la ÚNICA base, que es la de producción. Los tests de node se corren con la config temporal `pw-node-only.config.ts` (se crea, se usa y se borra; nunca se commitea).
- **Nunca arrancar ni parar el dev server** (lo gestiona el usuario).
- Supabase: proyecto `msfylcgtlathccmxuheq` (producción). Las migraciones se aplican con la herramienta MCP `apply_migration` y se guardan también en `supabase/migrations/`.
- Solo producción envía avisos: `process.env.VERCEL_ENV === 'production'`. Fuera de producción los detectores, el despacho y el cron no hacen nada.
- Todo lo de avisos corre después de responder y **nunca lanza** hacia el usuario (try/catch con `console.error('[avisos] …')`).
- Commits en `master`, estilo `tipo(ámbito): descripción` en español y en minúscula, terminando con la línea `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Nunca `git add -A`: solo los archivos de la tarea (en el árbol hay cambios ajenos en `e2e/.auth/`, `e2e/.fixture.json`, `test-results/` y documentos sin seguimiento).
- Reglas por defecto (constantes en código): llamativo `dia_largo` si `horas_dia > 10`; `proyecto_largo` si horas a un proyecto ≠ Departamento `>= 6`; niveles `disponible < bajo < consumido < excedido`; reintentos a 5 min, 30 min, 2 h y 12 h, máximo 5 intentos; timeout de envío 5 s; tope de días sin registrar 30 laborables.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/0045_avisos.sql` | Tablas `avisos_config`, `avisos_salientes`, `avisos_estado`, `festivos`; `profiles.manager_id`; función `avisos_reclamar` |
| `lib/avisos/reglas.ts` | Puro: resumen por día, llamativo, niveles y transición, reintentos, textos |
| `lib/avisos/calendario.ts` | Puro: días sin registrar, último registro, plazo |
| `lib/avisos/capacidad.ts` | Puro: niveles de banco por posición y proyecto, porcentaje, ranking |
| `lib/avisos/firma.ts` | Puro: firma HMAC y cuerpo + cabeceras de un envío |
| `lib/avisos/contrato.ts` | Tipos del contrato v1, lista de tipos, descripciones y ejemplos |
| `lib/avisos/entorno.ts` | `esProduccion`, `appUrl`, enlaces, personas de prueba |
| `lib/avisos/bandeja.ts` | `emitirAviso`, `despacharPendientes`, `enviarPrueba` (IO) |
| `lib/avisos/tras-responder.ts` | `trasResponder()`: `after()` + despacho, sin lanzar |
| `lib/avisos/estado.ts` | Leer y guardar `avisos_estado` |
| `lib/avisos/personas.ts` | Perfiles, manager directo, manager del Excel por nombre |
| `lib/avisos/detector-bancos.ts` | `nivelesActuales`, `evaluarBancos` |
| `lib/avisos/detector-registro.ts` | `alGuardarRegistro` |
| `lib/avisos/detector-hucha.ts` | `evaluarHucha`, `alAmpliarHucha`, `alSincronizarHucha` |
| `lib/avisos/auth.ts` | `autorizado(req, secreto)` en tiempo constante |
| `lib/avisos/consultas.ts` | `resumenCapacidad`, `diasSinRegistrarDe` |
| `app/api/avisos/v1/resumen-capacidad/route.ts`, `app/api/avisos/v1/dias-sin-registrar/route.ts`, `app/api/avisos/cron/route.ts`, `vercel.json` | Consultas y cron |
| `app/(horas)/admin/avisos/page.tsx`, `app/(horas)/admin/avisos/actions.ts`, `components/horas/AvisosPanel.tsx` | Pantalla Administración → Avisos |
| `e2e/avisos-reglas.spec.ts`, `e2e/avisos-auth.spec.ts` | Tests de node |

Se modifican: `app/(horas)/registrar/actions.ts`, `app/(horas)/bancos/[project]/actions.ts`, `app/(hucha)/presupuestos/[id]/actions.ts`, `app/(hucha)/presupuestos/sincronizar/actions.ts`, `lib/hucha/sync.ts`, `app/(horas)/admin/usuarios/actions.ts`, `app/(horas)/admin/usuarios/page.tsx`, `components/horas/UsuariosPanel.tsx`, `components/AppShell.tsx`, `app/(horas)/mis-registros/page.tsx`, `playwright.config.ts`. Se borran: `lib/horas/alertas.ts`, `lib/horas/alertas-core.ts`, `e2e/horas-alertas.spec.ts`.

---

### Task 1: Migración 0045 (tablas de avisos y manager directo)

**Files:**
- Create: `supabase/migrations/0045_avisos.sql`

**Interfaces:**
- Produces: tablas `avisos_config` (fila única `id = true`: `url text`, `tipos_activos text[]`), `avisos_salientes`, `avisos_estado (clave, nivel)`, `festivos (fecha, nombre)`; columna `profiles.manager_id`; función `avisos_reclamar(p_limite integer) returns setof avisos_salientes` (solo service role).

- [ ] **Step 1: Escribir la migración**

```sql
-- 0045_avisos.sql
-- Avisos automáticos para los flujos de Zapier/n8n (spec 2026-09-10-avisos-webhooks-design).
-- La plataforma emite avisos firmados a un único webhook y guarda cada envío con sus
-- reintentos. Sustituye a horas_alertas (Fase 4, nunca activada), que queda sin uso.

-- Una sola fila: la URL del webhook de los flujos y qué tipos de aviso están activos.
create table public.avisos_config (
  id             boolean primary key default true check (id),
  url            text,
  tipos_activos  text[] not null default '{}',
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);
insert into public.avisos_config (id) values (true);

-- Bandeja de salida: cada aviso emitido, con su estado de entrega.
create table public.avisos_salientes (
  id               uuid primary key default gen_random_uuid(), -- = id del sobre
  tipo             text not null,
  datos            jsonb not null,
  clave            text unique,               -- deduplicación opcional (NULL no choca)
  prueba           boolean not null default false,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','enviando','enviado','fallido','descartado')),
  motivo_descarte  text,
  intentos         integer not null default 0,
  proximo_intento  timestamptz not null default now(),
  reclamado_at     timestamptz,
  ultimo_codigo    integer,
  ultimo_error     text,
  created_at       timestamptz not null default now(),
  enviado_at       timestamptz
);
create index avisos_salientes_cola on public.avisos_salientes (estado, proximo_intento);
create index avisos_salientes_recientes on public.avisos_salientes (created_at desc);

-- Último nivel conocido de cada banco y de cada HUCHA: sin él no se sabe si "empeoró".
create table public.avisos_estado (
  clave       text primary key,   -- 'banco:<proyecto>:<posicion>' | 'banco:<proyecto>:*' | 'hucha:<project_id>'
  nivel       text not null,
  updated_at  timestamptz not null default now()
);

-- Festivos para "días sin registrar". Se cargan por SQL hasta que haya calendario decidido.
create table public.festivos (
  fecha   date primary key,
  nombre  text not null
);

-- Manager directo de cada persona (la escalera de recordatorios avisa a esta persona).
alter table public.profiles
  add column manager_id uuid references public.profiles(id) on delete set null,
  add constraint profiles_manager_no_propio check (manager_id is null or manager_id <> id);

-- Reserva atómica de la cola: dos despachadores a la vez nunca toman la misma fila.
-- Recupera las que quedaron 'enviando' más de 10 min (una función cortada a medias).
create or replace function public.avisos_reclamar(p_limite integer default 25)
returns setof public.avisos_salientes
language sql set search_path = public as $$
  update public.avisos_salientes s
     set estado = 'enviando', intentos = s.intentos + 1, reclamado_at = now()
   where s.id in (
     select id from public.avisos_salientes
      where (estado = 'pendiente' and proximo_intento <= now())
         or (estado = 'enviando' and reclamado_at < now() - interval '10 minutes')
      order by created_at
      limit p_limite
      for update skip locked)
  returning s.*;
$$;
revoke all on function public.avisos_reclamar(integer) from public, anon, authenticated;
grant execute on function public.avisos_reclamar(integer) to service_role;

-- RLS: lectura solo para admin; las escrituras las hace el servidor con service role,
-- salvo avisos_config (la pantalla) y festivos. (select is_admin()) se evalúa una vez.
alter table public.avisos_config    enable row level security;
alter table public.avisos_salientes enable row level security;
alter table public.avisos_estado    enable row level security;
alter table public.festivos         enable row level security;

create policy avisos_config_admin_select on public.avisos_config
  for select to authenticated using ((select public.is_admin()));
create policy avisos_config_admin_update on public.avisos_config
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy avisos_salientes_admin_select on public.avisos_salientes
  for select to authenticated using ((select public.is_admin()));
create policy avisos_estado_admin_select on public.avisos_estado
  for select to authenticated using ((select public.is_admin()));
create policy festivos_select on public.festivos
  for select to authenticated using (true);
create policy festivos_admin_write on public.festivos
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
```

- [ ] **Step 2: Aplicarla en producción**

Herramienta MCP `apply_migration` con `project_id: "msfylcgtlathccmxuheq"`, `name: "0045_avisos"` y el SQL del paso 1 tal cual.

- [ ] **Step 3: Verificarla**

Herramienta MCP `execute_sql` (mismo proyecto):

```sql
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('avisos_config','avisos_salientes','avisos_estado','festivos')
 order by 1;
select id, url, tipos_activos from public.avisos_config;
select count(*) as reclamadas from public.avisos_reclamar(1);
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name = 'manager_id';
select relname, relrowsecurity from pg_class
 where relname in ('avisos_config','avisos_salientes','avisos_estado','festivos') order by 1;
```

Expected: las 4 tablas; una fila `(true, null, {})`; `reclamadas = 0`; `manager_id` existe; `relrowsecurity = true` en las 4.

Después, `get_advisors` con `type: "security"`: no debe aparecer ningún aviso nuevo sobre estas tablas ni sobre `avisos_reclamar`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0045_avisos.sql
git commit -m "feat(avisos): migración 0045 con bandeja de salida, estado y manager directo

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Núcleo puro (reglas, calendario, capacidad, firma) con tests de node

**Files:**
- Create: `lib/avisos/reglas.ts`, `lib/avisos/calendario.ts`, `lib/avisos/capacidad.ts`, `lib/avisos/firma.ts`
- Test: `e2e/avisos-reglas.spec.ts`
- Modify: `playwright.config.ts` (proyecto `node-avisos`; excluirlo de `chromium`)

**Interfaces:**
- Consumes: `computeHorasStatus`, `BancoHorasRow` de `@/lib/horas/bancos-status`; `formatFechaISO` de `@/lib/horas/format`; `addDiasISO` de `@/lib/horas/auditoria-types` (todos sin imports de servidor).
- Produces:
  - `reglas.ts`: `LIMITE_DIA_HORAS = 10`, `LIMITE_PROYECTO_HORAS = 6`, `type ReglaLlamativo`, `interface MotivoLlamativo { regla; valor; limite; proyecto: string | null }`, `interface DiaResumido { total: number; porProyecto: Map<string, number> }`, `resumirPorDia(lineas: { dia; proyecto; horas }[]): Map<string, DiaResumido>`, `motivosLlamativo(dia: DiaResumido): MotivoLlamativo[]`, `claveLlamativo(duenoId, dia, m): string`, `type Nivel = 'disponible' | 'bajo' | 'consumido' | 'excedido'`, `comoNivel(estado: string): Nivel | null`, `interface Transicion { guardar; avisar; alTope }`, `transicion(anterior: Nivel | null, actual: Nivel): Transicion`, `MAX_INTENTOS = 5`, `siguienteIntento(intentos: number, ahora: Date): Date | null`, `horasCortas(n): string`, `textoProyectos(p): string`, `descripcionLlamativo(m, dia): string`, `centesimas(n): number`.
  - `calendario.ts`: `TOPE_DIAS = 30`, `esLaborable(iso, festivos): boolean`, `diasSinRegistrar({ fecha, registrados, festivos, alta, tope? }): { dias: number; desde: string | null }`, `ultimoAntesDe(fechas, fecha): string | null`, `dentroDePlazo(desde, hoy, diasAtras): boolean`.
  - `capacidad.ts`: `interface HorasBanco { asignadas; ampliadas; consumidas; inutilizables; disponibles }`, `interface NivelBanco { clave; proyecto; alcance: 'posicion' | 'proyecto'; posicion: string | null; nivel: Nivel; horas: HorasBanco; porcentajeConsumido: number | null; estadoProyecto: string | undefined; managerExcel: string | undefined }`, `porcentajeConsumido(base, consumidas): number | null`, `esProyectoActivo(estado): boolean`, `nivelesDeBancos(rows: BancoHorasRow[], ampliadas: Map<string, number>): NivelBanco[]`, `rankingCapacidad(items, top): { conMasHoras; masLibres }`.
  - `firma.ts`: `firmar(cuerpo, secreto, t): string`, `interface FilaSaliente { id; tipo; datos: unknown; prueba; intentos; created_at }`, `construirEnvio(fila, secreto, ahora): { cuerpo: string; cabeceras: Record<string, string> }`.

- [ ] **Step 1: Registrar el proyecto de tests**

En `playwright.config.ts`, añadir este proyecto justo después de `node-horas`:

```ts
    {
      name: 'node-avisos',
      testMatch: ['**/avisos-*.spec.ts'],
    },
```

y en el `testIgnore` del proyecto `chromium` añadir `'**/avisos-*.spec.ts'` al final de la lista (si no, `chromium` también los recogería).

Crear la config temporal (NO se commitea; se borra al acabar la tarea):

```ts
// pw-node-only.config.ts — temporal: corre solo los tests de node, sin globalSetup
// (el globalSetup normal siembra usuarios en la base de producción).
import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './e2e', projects: [{ name: 'node-avisos', testMatch: ['**/avisos-*.spec.ts'] }] })
```

- [ ] **Step 2: Escribir los tests (fallan: los módulos no existen)**

`e2e/avisos-reglas.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  resumirPorDia, motivosLlamativo, claveLlamativo, comoNivel, transicion,
  siguienteIntento, MAX_INTENTOS, textoProyectos, descripcionLlamativo,
} from '../lib/avisos/reglas'
import { diasSinRegistrar, ultimoAntesDe, dentroDePlazo } from '../lib/avisos/calendario'
import { nivelesDeBancos, rankingCapacidad, porcentajeConsumido } from '../lib/avisos/capacidad'
import { firmar, construirEnvio } from '../lib/avisos/firma'
import type { BancoHorasRow } from '../lib/horas/bancos-status'

const dia = (total: number, porProyecto: Record<string, number>) => ({ total, porProyecto: new Map(Object.entries(porProyecto)) })
const fechas = (...d: string[]) => new Set(d)

// --- reglas ---------------------------------------------------------------

test('resumirPorDia suma por día y por proyecto, en centésimas', () => {
  const r = resumirPorDia([
    { dia: '2026-09-14', proyecto: 'A', horas: 0.1 },
    { dia: '2026-09-14', proyecto: 'A', horas: 0.2 },
    { dia: '2026-09-15', proyecto: 'B', horas: 3 },
  ])
  expect(r.get('2026-09-14')!.total).toBe(0.3)
  expect(r.get('2026-09-14')!.porProyecto.get('A')).toBe(0.3)
  expect(r.get('2026-09-15')!.total).toBe(3)
})

test('llamativo: más de 10 h en el día', () => {
  expect(motivosLlamativo(dia(11, { A: 4, B: 4, Departamento: 3 }))).toEqual([
    { regla: 'dia_largo', valor: 11, limite: 10, proyecto: null },
  ])
  expect(motivosLlamativo(dia(10, { A: 5, B: 5 }))).toEqual([])
})

test('llamativo: 6 h o más a un proyecto, sin contar Departamento', () => {
  expect(motivosLlamativo(dia(8, { A: 6, Departamento: 2 }))).toEqual([
    { regla: 'proyecto_largo', valor: 6, limite: 6, proyecto: 'A' },
  ])
  expect(motivosLlamativo(dia(8, { A: 5.99, Departamento: 2.01 }))).toEqual([])
  expect(motivosLlamativo(dia(7, { Departamento: 7 }))).toEqual([])
})

test('claveLlamativo distingue regla y proyecto', () => {
  expect(claveLlamativo('u1', '2026-09-14', { regla: 'dia_largo', valor: 11, limite: 10, proyecto: null }))
    .toBe('llamativo:u1:2026-09-14:dia_largo')
  expect(claveLlamativo('u1', '2026-09-14', { regla: 'proyecto_largo', valor: 6, limite: 6, proyecto: 'A' }))
    .toBe('llamativo:u1:2026-09-14:proyecto_largo:A')
})

test('comoNivel solo acepta los cuatro niveles', () => {
  expect(comoNivel('bajo')).toBe('bajo')
  expect(comoNivel('sin_asignacion')).toBeNull()
  expect(comoNivel('sin_presupuesto')).toBeNull()
  expect(comoNivel('toString')).toBeNull()
})

test('transicion: línea base, empeora, cruza al tope, mejora e igual', () => {
  expect(transicion(null, 'excedido')).toEqual({ guardar: true, avisar: false, alTope: false })
  expect(transicion('disponible', 'bajo')).toEqual({ guardar: true, avisar: true, alTope: false })
  expect(transicion('bajo', 'consumido')).toEqual({ guardar: true, avisar: true, alTope: true })
  expect(transicion('disponible', 'excedido')).toEqual({ guardar: true, avisar: true, alTope: true })
  expect(transicion('consumido', 'excedido')).toEqual({ guardar: true, avisar: true, alTope: false })
  expect(transicion('excedido', 'disponible')).toEqual({ guardar: true, avisar: false, alTope: false })
  expect(transicion('bajo', 'bajo')).toEqual({ guardar: false, avisar: false, alTope: false })
})

test('siguienteIntento: 5 min, 30 min, 2 h, 12 h y luego nada', () => {
  const t0 = new Date('2026-09-14T10:00:00.000Z')
  const mas = (min: number) => new Date(t0.getTime() + min * 60_000).toISOString()
  expect(siguienteIntento(1, t0)!.toISOString()).toBe(mas(5))
  expect(siguienteIntento(2, t0)!.toISOString()).toBe(mas(30))
  expect(siguienteIntento(3, t0)!.toISOString()).toBe(mas(120))
  expect(siguienteIntento(4, t0)!.toISOString()).toBe(mas(720))
  expect(siguienteIntento(MAX_INTENTOS, t0)).toBeNull()
})

test('textos listos para un mensaje (los del contrato)', () => {
  expect(textoProyectos([{ proyecto: 'Proyecto Ejemplo', horas: 5 }, { proyecto: 'Departamento', horas: 2.5 }]))
    .toBe('Proyecto Ejemplo (5 h), Departamento (2,5 h)')
  expect(descripcionLlamativo({ regla: 'dia_largo', valor: 11, limite: 10, proyecto: null }, '2026-09-14'))
    .toBe('11 h registradas el 14/09 (límite: 10 h)')
  expect(descripcionLlamativo({ regla: 'proyecto_largo', valor: 6.5, limite: 6, proyecto: 'A' }, '2026-09-14'))
    .toBe('6,5 h a A el 14/09 (límite: 6 h)')
})

// --- calendario (mié 16/09/2026; lun 14; vie 11) ----------------------------

test('días sin registrar: el ejemplo del contrato', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-16', registrados: fechas('2026-09-11'), festivos: fechas(), alta: '2026-01-01' }))
    .toEqual({ dias: 2, desde: '2026-09-14' })
})

test('días sin registrar: un festivo no cuenta', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-16', registrados: fechas('2026-09-11'), festivos: fechas('2026-09-15'), alta: '2026-01-01' }))
    .toEqual({ dias: 1, desde: '2026-09-14' })
})

test('días sin registrar: no cuenta días anteriores al alta', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-16', registrados: fechas(), festivos: fechas(), alta: '2026-09-15' }))
    .toEqual({ dias: 1, desde: '2026-09-15' })
})

test('días sin registrar: si registró el día anterior, cero', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-16', registrados: fechas('2026-09-15'), festivos: fechas(), alta: '2026-01-01' }))
    .toEqual({ dias: 0, desde: null })
})

test('días sin registrar: el lunes no cuenta el fin de semana', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-14', registrados: fechas('2026-09-11'), festivos: fechas(), alta: '2026-01-01' }))
    .toEqual({ dias: 0, desde: null })
})

test('días sin registrar: se para en el tope', () => {
  expect(diasSinRegistrar({ fecha: '2026-09-16', registrados: fechas(), festivos: fechas(), alta: '2026-01-01', tope: 3 }))
    .toEqual({ dias: 3, desde: '2026-09-11' })
})

test('ultimoAntesDe y dentroDePlazo', () => {
  expect(ultimoAntesDe(['2026-09-02', '2026-09-11', '2026-09-16'], '2026-09-16')).toBe('2026-09-11')
  expect(ultimoAntesDe([], '2026-09-16')).toBeNull()
  expect(dentroDePlazo('2026-09-09', '2026-09-16', 7)).toBe(true)
  expect(dentroDePlazo('2026-09-08', '2026-09-16', 7)).toBe(false)
})

// --- capacidad -------------------------------------------------------------

const fila = (p: Partial<BancoHorasRow> & Pick<BancoHorasRow, 'project' | 'position'>): BancoHorasRow => ({
  assigned: 0, consumed: 0, remaining: 0, inutilizables: 0, carryNeto: 0, status: 'sin_asignacion',
  monthly: [], projectEstado: 'Activo', manager: 'Carlos Ruiz', ...p,
})

test('porcentajeConsumido con un decimal, y null sin base', () => {
  expect(porcentajeConsumido(40, 33.5)).toBe(83.8)
  expect(porcentajeConsumido(148, 40)).toBe(27)
  expect(porcentajeConsumido(0, 5)).toBeNull()
})

test('nivelesDeBancos: posición con banco, total con ampliaciones, sin inactivos', () => {
  const rows = [
    fila({ project: 'A', position: 'SEO Strategist', assigned: 40, consumed: 33.5, remaining: 6.5, status: 'bajo' }),
    fila({ project: 'A', position: 'CRM', assigned: 0, consumed: 2, remaining: -2, status: 'excedido' }),
    fila({ project: 'B', position: 'CRM', assigned: 100, consumed: 100, remaining: 0, status: 'consumido' }),
    fila({ project: 'C', position: 'CRM', assigned: 10, consumed: 10, remaining: 0, status: 'consumido', projectEstado: 'Finalizado' }),
  ]
  const n = nivelesDeBancos(rows, new Map([['A', 20]]))
  expect(n.map((x) => [x.clave, x.nivel])).toEqual([
    ['banco:A:SEO Strategist', 'bajo'],
    ['banco:A:*', 'disponible'], // 40 + 20 ampliadas = 60; consumidas 35,5 → quedan 24,5
    ['banco:B:CRM', 'consumido'],
    ['banco:B:*', 'consumido'],
  ])
  const totalA = n.find((x) => x.clave === 'banco:A:*')!
  expect(totalA.horas).toEqual({ asignadas: 60, ampliadas: 20, consumidas: 35.5, inutilizables: 0, disponibles: 24.5 })
  expect(totalA.alcance).toBe('proyecto')
  expect(totalA.posicion).toBeNull()
  expect(totalA.managerExcel).toBe('Carlos Ruiz')
})

test('rankingCapacidad: más horas disponibles y menos porcentaje consumido', () => {
  const it = (proyecto: string, disponibles: number, pct: number | null) => ({
    proyecto, horas: { asignadas: 0, ampliadas: 0, consumidas: 0, inutilizables: 0, disponibles }, porcentajeConsumido: pct,
  })
  const r = rankingCapacidad([it('A', 10, 90), it('B', 50, 40), it('C', 30, 10), it('D', 0, null)], 2)
  expect(r.conMasHoras.map((x) => x.proyecto)).toEqual(['B', 'C'])
  expect(r.masLibres.map((x) => x.proyecto)).toEqual(['C', 'B'])
})

// --- firma -----------------------------------------------------------------

test('firma: vector conocido', () => {
  expect(firmar('{"id":"3f1c2a9e","tipo":"registro.enviado"}', 'secreto-de-prueba', 1757851930))
    .toBe('t=1757851930,v1=5dae7559f136b97314806773982eb26b8d92158a7712f268ad95314e6440bfb9')
})

test('construirEnvio: sobre v1 y una firma que valida el código del contrato', () => {
  const salida = { id: 'e1', tipo: 'registro.enviado', datos: { dia: '2026-09-14' }, prueba: true, intentos: 1, created_at: '2026-09-14T15:32:10.412+00:00' }
  const ahora = new Date('2026-09-14T15:32:11.000Z')
  const { cuerpo, cabeceras } = construirEnvio(salida, 'secreto-de-prueba', ahora)
  expect(JSON.parse(cuerpo)).toEqual({
    id: 'e1', tipo: 'registro.enviado', version: 1, fecha: '2026-09-14T15:32:10.412Z', prueba: true, datos: { dia: '2026-09-14' },
  })
  expect(cabeceras['Content-Type']).toBe('application/json')
  expect(cabeceras['X-Avisos-Id']).toBe('e1')
  expect(cabeceras['X-Avisos-Tipo']).toBe('registro.enviado')
  // La misma verificación que el contrato le da a Julián para n8n/Zapier.
  const partes = Object.fromEntries(cabeceras['X-Avisos-Firma'].split(',').map((p) => p.split('=')))
  expect(partes.t).toBe(String(Math.floor(ahora.getTime() / 1000)))
  const esperada = createHmac('sha256', 'secreto-de-prueba').update(`${partes.t}.${cuerpo}`).digest('hex')
  expect(timingSafeEqual(Buffer.from(esperada), Buffer.from(partes.v1))).toBe(true)
})
```

- [ ] **Step 3: Correrlos y ver que fallan**

Run: `npx playwright test -c pw-node-only.config.ts`
Expected: FAIL (no se pueden resolver `../lib/avisos/*`).

- [ ] **Step 4: Implementar `lib/avisos/reglas.ts`**

```ts
// Núcleo puro de los avisos (sin IO): resumen de un día, registro llamativo, niveles de
// banco y HUCHA, reintentos y textos listos para un mensaje. Lo prueba node-avisos.
import { formatFechaISO } from '@/lib/horas/format'

export const LIMITE_DIA_HORAS = 10
export const LIMITE_PROYECTO_HORAS = 6

export function centesimas(n: number): number {
  return Math.round(n * 100) / 100
}

// --- Registro llamativo ------------------------------------------------------

export type ReglaLlamativo = 'dia_largo' | 'proyecto_largo'

export interface MotivoLlamativo {
  regla: ReglaLlamativo
  valor: number
  limite: number
  proyecto: string | null // solo en proyecto_largo
}

export interface DiaResumido {
  total: number
  porProyecto: Map<string, number>
}

// Suma las líneas por día y por proyecto. Redondea a centésimas, que es lo que guarda la
// base (numeric(5,2)): sin eso 0,1 + 0,2 daría 0,30000000000000004.
export function resumirPorDia(lineas: { dia: string; proyecto: string; horas: number }[]): Map<string, DiaResumido> {
  const out = new Map<string, DiaResumido>()
  for (const l of lineas) {
    const d = out.get(l.dia) ?? { total: 0, porProyecto: new Map<string, number>() }
    d.total = centesimas(d.total + Number(l.horas))
    d.porProyecto.set(l.proyecto, centesimas((d.porProyecto.get(l.proyecto) ?? 0) + Number(l.horas)))
    out.set(l.dia, d)
  }
  return out
}

export function motivosLlamativo(dia: DiaResumido): MotivoLlamativo[] {
  const out: MotivoLlamativo[] = []
  if (dia.total > LIMITE_DIA_HORAS) {
    out.push({ regla: 'dia_largo', valor: dia.total, limite: LIMITE_DIA_HORAS, proyecto: null })
  }
  for (const [proyecto, horas] of dia.porProyecto) {
    if (proyecto === 'Departamento') continue // horas internas: no son "un proyecto"
    if (horas >= LIMITE_PROYECTO_HORAS) {
      out.push({ regla: 'proyecto_largo', valor: horas, limite: LIMITE_PROYECTO_HORAS, proyecto })
    }
  }
  return out
}

// Clave de deduplicación: un aviso por persona, día y regla (y proyecto).
export function claveLlamativo(duenoId: string, dia: string, m: MotivoLlamativo): string {
  return `llamativo:${duenoId}:${dia}:${m.regla}${m.proyecto ? `:${m.proyecto}` : ''}`
}

// --- Niveles de banco y HUCHA ------------------------------------------------

export type Nivel = 'disponible' | 'bajo' | 'consumido' | 'excedido'

const ORDEN: Record<Nivel, number> = { disponible: 0, bajo: 1, consumido: 2, excedido: 3 }

// Los estados que no son un nivel (sin_asignacion, sin_presupuesto) no avisan. hasOwnProperty
// y no `in`: `'toString' in ORDEN` es true por herencia.
export function comoNivel(estado: string): Nivel | null {
  return Object.prototype.hasOwnProperty.call(ORDEN, estado) ? (estado as Nivel) : null
}

export interface Transicion {
  guardar: boolean // hay que anotar el nivel nuevo en avisos_estado
  avisar: boolean // empeoró: sale un aviso de nivel
  alTope: boolean // además cruzó a consumido o más desde abajo
}

export function transicion(anterior: Nivel | null, actual: Nivel): Transicion {
  // Primera vez que se ve este banco: se anota sin avisar (sin avalancha al encender).
  if (anterior === null) return { guardar: true, avisar: false, alTope: false }
  if (ORDEN[actual] > ORDEN[anterior]) {
    const alTope = ORDEN[actual] >= ORDEN.consumido && ORDEN[anterior] < ORDEN.consumido
    return { guardar: true, avisar: true, alTope }
  }
  // Mejoró (p. ej. una ampliación): se rearma en silencio para avisar si vuelve a caer.
  if (ORDEN[actual] < ORDEN[anterior]) return { guardar: true, avisar: false, alTope: false }
  return { guardar: false, avisar: false, alTope: false }
}

// --- Reintentos --------------------------------------------------------------

export const MAX_INTENTOS = 5
const ESPERA_MINUTOS = [5, 30, 120, 720] // tras el 1.º, 2.º, 3.º y 4.º intento fallido

// Cuándo reintentar tras `intentos` fallidos (contando el que acaba de fallar). null = no
// se reintenta más y el aviso queda fallido.
export function siguienteIntento(intentos: number, ahora: Date): Date | null {
  if (intentos >= MAX_INTENTOS) return null
  const minutos = ESPERA_MINUTOS[Math.max(0, intentos - 1)]
  return new Date(ahora.getTime() + minutos * 60_000)
}

// --- Textos listos para un mensaje -------------------------------------------

const HORAS_CORTAS = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })

export function horasCortas(n: number): string {
  return `${HORAS_CORTAS.format(n)} h`
}

export function textoProyectos(p: { proyecto: string; horas: number }[]): string {
  return p.map((x) => `${x.proyecto} (${horasCortas(x.horas)})`).join(', ')
}

export function descripcionLlamativo(m: MotivoLlamativo, dia: string): string {
  const ddmm = formatFechaISO(dia).slice(0, 5)
  return m.regla === 'dia_largo'
    ? `${horasCortas(m.valor)} registradas el ${ddmm} (límite: ${horasCortas(m.limite)})`
    : `${horasCortas(m.valor)} a ${m.proyecto} el ${ddmm} (límite: ${horasCortas(m.limite)})`
}
```

- [ ] **Step 5: Implementar `lib/avisos/calendario.ts`**

```ts
// Días sin registrar, para la escalera de recordatorios que monta el flujo de Julián.
// Puro, sin IO: el día a día (qué fechas registró cada uno) llega ya resuelto.
import { addDiasISO } from '@/lib/horas/auditoria-types'

export const TOPE_DIAS = 30

function esFinDeSemana(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return d === 0 || d === 6
}

export function esLaborable(iso: string, festivos: Set<string>): boolean {
  return !esFinDeSemana(iso) && !festivos.has(iso)
}

// Cuenta hacia atrás, desde el día anterior a `fecha`, los laborables seguidos sin
// registro. Se para en el primer laborable registrado, al llegar al día del alta de la
// persona o al tope. `desde` es el pendiente más antiguo.
export function diasSinRegistrar(args: {
  fecha: string
  registrados: Set<string>
  festivos: Set<string>
  alta: string
  tope?: number
}): { dias: number; desde: string | null } {
  const tope = args.tope ?? TOPE_DIAS
  let dias = 0
  let desde: string | null = null
  // Salvaguarda: como mucho 3 × tope días naturales (fines de semana y festivos incluidos).
  for (let d = addDiasISO(args.fecha, -1), vueltas = 0;
    d >= args.alta && dias < tope && vueltas < tope * 3;
    d = addDiasISO(d, -1), vueltas++) {
    if (!esLaborable(d, args.festivos)) continue
    if (args.registrados.has(d)) break
    dias++
    desde = d
  }
  return { dias, desde }
}

export function ultimoAntesDe(fechas: Iterable<string>, fecha: string): string | null {
  let ultimo: string | null = null
  for (const f of fechas) if (f < fecha && (ultimo === null || f > ultimo)) ultimo = f
  return ultimo
}

// ¿Puede la persona registrar todavía `desde` por su cuenta? (7 días o su ventana ampliada)
export function dentroDePlazo(desde: string, hoy: string, diasAtras: number): boolean {
  return desde >= addDiasISO(hoy, -diasAtras)
}
```

- [ ] **Step 6: Implementar `lib/avisos/capacidad.ts`**

```ts
// Niveles del banco de horas por posición y por proyecto, y ranking de capacidad.
// Puro, sin IO: parte de las filas de getBancosHoras y de las ampliaciones activas.
import { computeHorasStatus, type BancoHorasRow } from '@/lib/horas/bancos-status'
import { centesimas, comoNivel, type Nivel } from '@/lib/avisos/reglas'

export interface HorasBanco {
  asignadas: number
  ampliadas: number
  consumidas: number
  inutilizables: number
  disponibles: number
}

export interface NivelBanco {
  clave: string // clave en avisos_estado
  proyecto: string
  alcance: 'posicion' | 'proyecto'
  posicion: string | null
  nivel: Nivel
  horas: HorasBanco
  porcentajeConsumido: number | null
  estadoProyecto: string | undefined
  managerExcel: string | undefined
}

// Sobre la base efectiva (asignadas − inutilizables), con un decimal. Sin base, null.
export function porcentajeConsumido(base: number, consumidas: number): number | null {
  if (base <= 0) return null
  return Math.round((consumidas / base) * 1000) / 10
}

export function esProyectoActivo(estado: string | undefined): boolean {
  return (estado ?? '').trim().toLowerCase() === 'activo'
}

// rows = getBancosHoras({ role: 'admin' }); ampliadas = Σ ampliaciones activas por proyecto.
// El total del proyecto suma las ampliaciones, como el detalle de /bancos: tras vender
// horas, un proyecto no debe seguir "al tope". Por posición no hay ampliaciones.
export function nivelesDeBancos(rows: BancoHorasRow[], ampliadas: Map<string, number>): NivelBanco[] {
  const porProyecto = new Map<string, BancoHorasRow[]>()
  for (const r of rows) {
    if (!esProyectoActivo(r.projectEstado)) continue
    porProyecto.set(r.project, [...(porProyecto.get(r.project) ?? []), r])
  }

  const out: NivelBanco[] = []
  for (const [proyecto, filas] of porProyecto) {
    for (const r of filas) {
      if (r.assigned <= 0) continue // sin banco asignado: no avisa (el total ya lo recoge)
      const nivel = comoNivel(r.status)
      if (!nivel) continue
      out.push({
        clave: `banco:${proyecto}:${r.position}`, proyecto, alcance: 'posicion', posicion: r.position, nivel,
        horas: {
          asignadas: centesimas(r.assigned), ampliadas: 0, consumidas: centesimas(r.consumed),
          inutilizables: centesimas(r.inutilizables), disponibles: centesimas(r.remaining),
        },
        porcentajeConsumido: porcentajeConsumido(r.assigned - r.inutilizables, r.consumed),
        estadoProyecto: r.projectEstado, managerExcel: r.manager,
      })
    }

    const amp = ampliadas.get(proyecto) ?? 0
    const asignadas = centesimas(filas.reduce((s, r) => s + r.assigned, 0) + amp)
    const consumidas = centesimas(filas.reduce((s, r) => s + r.consumed, 0))
    const inutilizables = centesimas(filas.reduce((s, r) => s + r.inutilizables, 0))
    const nivel = comoNivel(computeHorasStatus(centesimas(asignadas - inutilizables), consumidas))
    if (!nivel) continue
    out.push({
      clave: `banco:${proyecto}:*`, proyecto, alcance: 'proyecto', posicion: null, nivel,
      horas: {
        asignadas, ampliadas: centesimas(amp), consumidas, inutilizables,
        disponibles: centesimas(asignadas - consumidas - inutilizables),
      },
      porcentajeConsumido: porcentajeConsumido(asignadas - inutilizables, consumidas),
      estadoProyecto: filas[0].projectEstado, managerExcel: filas[0].manager,
    })
  }
  return out
}

export function rankingCapacidad<T extends { horas: HorasBanco; porcentajeConsumido: number | null }>(
  items: T[], top: number,
): { conMasHoras: T[]; masLibres: T[] } {
  const conMasHoras = [...items].sort((a, b) => b.horas.disponibles - a.horas.disponibles).slice(0, top)
  const masLibres = items
    .filter((i) => i.porcentajeConsumido !== null)
    .sort((a, b) => (a.porcentajeConsumido as number) - (b.porcentajeConsumido as number))
    .slice(0, top)
  return { conMasHoras, masLibres }
}
```

- [ ] **Step 7: Implementar `lib/avisos/firma.ts`**

```ts
// Formato de cable de un aviso: el sobre v1 y la firma HMAC. Es lo que documenta el
// contrato (docs/avisos/contrato-avisos-v1.md); puro, lo prueba node-avisos.
import { createHmac } from 'node:crypto'

// X-Avisos-Firma: t=<segundos unix>,v1=<HMAC-SHA256 hex de "<t>.<cuerpo>">.
export function firmar(cuerpo: string, secreto: string, t: number): string {
  const v1 = createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')
  return `t=${t},v1=${v1}`
}

// Una fila de avisos_salientes tal como la devuelve avisos_reclamar.
export interface FilaSaliente {
  id: string
  tipo: string
  datos: unknown
  prueba: boolean
  intentos: number
  created_at: string
}

// `fecha` es la del hecho (created_at) y no cambia entre reintentos; `t` es el momento
// del envío, que es lo que el receptor compara con su reloj.
export function construirEnvio(fila: FilaSaliente, secreto: string, ahora: Date): { cuerpo: string; cabeceras: Record<string, string> } {
  const cuerpo = JSON.stringify({
    id: fila.id, tipo: fila.tipo, version: 1, fecha: new Date(fila.created_at).toISOString(), prueba: fila.prueba, datos: fila.datos,
  })
  const t = Math.floor(ahora.getTime() / 1000)
  return {
    cuerpo,
    cabeceras: {
      'Content-Type': 'application/json',
      'X-Avisos-Id': fila.id,
      'X-Avisos-Tipo': fila.tipo,
      'X-Avisos-Firma': firmar(cuerpo, secreto, t),
    },
  }
}
```

- [ ] **Step 8: Correr los tests y el typecheck**

Run: `npx playwright test -c pw-node-only.config.ts`
Expected: todos PASS.

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 9: Borrar la config temporal y commitear**

```bash
rm pw-node-only.config.ts
git add lib/avisos/reglas.ts lib/avisos/calendario.ts lib/avisos/capacidad.ts lib/avisos/firma.ts e2e/avisos-reglas.spec.ts playwright.config.ts
git commit -m "feat(avisos): reglas, calendario, capacidad y firma, con tests de node

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Contrato en código, entorno y bandeja de salida

**Files:**
- Create: `lib/avisos/contrato.ts`, `lib/avisos/entorno.ts`, `lib/avisos/bandeja.ts`, `lib/avisos/tras-responder.ts`, `lib/avisos/estado.ts`
- Test: `e2e/avisos-contrato.spec.ts`

**Interfaces:**
- Consumes: de Task 2 `Nivel`, `siguienteIntento`, `comoNivel` (`reglas.ts`), `construirEnvio`, `FilaSaliente` (`firma.ts`); tablas de Task 1; `fetchAllRows` (`@/lib/supabase/fetch-all`); `createAdminClient` (`@/lib/supabase/admin`).
- Produces:
  - `contrato.ts`: `TIPOS_AVISO` (tupla de los 7 tipos), `type TipoAviso`, `DESCRIPCION_TIPO: Record<TipoAviso, string>`, `PersonaAviso`, `ManagerAviso`, `HorasAviso`, `SaldoHucha`, `DatosRegistroEnviado`, `DatosRegistroLlamativo`, `DatosBanco`, `DatosHuchaNuevo`, `DatosHuchaAmpliacion`, `DatosHuchaNivel`, `DatosPorTipo`, `ejemplos(base: string): { [K in TipoAviso]: DatosPorTipo[K] }`.
  - `entorno.ts`: `esProduccion(): boolean`, `appUrl(): string`, `enlaceBanco(proyecto): string`, `enlaceHucha(projectId): string`, `esPersonaDePrueba(email): boolean`.
  - `bandeja.ts`: `emitirAviso<T>(tipo: T, datos: DatosPorTipo[T], opciones?: { clave?: string; prueba?: boolean }): Promise<string | null>`, `despacharPendientes(limite = 25): Promise<{ enviados: number; fallidos: number }>`, `enviarPrueba(tipo: TipoAviso): Promise<{ ok: boolean; mensaje: string }>`.
  - `tras-responder.ts`: `trasResponder(trabajo: () => Promise<void>): void`.
  - `estado.ts`: `leerEstados(db, prefijo: 'banco:' | 'hucha:'): Promise<Map<string, Nivel>>`, `guardarEstados(db, filas: { clave: string; nivel: Nivel }[]): Promise<void>`.

- [ ] **Step 1: Escribir los tests (fallan: los módulos no existen)**

Crear otra vez `pw-node-only.config.ts` (mismo contenido que en Task 2; no se commitea).

`e2e/avisos-contrato.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { TIPOS_AVISO, DESCRIPCION_TIPO, ejemplos } from '../lib/avisos/contrato'
import { appUrl, enlaceBanco, esPersonaDePrueba } from '../lib/avisos/entorno'
import { textoProyectos, descripcionLlamativo } from '../lib/avisos/reglas'

test('hay un ejemplo y una descripción por cada tipo', () => {
  const e = ejemplos('https://app.test')
  expect(Object.keys(e).sort()).toEqual([...TIPOS_AVISO].sort())
  for (const t of TIPOS_AVISO) expect(DESCRIPCION_TIPO[t].length).toBeGreaterThan(0)
})

test('los ejemplos cuadran con las reglas (los textos no se escriben dos veces a mano)', () => {
  const e = ejemplos('https://app.test')
  expect(textoProyectos(e['registro.enviado'].proyectos)).toBe(e['registro.enviado'].proyectos_texto)
  const l = e['registro.llamativo']
  expect(descripcionLlamativo({ regla: l.regla, valor: l.valor, limite: l.limite, proyecto: l.proyecto }, l.dia)).toBe(l.descripcion)
  expect(e['banco.al_tope'].alcance).toBe('proyecto')
  expect(e['banco.nivel'].enlace).toBe('https://app.test/bancos/Proyecto%20Ejemplo')
})

test('appUrl: APP_URL sin barra final, o el dominio de producción de Vercel', () => {
  const antes = { app: process.env.APP_URL, vercel: process.env.VERCEL_PROJECT_PRODUCTION_URL }
  try {
    process.env.APP_URL = 'https://plataforma.test/'
    expect(appUrl()).toBe('https://plataforma.test')
    expect(enlaceBanco('Proyecto Ejemplo')).toBe('https://plataforma.test/bancos/Proyecto%20Ejemplo')
    delete process.env.APP_URL
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'control.vercel.app'
    expect(appUrl()).toBe('https://control.vercel.app')
  } finally {
    if (antes.app === undefined) delete process.env.APP_URL
    else process.env.APP_URL = antes.app
    if (antes.vercel === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = antes.vercel
  }
})

test('las personas que siembran los E2E no cuentan', () => {
  expect(esPersonaDePrueba('e2e-operativo@horas.test')).toBe(true)
  expect(esPersonaDePrueba('laura.gomez@bastidafarina.com')).toBe(false)
  expect(esPersonaDePrueba(null)).toBe(false)
})
```

Run: `npx playwright test -c pw-node-only.config.ts`
Expected: FAIL en `avisos-contrato.spec.ts` (módulos inexistentes); `avisos-reglas.spec.ts` sigue en verde.

- [ ] **Step 2: Implementar `lib/avisos/contrato.ts`**

```ts
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
  dia: string; actor: { nombre: string }; saldo: SaldoHucha; nivel: Nivel | null; managers: ManagerAviso[]; enlace: string
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
    'registro.llamativo': {
      persona, manager_directo: manager, dia: '2026-09-14', regla: 'dia_largo', valor: 11, limite: 10, proyecto: null,
      horas_dia: 11, descripcion: '11 h registradas el 14/09 (límite: 10 h)',
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
      motivo: 'Ampliación aprobada por el cliente', referencia: 'PO-2026-118', dia: '2026-09-14', actor: { nombre: 'Marta López' },
      saldo: { asignado: 3000, consumido: 2450, disponible: 550 }, nivel: 'bajo', managers: [manager], enlace: enlaceHucha,
    },
    'hucha.nivel': {
      proyecto: 'Proyecto Ejemplo', proyecto_id: proyectoId, nivel: 'consumido', nivel_anterior: 'bajo', moneda: 'EUR',
      saldo: { asignado: 3000, consumido: 3000, disponible: 0 }, managers: [manager], enlace: enlaceHucha,
    },
  }
}
```

- [ ] **Step 3: Implementar `lib/avisos/entorno.ts`**

```ts
// Dónde corre esto y a qué apuntan los enlaces. Solo producción envía avisos: hay una
// única base Supabase y la comparten el servidor local y los E2E.
export function esProduccion(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

export function appUrl(): string {
  const explicita = process.env.APP_URL?.trim()
  if (explicita) return explicita.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  return vercel ? `https://${vercel}` : 'http://localhost:3000'
}

export function enlaceBanco(proyecto: string): string {
  return `${appUrl()}/bancos/${encodeURIComponent(proyecto)}`
}

export function enlaceHucha(projectId: string): string {
  return `${appUrl()}/presupuestos/${projectId}`
}

// Los usuarios que siembran los E2E (e2e-*@horas.test) nunca generan ni reciben avisos.
export function esPersonaDePrueba(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase().endsWith('@horas.test')
}
```

- [ ] **Step 4: Implementar `lib/avisos/bandeja.ts`**

```ts
// Bandeja de salida: encolar (emitirAviso) y entregar (despacharPendientes), con service
// role. Solo producción envía; el botón «Enviar prueba» sí sale desde cualquier entorno.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { construirEnvio, type FilaSaliente } from '@/lib/avisos/firma'
import { siguienteIntento } from '@/lib/avisos/reglas'
import { esProduccion, appUrl } from '@/lib/avisos/entorno'
import { ejemplos, type DatosPorTipo, type TipoAviso } from '@/lib/avisos/contrato'

const TIMEOUT_MS = 5000
const COLUMNAS_FILA = 'id, tipo, datos, prueba, intentos, created_at'

interface Config { url: string | null; tiposActivos: string[] }
type Resultado = 'enviado' | 'reintento' | 'fallido' | 'descartado'

async function leerConfig(db: SupabaseClient): Promise<Config> {
  const { data, error } = await db.from('avisos_config').select('url, tipos_activos').eq('id', true).single()
  if (error) throw new Error(`avisos_config: ${error.message}`)
  return { url: (data.url as string | null) ?? null, tiposActivos: (data.tipos_activos as string[] | null) ?? [] }
}

// Encola un aviso y devuelve su id, o null si no se encoló (fuera de producción, o esa
// clave ya se emitió). Sin URL o con el tipo inactivo queda 'descartado': así, al activar
// un tipo más adelante, no llega de golpe todo lo acumulado.
export async function emitirAviso<T extends TipoAviso>(
  tipo: T, datos: DatosPorTipo[T], opciones: { clave?: string; prueba?: boolean } = {},
): Promise<string | null> {
  const prueba = opciones.prueba === true
  if (!prueba && !esProduccion()) return null
  const db = createAdminClient()
  const cfg = await leerConfig(db)
  const conDestino = !!cfg.url && (prueba || cfg.tiposActivos.includes(tipo))
  const { data, error } = await db.from('avisos_salientes').insert({
    tipo, datos, prueba, clave: opciones.clave ?? null,
    estado: conDestino ? 'pendiente' : 'descartado',
    motivo_descarte: conDestino ? null : 'sin_destino',
  }).select('id').single()
  if (error) {
    if (error.code === '23505') return null // esa clave ya se había emitido
    throw new Error(`avisos_salientes: ${error.message}`)
  }
  return data.id as string
}

async function marcarFallo(db: SupabaseClient, fila: FilaSaliente, codigo: number | null, error: string): Promise<Resultado> {
  // Las pruebas no se reintentan: el admin ve el resultado en el momento.
  const proximo = fila.prueba ? null : siguienteIntento(fila.intentos, new Date())
  const { error: e } = await db.from('avisos_salientes').update(
    proximo
      ? { estado: 'pendiente', proximo_intento: proximo.toISOString(), ultimo_codigo: codigo, ultimo_error: error }
      : { estado: 'fallido', ultimo_codigo: codigo, ultimo_error: error },
  ).eq('id', fila.id)
  if (e) console.error('[avisos] no se pudo anotar el fallo:', e.message)
  return proximo ? 'reintento' : 'fallido'
}

async function entregar(db: SupabaseClient, fila: FilaSaliente, cfg: Config): Promise<Resultado> {
  if (!cfg.url || (!fila.prueba && !cfg.tiposActivos.includes(fila.tipo))) {
    await db.from('avisos_salientes').update({ estado: 'descartado', motivo_descarte: 'sin_destino' }).eq('id', fila.id)
    return 'descartado'
  }
  const secreto = process.env.AVISOS_FIRMA_SECRETO
  if (!secreto) {
    console.error('[avisos] falta AVISOS_FIRMA_SECRETO: no se envía nada sin firmar')
    return marcarFallo(db, fila, null, 'sin_secreto')
  }
  const { cuerpo, cabeceras } = construirEnvio(fila, secreto, new Date())
  try {
    // Con límite de tiempo: un fetch sin timeout no falla, espera (incidente de Graph, 31/08).
    const res = await fetch(cfg.url, {
      method: 'POST', headers: cabeceras, body: cuerpo, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store',
    })
    if (res.ok) {
      await db.from('avisos_salientes').update({
        estado: 'enviado', enviado_at: new Date().toISOString(), ultimo_codigo: res.status, ultimo_error: null,
      }).eq('id', fila.id)
      return 'enviado'
    }
    const texto = (await res.text().catch(() => '')).slice(0, 500)
    return marcarFallo(db, fila, res.status, texto || `HTTP ${res.status}`)
  } catch (e) {
    return marcarFallo(db, fila, null, (e instanceof Error ? e.message : String(e)).slice(0, 500))
  }
}

// Entrega los pendientes vencidos (y los 'enviando' atascados). Solo en producción: la
// cola vive en la base de producción y un servidor local no debe tocarla.
export async function despacharPendientes(limite = 25): Promise<{ enviados: number; fallidos: number }> {
  if (!esProduccion()) return { enviados: 0, fallidos: 0 }
  const db = createAdminClient()
  const { data, error } = await db.rpc('avisos_reclamar', { p_limite: limite })
  if (error) throw new Error(`avisos_reclamar: ${error.message}`)
  const filas = (data ?? []) as FilaSaliente[]
  if (!filas.length) return { enviados: 0, fallidos: 0 }
  const cfg = await leerConfig(db)
  let enviados = 0
  let fallidos = 0
  for (const fila of filas) {
    const r = await entregar(db, fila, cfg)
    if (r === 'enviado') enviados++
    if (r === 'fallido') fallidos++
  }
  return { enviados, fallidos }
}

// «Enviar prueba»: manda el ejemplo del contrato de ese tipo y devuelve el resultado.
// Reserva solo su propia fila, así que desde local no se lleva por delante la cola real.
export async function enviarPrueba(tipo: TipoAviso): Promise<{ ok: boolean; mensaje: string }> {
  const db = createAdminClient()
  const cfg = await leerConfig(db)
  if (!cfg.url) return { ok: false, mensaje: 'Primero guarda la URL del webhook.' }
  const id = await emitirAviso(tipo, ejemplos(appUrl())[tipo], { prueba: true })
  if (!id) return { ok: false, mensaje: 'No se pudo crear el aviso de prueba.' }
  const { data: fila, error } = await db.from('avisos_salientes')
    .update({ estado: 'enviando', intentos: 1, reclamado_at: new Date().toISOString() })
    .eq('id', id).eq('estado', 'pendiente')
    .select(COLUMNAS_FILA).single()
  if (error || !fila) return { ok: false, mensaje: `No se pudo reservar el aviso de prueba: ${error?.message ?? 'sin fila'}` }
  const r = await entregar(db, fila as FilaSaliente, cfg)
  const { data: fin } = await db.from('avisos_salientes').select('ultimo_codigo, ultimo_error').eq('id', id).single()
  if (r === 'enviado') return { ok: true, mensaje: `Enviado (HTTP ${fin?.ultimo_codigo ?? '2xx'}).` }
  const codigo = fin?.ultimo_codigo ? `HTTP ${fin.ultimo_codigo}` : 'sin respuesta'
  return { ok: false, mensaje: `Falló (${codigo}): ${fin?.ultimo_error ?? r}` }
}
```

- [ ] **Step 5: Implementar `lib/avisos/tras-responder.ts` y `lib/avisos/estado.ts`**

```ts
// lib/avisos/tras-responder.ts
// Después de responder al usuario: corre el detector y despacha lo que haya generado.
// El guardado nunca espera a la red, y un fallo aquí nunca le llega al usuario.
import { after } from 'next/server'
import { despacharPendientes } from '@/lib/avisos/bandeja'

export function trasResponder(trabajo: () => Promise<void>): void {
  after(async () => {
    try { await trabajo() } catch (e) { console.error('[avisos]', e instanceof Error ? e.message : e) }
    try { await despacharPendientes() } catch (e) { console.error('[avisos] despacho:', e instanceof Error ? e.message : e) }
  })
}
```

```ts
// lib/avisos/estado.ts
// Último nivel conocido de cada banco y cada HUCHA (avisos_estado): sin él no se sabe
// si un nivel "empeoró". Se lee entero por prefijo; son pocos cientos de filas.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { comoNivel, type Nivel } from '@/lib/avisos/reglas'

export async function leerEstados(db: SupabaseClient, prefijo: 'banco:' | 'hucha:'): Promise<Map<string, Nivel>> {
  const filas = await fetchAllRows<{ clave: string; nivel: string }>((desde, hasta) =>
    db.from('avisos_estado').select('clave, nivel').like('clave', `${prefijo}%`).range(desde, hasta))
  const out = new Map<string, Nivel>()
  for (const f of filas) {
    const n = comoNivel(f.nivel)
    if (n) out.set(f.clave, n)
  }
  return out
}

export async function guardarEstados(db: SupabaseClient, filas: { clave: string; nivel: Nivel }[]): Promise<void> {
  if (!filas.length) return
  const ahora = new Date().toISOString()
  const { error } = await db.from('avisos_estado')
    .upsert(filas.map((f) => ({ ...f, updated_at: ahora })), { onConflict: 'clave' })
  if (error) throw new Error(`avisos_estado: ${error.message}`)
}
```

- [ ] **Step 6: Tests y typecheck**

Run: `npx playwright test -c pw-node-only.config.ts`
Expected: PASS en `avisos-reglas.spec.ts` y `avisos-contrato.spec.ts`.

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Borrar la config temporal y commitear**

```bash
rm pw-node-only.config.ts
git add lib/avisos/contrato.ts lib/avisos/entorno.ts lib/avisos/bandeja.ts lib/avisos/tras-responder.ts lib/avisos/estado.ts e2e/avisos-contrato.spec.ts
git commit -m "feat(avisos): contrato en código, bandeja de salida con firma y reintentos

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Personas y detector de bancos (+ enganche en ampliaciones de horas)

**Files:**
- Create: `lib/avisos/personas.ts`, `lib/avisos/detector-bancos.ts`
- Modify: `app/(horas)/bancos/[project]/actions.ts`
- Test: `e2e/avisos-personas.spec.ts`

**Interfaces:**
- Consumes: `emitirAviso` (bandeja), `trasResponder`, `leerEstados`/`guardarEstados` (estado), `enlaceBanco`/`esProduccion` (entorno), `nivelesDeBancos`/`NivelBanco` (capacidad), `transicion`/`Nivel` (reglas), `DatosBanco`/`ManagerAviso`/`PersonaAviso` (contrato); `getBancosHoras` de `@/lib/horas/bancos`; `diaMadrid` de `@/lib/horas/auditoria-types`.
- Produces:
  - `personas.ts`: `interface Perfil { persona: PersonaAviso; managerId: string | null; alta: string; diasAtras: number | null; activo: boolean }`, `aPerfil(raw): Perfil`, `perfilesPorId(db): Promise<Map<string, Perfil>>`, `managerDe(perfil, todos): ManagerAviso | null`, `managerPorNombre(nombre, todos): ManagerAviso | null`.
  - `detector-bancos.ts`: `nivelesActuales(db?): Promise<NivelBanco[]>`, `evaluarBancos(proyectos?: string[]): Promise<void>` (nunca lanza).

- [ ] **Step 1: Escribir los tests de `personas.ts` (fallan)**

Crear `pw-node-only.config.ts` (igual que en Task 2; no se commitea).

`e2e/avisos-personas.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { aPerfil, managerDe, managerPorNombre, type Perfil } from '../lib/avisos/personas'

type Raw = Parameters<typeof aPerfil>[0]
const perfil = (id: string, nombre: string, extra: Partial<Raw> = {}): Perfil => aPerfil({
  id, full_name: nombre, email: `${id}@ejemplo.com`, role: 'manager', status: 'activo', manager_id: null,
  created_at: '2026-07-01T10:00:00Z', registro_dias_atras: null, positions: { name: 'CRM' }, ...extra,
})
const mapa = (...ps: Perfil[]) => new Map(ps.map((p) => [p.persona.id, p]))

test('aPerfil: posición (objeto o lista), día de alta en Madrid y estado', () => {
  const a = perfil('u1', 'Laura Gómez', { created_at: '2026-09-13T23:30:00Z', positions: [{ name: 'SEO Strategist' }], status: 'inactivo' })
  expect(a.persona).toEqual({ id: 'u1', nombre: 'Laura Gómez', email: 'u1@ejemplo.com', posicion: 'SEO Strategist', rol: 'manager' })
  expect(a.alta).toBe('2026-09-14') // 23:30 UTC = 01:30 del día siguiente en Madrid (verano)
  expect(a.activo).toBe(false)
  expect(perfil('u2', 'Sin Posición', { positions: null }).persona.posicion).toBeNull()
})

test('managerDe: el manager directo si existe', () => {
  const jefe = perfil('m1', 'Carlos Ruiz')
  const laura = perfil('u1', 'Laura Gómez', { manager_id: 'm1' })
  const todos = mapa(jefe, laura)
  expect(managerDe(laura, todos)).toEqual({ id: 'm1', nombre: 'Carlos Ruiz', email: 'm1@ejemplo.com' })
  expect(managerDe(jefe, todos)).toBeNull()
  expect(managerDe(perfil('u3', 'Huérfano', { manager_id: 'no-existe' }), todos)).toBeNull()
})

test('managerPorNombre: sin mayúsculas ni espacios; ambiguo o desconocido sin email', () => {
  const todos = mapa(perfil('m1', 'Carlos Ruiz'), perfil('m2', 'Ana Pérez'), perfil('m3', 'Ana Pérez'))
  expect(managerPorNombre('  carlos ruiz ', todos)).toEqual({ id: 'm1', nombre: 'Carlos Ruiz', email: 'm1@ejemplo.com' })
  expect(managerPorNombre('Ana Pérez', todos)).toEqual({ id: null, nombre: 'Ana Pérez', email: null })
  expect(managerPorNombre('Pilar', todos)).toEqual({ id: null, nombre: 'Pilar', email: null })
  expect(managerPorNombre('', todos)).toBeNull()
  expect(managerPorNombre(undefined, todos)).toBeNull()
})
```

Run: `npx playwright test -c pw-node-only.config.ts`
Expected: FAIL en `avisos-personas.spec.ts` (módulo inexistente).

- [ ] **Step 2: Implementar `lib/avisos/personas.ts`**

```ts
// Personas y managers para los avisos: perfil con su posición, manager directo (0045) y
// manager del proyecto (el Excel trae un nombre suelto: se casa por nombre, como HUCHA).
import type { SupabaseClient } from '@supabase/supabase-js'
import { diaMadrid } from '@/lib/horas/auditoria-types'
import type { ManagerAviso, PersonaAviso } from '@/lib/avisos/contrato'

export interface Perfil {
  persona: PersonaAviso
  managerId: string | null
  alta: string // día del alta en Madrid (YYYY-MM-DD)
  diasAtras: number | null // ventana de registro ampliada (0043); null = los 7 normales
  activo: boolean
}

interface PerfilRaw {
  id: string
  full_name: string | null
  email: string | null
  role: string
  status: string
  manager_id: string | null
  created_at: string
  registro_dias_atras: number | null
  positions: { name: string } | { name: string }[] | null
}

const SELECT_PERFIL = 'id, full_name, email, role, status, manager_id, created_at, registro_dias_atras, positions(name)'

export function aPerfil(r: PerfilRaw): Perfil {
  const pos = Array.isArray(r.positions) ? r.positions[0] : r.positions
  return {
    persona: { id: r.id, nombre: r.full_name ?? '', email: r.email ?? '', posicion: pos?.name ?? null, rol: r.role },
    managerId: r.manager_id,
    alta: diaMadrid(r.created_at),
    diasAtras: r.registro_dias_atras,
    activo: r.status === 'activo',
  }
}

// Todos los perfiles (son pocas decenas): hacen falta enteros para resolver los managers.
export async function perfilesPorId(db: SupabaseClient): Promise<Map<string, Perfil>> {
  const { data, error } = await db.from('profiles').select(SELECT_PERFIL)
  if (error) throw new Error(`profiles: ${error.message}`)
  return new Map(((data ?? []) as unknown as PerfilRaw[]).map((r) => [r.id, aPerfil(r)]))
}

function comoManager(p: Perfil): ManagerAviso {
  return { id: p.persona.id, nombre: p.persona.nombre, email: p.persona.email || null }
}

export function managerDe(perfil: Perfil | undefined, todos: Map<string, Perfil>): ManagerAviso | null {
  if (!perfil?.managerId) return null
  const m = todos.get(perfil.managerId)
  return m ? comoManager(m) : null
}

// Sin coincidencia única (nadie, o dos personas con el mismo nombre) se devuelve el
// nombre del Excel sin email: el flujo puede avisar al canal aunque no sepa a quién.
export function managerPorNombre(nombre: string | undefined, todos: Map<string, Perfil>): ManagerAviso | null {
  const n = (nombre ?? '').trim()
  if (!n) return null
  const clave = n.toLowerCase()
  const iguales = [...todos.values()].filter((p) => p.persona.nombre.trim().toLowerCase() === clave)
  return iguales.length === 1 ? comoManager(iguales[0]) : { id: null, nombre: n, email: null }
}
```

- [ ] **Step 3: Correr los tests**

Run: `npx playwright test -c pw-node-only.config.ts`
Expected: todo PASS.

- [ ] **Step 4: Implementar `lib/avisos/detector-bancos.ts`**

```ts
// Detector de bancos de horas: compara el nivel de cada banco (por posición y total del
// proyecto) con el último anotado en avisos_estado y avisa cuando empeora. Usa el mismo
// cálculo que /bancos (getBancosHoras: carry forward, provisionales e histórico).
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBancosHoras } from '@/lib/horas/bancos'
import { diaMadrid } from '@/lib/horas/auditoria-types'
import { emitirAviso } from '@/lib/avisos/bandeja'
import { esProduccion, enlaceBanco } from '@/lib/avisos/entorno'
import { nivelesDeBancos, type NivelBanco } from '@/lib/avisos/capacidad'
import { transicion, type Nivel } from '@/lib/avisos/reglas'
import { leerEstados, guardarEstados } from '@/lib/avisos/estado'
import { perfilesPorId, managerPorNombre, type Perfil } from '@/lib/avisos/personas'
import type { DatosBanco } from '@/lib/avisos/contrato'

async function ampliacionesActivas(db: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await db.from('horas_ampliaciones').select('project, hours').eq('active', true)
  if (error) throw new Error(`horas_ampliaciones: ${error.message}`)
  const out = new Map<string, number>()
  for (const a of data ?? []) {
    const p = String(a.project).trim()
    out.set(p, (out.get(p) ?? 0) + Number(a.hours))
  }
  return out
}

// Niveles actuales de los bancos de proyectos activos. También los usa el resumen de capacidad.
export async function nivelesActuales(db: SupabaseClient = createAdminClient()): Promise<NivelBanco[]> {
  const [rows, amps] = await Promise.all([getBancosHoras({ role: 'admin' }), ampliacionesActivas(db)])
  return nivelesDeBancos(rows, amps)
}

// Sin `proyectos` evalúa todos (cron diario). Nunca lanza.
export async function evaluarBancos(proyectos?: string[]): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const filtro = proyectos ? new Set(proyectos.map((p) => p.trim())) : null
    const niveles = (await nivelesActuales(db)).filter((n) => !filtro || filtro.has(n.proyecto))
    if (!niveles.length) return
    const previos = await leerEstados(db, 'banco:')
    const hoy = diaMadrid(new Date().toISOString())
    const aGuardar: { clave: string; nivel: Nivel }[] = []
    let perfiles: Map<string, Perfil> | null = null

    for (const n of niveles) {
      const anterior = previos.get(n.clave) ?? null
      const t = transicion(anterior, n.nivel)
      if (t.guardar) aGuardar.push({ clave: n.clave, nivel: n.nivel })
      if (!t.avisar || anterior === null) continue

      perfiles ??= await perfilesPorId(db)
      const manager = managerPorNombre(n.managerExcel, perfiles)
      if (manager && !manager.id) console.warn(`[avisos] manager del Excel sin usuario único: "${manager.nombre}" (${n.proyecto})`)
      const datos: DatosBanco = {
        proyecto: n.proyecto, alcance: n.alcance, posicion: n.posicion, nivel: n.nivel, nivel_anterior: anterior,
        horas: n.horas, porcentaje_consumido: n.porcentajeConsumido, estado_proyecto: n.estadoProyecto ?? null,
        manager_proyecto: manager, enlace: enlaceBanco(n.proyecto),
      }
      // Clave por transición y día: si dos guardados evalúan a la vez, sale un solo aviso.
      const base = `${n.clave}:${anterior}>${n.nivel}:${hoy}`
      await emitirAviso('banco.nivel', datos, { clave: `${base}:nivel` })
      if (t.alTope) await emitirAviso('banco.al_tope', datos, { clave: `${base}:tope` })
    }
    await guardarEstados(db, aGuardar)
  } catch (e) {
    console.error('[avisos] evaluarBancos:', e instanceof Error ? e.message : e)
  }
}
```

- [ ] **Step 5: Enganchar las ampliaciones de horas**

`app/(horas)/bancos/[project]/actions.ts` completo:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { trasResponder } from '@/lib/avisos/tras-responder'
import { evaluarBancos } from '@/lib/avisos/detector-bancos'

type Result = { ok: true } | { ok: false; error: string }

export async function ampliarHoras(
  project: string,
  input: { hours: number; reason: string; entry_date: string },
): Promise<Result> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('ampliar_horas', {
    p_project: project,
    p_hours: input.hours,
    p_reason: input.reason,
    p_entry_date: input.entry_date,
  })
  if (error) return { ok: false, error: error.message }
  // Una ampliación mejora el banco: se rearma para avisar otra vez si vuelve a caer.
  trasResponder(() => evaluarBancos([project]))
  revalidatePath(`/bancos/${encodeURIComponent(project)}`)
  revalidatePath('/bancos')
  return { ok: true }
}

export async function anularAmpliacionHoras(id: string, project: string): Promise<Result> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('anular_ampliacion_horas', { p_id: id })
  if (error) return { ok: false, error: error.message }
  // Quitar horas puede empeorar el banco: se evalúa (y avisa si toca).
  trasResponder(() => evaluarBancos([project]))
  revalidatePath(`/bancos/${encodeURIComponent(project)}`)
  revalidatePath('/bancos')
  return { ok: true }
}
```

- [ ] **Step 6: Typecheck y build**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 7: Borrar la config temporal y commitear**

```bash
rm pw-node-only.config.ts
git add lib/avisos/personas.ts lib/avisos/detector-bancos.ts e2e/avisos-personas.spec.ts "app/(horas)/bancos/[project]/actions.ts"
git commit -m "feat(avisos): detector de bancos por posición y proyecto, con rearme al ampliar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Detector de registros en `guardarRegistro` y retirada de la Fase 4

**Files:**
- Create: `lib/avisos/detector-registro.ts`
- Modify: `app/(horas)/registrar/actions.ts`, `playwright.config.ts`, `docs/avisos/contrato-avisos-v1.md`
- Delete: `lib/horas/alertas.ts`, `lib/horas/alertas-core.ts`, `e2e/horas-alertas.spec.ts`

**Interfaces:**
- Consumes: `emitirAviso`, `trasResponder`, `esProduccion`, `esPersonaDePrueba`, `perfilesPorId`, `managerDe`, `resumirPorDia`, `motivosLlamativo`, `claveLlamativo`, `textoProyectos`, `descripcionLlamativo`, `evaluarBancos` (Tasks 2–4).
- Produces: `interface LineaGuardada { entry_date: string; project: string; hours: number }`, `alGuardarRegistro(args: { esAlta: boolean; logId: string; lineas: LineaGuardada[] }): Promise<void>` (nunca lanza).

- [ ] **Step 1: Implementar `lib/avisos/detector-registro.ts`**

```ts
// Detector de registros: después de guardar, el pulso (solo altas, uno por fecha), los
// días llamativos y la evaluación de los bancos de los proyectos que tocó el guardado.
import { createAdminClient } from '@/lib/supabase/admin'
import { emitirAviso } from '@/lib/avisos/bandeja'
import { esProduccion, esPersonaDePrueba } from '@/lib/avisos/entorno'
import { perfilesPorId, managerDe } from '@/lib/avisos/personas'
import { resumirPorDia, motivosLlamativo, claveLlamativo, textoProyectos, descripcionLlamativo } from '@/lib/avisos/reglas'
import { evaluarBancos } from '@/lib/avisos/detector-bancos'

export interface LineaGuardada {
  entry_date: string
  project: string
  hours: number
}

// esAlta = el guardado no traía ancla. logId = el id que devolvió guardar_registro: sirve
// para saber de quién es el registro (un admin puede editar registros ajenos). Nunca lanza.
export async function alGuardarRegistro(args: { esAlta: boolean; logId: string; lineas: LineaGuardada[] }): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const { data: log, error } = await db.from('time_logs').select('user_id').eq('id', args.logId).single()
    if (error) throw new Error(`time_logs: ${error.message}`)
    const duenoId = log.user_id as string
    const perfiles = await perfilesPorId(db)
    const dueno = perfiles.get(duenoId)
    if (!dueno || esPersonaDePrueba(dueno.persona.email)) return
    const manager = managerDe(dueno, perfiles)

    const dias = [...new Set(args.lineas.map((l) => l.entry_date))]
    // El día entero (puede haber varios registros el mismo día), no solo este guardado.
    const { data: delDia, error: e2 } = await db.from('time_log_lines')
      .select('project, hours, time_logs!inner(entry_date, user_id, status)')
      .eq('time_logs.user_id', duenoId)
      .in('time_logs.entry_date', dias)
      .neq('time_logs.status', 'anulado')
    if (e2) throw new Error(`time_log_lines: ${e2.message}`)
    type FilaDia = { project: string; hours: number; time_logs: { entry_date: string } }
    const totales = resumirPorDia(((delDia ?? []) as unknown as FilaDia[])
      .map((l) => ({ dia: l.time_logs.entry_date, proyecto: l.project.trim(), horas: Number(l.hours) })))
    const deEste = resumirPorDia(args.lineas
      .map((l) => ({ dia: l.entry_date, proyecto: l.project.trim(), horas: Number(l.hours) })))

    for (const dia of dias) {
      const total = totales.get(dia) ?? { total: 0, porProyecto: new Map<string, number>() }
      const este = deEste.get(dia)
      if (args.esAlta && este) {
        const proyectos = [...este.porProyecto].map(([proyecto, horas]) => ({ proyecto, horas }))
        await emitirAviso('registro.enviado', {
          persona: dueno.persona, manager_directo: manager, dia,
          horas_registro: este.total, horas_dia: total.total,
          proyectos, proyectos_texto: textoProyectos(proyectos),
        })
      }
      for (const m of motivosLlamativo(total)) {
        await emitirAviso('registro.llamativo', {
          persona: dueno.persona, manager_directo: manager, dia,
          regla: m.regla, valor: m.valor, limite: m.limite, proyecto: m.proyecto,
          horas_dia: total.total, descripcion: descripcionLlamativo(m, dia),
        }, { clave: claveLlamativo(duenoId, dia, m) })
      }
    }

    const proyectos = [...new Set(args.lineas.map((l) => l.project.trim()))].filter((p) => p !== 'Departamento')
    if (proyectos.length) await evaluarBancos(proyectos)
  } catch (e) {
    console.error('[avisos] alGuardarRegistro:', e instanceof Error ? e.message : e)
  }
}
```

- [ ] **Step 2: Enganchar `guardarRegistro` y quitar la Fase 4**

`app/(horas)/registrar/actions.ts` completo:

```ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { trasResponder } from '@/lib/avisos/tras-responder'
import { alGuardarRegistro } from '@/lib/avisos/detector-registro'

export interface LineInput {
  entry_date: string; project: string; area_id: string; department: string; etapa_id: string; hours: number; description: string
}

export async function guardarRegistro(
  lines: LineInput[], logId: string | null = null
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!lines.length) return { ok: false, error: 'Agregá al menos una línea.' }
  const supabase = await createClient()

  // Toda la validación de alcance por posición (área, etapa, departamento y descripción)
  // vive en el motor guardar_registro (migración 0024), que la aplica a TODOS los roles,
  // incluido el admin. El RPC agrupa las líneas por su entry_date y reparte en los logs
  // diarios (alta: un log por fecha; edición: reutiliza el ancla y divide en varios días).
  const { data, error } = await supabase.rpc('guardar_registro', {
    p_anchor_log_id: logId, p_lines: lines,
  })
  if (error) return { ok: false, error: error.message }
  const id = data as string
  // Avisos (pulso, llamativo y bancos) después de responder: el guardado nunca espera a la red.
  trasResponder(() => alGuardarRegistro({ esAlta: logId === null, logId: id, lineas: lines }))
  return { ok: true, id }
}
```

Borrar la Fase 4:

```bash
git rm lib/horas/alertas.ts lib/horas/alertas-core.ts e2e/horas-alertas.spec.ts
```

En `playwright.config.ts`, quitar `'**/horas-alertas.spec.ts', ` del `testMatch` de `node-horas` y del `testIgnore` de `chromium-horas` (el resto de cada lista queda igual).

- [ ] **Step 3: Alinear el contrato con lo que emite el código**

En `docs/avisos/contrato-avisos-v1.md`, sección `registro.enviado`, sustituir:

```
Cada vez que alguien da de alta su registro diario (el pulso). Uno por persona y día. Las
ediciones posteriores no envían pulso.
```

por:

```
Cada vez que alguien da de alta un registro (el pulso): uno por cada alta y día. Si alguien
registra dos veces el mismo día llegan dos, cada uno con sus horas en `horas_registro` y el
total acumulado del día en `horas_dia`. Las ediciones no envían pulso.
```

Y en la sección `banco.al_tope`, justo después del párrafo que termina en «Mismos campos que `banco.nivel` con `alcance: "proyecto"`.», añadir:

```
Llega **junto con** el `banco.nivel` de ese mismo cambio (con los mismos datos). Si en un
flujo solo te interesa el tope, escucha este tipo y no el otro.
```

- [ ] **Step 4: Verificar que no queda nada de la Fase 4**

Run (Grep): patrón `horas/alertas|checkHorasAlertas|SLACK_WEBHOOK_URL|alertas-core` en `app/`, `lib/`, `components/`, `e2e/`.
Expected: sin coincidencias.

Crear `pw-node-only.config.ts` (igual que en Task 2) y correr:

Run: `npx playwright test -c pw-node-only.config.ts`
Expected: PASS (avisos-reglas, avisos-contrato, avisos-personas).

Run: `npx tsc --noEmit` y `npm run build`
Expected: sin errores.

- [ ] **Step 5: Borrar la config temporal y commitear**

```bash
rm pw-node-only.config.ts
git add lib/avisos/detector-registro.ts "app/(horas)/registrar/actions.ts" playwright.config.ts docs/avisos/contrato-avisos-v1.md
git commit -m "feat(avisos): pulso y registros llamativos al guardar; se retira la Fase 4

La alerta a Slack de la Fase 4 nunca se activó, calculaba con cifras crudas
y su fetch sin timeout colgaba el guardado. La sustituyen los avisos.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Detector de HUCHA (consumo, ampliación, anulación y sincronización)

**Files:**
- Create: `lib/avisos/detector-hucha.ts`
- Modify: `app/(hucha)/presupuestos/[id]/actions.ts`, `app/(hucha)/presupuestos/sincronizar/actions.ts`, `lib/hucha/sync.ts`

**Interfaces:**
- Consumes: `emitirAviso`, `trasResponder`, `esProduccion`, `enlaceHucha`, `leerEstados`, `guardarEstados`, `transicion`, `comoNivel`, `centesimas`, `Nivel`, `ManagerAviso`, `SaldoHucha`; `diaMadrid`.
- Produces: `interface MovimientoAmpliacion { id: string; amount: number; reason: string | null; reference: string | null; entry_date: string; actor_name: string }`, `evaluarHucha(ids?: string[]): Promise<void>`, `alAmpliarHucha(projectId: string, mov: MovimientoAmpliacion): Promise<void>`, `alSincronizarHucha(creados: { id: string; nombre: string; hucha: number }[]): Promise<void>` (ninguna lanza). `SyncReport.creados: { id: string; nombre: string; hucha: number }[]`.

- [ ] **Step 1: `lib/hucha/sync.ts` informa de los proyectos creados**

En la interfaz `SyncReport`, añadir tras `saltadosSinHucha: number`:

```ts
  creados: { id: string; nombre: string; hucha: number }[] // proyectos nuevos (para el aviso hucha.proyecto_nuevo)
```

En la inicialización del informe, añadir `creados: []`:

```ts
  const report: SyncReport = {
    proyectosCreados: 0, proyectosActualizados: 0,
    proyectosArchivados: 0, proyectosReactivados: 0,
    managersAsignados: 0, managersNoEncontrados: [], saltadosSinHucha: 0, creados: [],
  }
```

Y en la rama que crea el proyecto, sustituir `projectId = created.id; report.proyectosCreados++` por:

```ts
      projectId = created.id; report.proyectosCreados++
      report.creados.push({ id: created.id, nombre: proyecto, hucha })
```

(`SincronizarButton` pinta los campos uno a uno, así que el campo nuevo no aparece en pantalla; `e2e/hucha-sync.spec.ts` comprueba campos sueltos y sigue valiendo.)

- [ ] **Step 2: Implementar `lib/avisos/detector-hucha.ts`**

```ts
// Detector de HUCHA: proyecto nuevo (al sincronizar), ampliación y cambios de nivel
// (baja, agotada, excedida). El estado de cada HUCHA ya lo calcula la base
// (compute_hucha_status): aquí solo se compara con el último anotado.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { diaMadrid } from '@/lib/horas/auditoria-types'
import { emitirAviso } from '@/lib/avisos/bandeja'
import { esProduccion, enlaceHucha } from '@/lib/avisos/entorno'
import { transicion, comoNivel, centesimas, type Nivel } from '@/lib/avisos/reglas'
import { leerEstados, guardarEstados } from '@/lib/avisos/estado'
import type { ManagerAviso, SaldoHucha } from '@/lib/avisos/contrato'

export interface MovimientoAmpliacion {
  id: string
  amount: number
  reason: string | null
  reference: string | null
  entry_date: string
  actor_name: string
}

interface BancoRaw { currency: string | null; assigned_total: number; consumed_total: number; remaining: number; status: string }
interface HuchaRaw {
  id: string
  name: string
  hucha_banks: BancoRaw | BancoRaw[] | null
  project_assignments: { profiles: { id: string; full_name: string | null; email: string | null } | null }[] | null
}

interface Hucha {
  id: string
  nombre: string
  moneda: string
  saldo: SaldoHucha
  nivel: Nivel | null
  managers: ManagerAviso[]
}

const SELECT_HUCHA =
  'id, name, hucha_banks(currency, assigned_total, consumed_total, remaining, status), project_assignments(profiles(id, full_name, email))'

// Proyectos activos con su banco y sus managers (project_assignments).
async function leerHuchas(db: SupabaseClient, ids?: string[]): Promise<Hucha[]> {
  let q = db.from('projects').select(SELECT_HUCHA).eq('status', 'activo')
  if (ids) q = q.in('id', ids)
  const { data, error } = await q
  if (error) throw new Error(`projects/hucha_banks: ${error.message}`)
  return ((data ?? []) as unknown as HuchaRaw[]).flatMap((p) => {
    const b = Array.isArray(p.hucha_banks) ? p.hucha_banks[0] : p.hucha_banks
    if (!b) return []
    const managers = (p.project_assignments ?? [])
      .map((a) => a.profiles)
      .filter((pr): pr is { id: string; full_name: string | null; email: string | null } => pr !== null)
      .map((pr) => ({ id: pr.id, nombre: pr.full_name ?? '', email: pr.email }))
    return [{
      id: p.id, nombre: p.name, moneda: b.currency ?? 'EUR',
      saldo: {
        asignado: centesimas(Number(b.assigned_total)),
        consumido: centesimas(Number(b.consumed_total)),
        disponible: centesimas(Number(b.remaining)),
      },
      nivel: comoNivel(b.status), managers,
    }]
  })
}

// Sin `ids` evalúa todas (cron y sincronización). Nunca lanza.
export async function evaluarHucha(ids?: string[]): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const huchas = await leerHuchas(db, ids)
    const previos = await leerEstados(db, 'hucha:')
    const hoy = diaMadrid(new Date().toISOString())
    const aGuardar: { clave: string; nivel: Nivel }[] = []
    for (const h of huchas) {
      if (!h.nivel) continue // sin_presupuesto: no avisa
      const clave = `hucha:${h.id}`
      const anterior = previos.get(clave) ?? null
      const t = transicion(anterior, h.nivel)
      if (t.guardar) aGuardar.push({ clave, nivel: h.nivel })
      if (!t.avisar || anterior === null) continue
      await emitirAviso('hucha.nivel', {
        proyecto: h.nombre, proyecto_id: h.id, nivel: h.nivel, nivel_anterior: anterior,
        moneda: h.moneda, saldo: h.saldo, managers: h.managers, enlace: enlaceHucha(h.id),
      }, { clave: `${clave}:${anterior}>${h.nivel}:${hoy}` })
    }
    await guardarEstados(db, aGuardar)
  } catch (e) {
    console.error('[avisos] evaluarHucha:', e instanceof Error ? e.message : e)
  }
}

export async function alAmpliarHucha(projectId: string, mov: MovimientoAmpliacion): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const [h] = await leerHuchas(db, [projectId])
    if (h) {
      await emitirAviso('hucha.ampliacion', {
        proyecto: h.nombre, proyecto_id: h.id, importe: centesimas(Number(mov.amount)), moneda: h.moneda,
        motivo: mov.reason ?? '', referencia: mov.reference, dia: mov.entry_date, actor: { nombre: mov.actor_name },
        saldo: h.saldo, nivel: h.nivel, managers: h.managers, enlace: enlaceHucha(h.id),
      }, { clave: `hucha.ampliacion:${mov.id}` })
    }
  } catch (e) {
    console.error('[avisos] alAmpliarHucha:', e instanceof Error ? e.message : e)
  }
  await evaluarHucha([projectId]) // la ampliación mejora el nivel: rearme
}

export async function alSincronizarHucha(creados: { id: string; nombre: string; hucha: number }[]): Promise<void> {
  if (!esProduccion()) return
  try {
    const db = createAdminClient()
    const huchas = creados.length ? await leerHuchas(db, creados.map((c) => c.id)) : []
    const porId = new Map(huchas.map((h) => [h.id, h]))
    for (const c of creados) {
      const h = porId.get(c.id)
      await emitirAviso('hucha.proyecto_nuevo', {
        proyecto: c.nombre, proyecto_id: c.id, presupuesto: centesimas(c.hucha), moneda: h?.moneda ?? 'EUR',
        managers: h?.managers ?? [], enlace: enlaceHucha(c.id),
      }, { clave: `hucha.nuevo:${c.id}` })
    }
  } catch (e) {
    console.error('[avisos] alSincronizarHucha:', e instanceof Error ? e.message : e)
  }
  await evaluarHucha() // el Excel puede haber cambiado la base de cualquier HUCHA
}
```

- [ ] **Step 3: Enganchar las acciones de HUCHA**

`app/(hucha)/presupuestos/[id]/actions.ts`: añadir los imports

```ts
import { trasResponder } from '@/lib/avisos/tras-responder'
import { evaluarHucha, alAmpliarHucha, type MovimientoAmpliacion } from '@/lib/avisos/detector-hucha'
```

En `registrarConsumo`, justo después de `if (error) return { ok: false, error: error.message }`:

```ts
  trasResponder(() => evaluarHucha([projectId]))
```

En `ampliarPresupuesto`, sustituir `const { error } = await supabase.rpc('registrar_movimiento_hucha', {` por `const { data: mov, error } = await supabase.rpc('registrar_movimiento_hucha', {` (el RPC ya devuelve la fila del movimiento) y, justo después de su `if (error) return …`:

```ts
  const movimiento = mov as MovimientoAmpliacion
  trasResponder(() => alAmpliarHucha(projectId, movimiento))
```

En `anularMovimiento`, justo después de su `if (error) return …`:

```ts
  trasResponder(() => evaluarHucha([projectId]))
```

`app/(hucha)/presupuestos/sincronizar/actions.ts`: añadir

```ts
import { trasResponder } from '@/lib/avisos/tras-responder'
import { alSincronizarHucha } from '@/lib/avisos/detector-hucha'
```

y, justo después de `const report = await aplicarSync(data, createAdminClient())`:

```ts
    // Proyectos nuevos con HUCHA (y el nivel de todas) después de responder.
    trasResponder(() => alSincronizarHucha(report.creados))
```

- [ ] **Step 4: Typecheck y build**

Run: `npx tsc --noEmit` y `npm run build`
Expected: sin errores. (No correr `e2e/hucha-sync.spec.ts`: escribe en producción.)

- [ ] **Step 5: Commit**

```bash
git add lib/avisos/detector-hucha.ts lib/hucha/sync.ts "app/(hucha)/presupuestos/[id]/actions.ts" "app/(hucha)/presupuestos/sincronizar/actions.ts"
git commit -m "feat(avisos): HUCHA nueva, ampliada y con cambio de nivel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Consultas autenticadas y cron diario

**Files:**
- Create: `lib/avisos/auth.ts`, `lib/avisos/consultas.ts`, `app/api/avisos/v1/resumen-capacidad/route.ts`, `app/api/avisos/v1/dias-sin-registrar/route.ts`, `app/api/avisos/cron/route.ts`, `vercel.json`
- Test: `e2e/avisos-auth.spec.ts`

**Interfaces:**
- Consumes: `nivelesActuales`, `evaluarBancos` (Task 4), `evaluarHucha` (Task 6), `despacharPendientes` (Task 3), `rankingCapacidad`/`NivelBanco` (capacidad), `perfilesPorId`/`managerDe`/`managerPorNombre`/`Perfil` (personas), `diasSinRegistrar`/`ultimoAntesDe`/`dentroDePlazo`/`TOPE_DIAS` (calendario), `enlaceBanco`/`esPersonaDePrueba`/`esProduccion` (entorno), `PersonaAviso`/`ManagerAviso` (contrato), `fetchAllRows`, `addDiasISO`/`diaMadrid`.
- Produces: `autorizado(req: Request, secreto: string | undefined): boolean`; `resumenCapacidad(top: number)`; `interface PersonaPendiente`; `diasSinRegistrarDe(fecha: string): Promise<{ fecha: string; personas: PersonaPendiente[] }>`; rutas `GET /api/avisos/v1/resumen-capacidad`, `GET /api/avisos/v1/dias-sin-registrar`, `GET /api/avisos/cron`.

- [ ] **Step 1: Test de `autorizado` (falla)**

Crear `pw-node-only.config.ts` (igual que en Task 2).

`e2e/avisos-auth.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { autorizado } from '../lib/avisos/auth'

const req = (auth?: string) => new Request('https://plataforma.test/api/avisos/v1/x', { headers: auth ? { authorization: auth } : {} })

test('autorizado: solo con el Bearer exacto y con secreto configurado', () => {
  expect(autorizado(req('Bearer abc123'), 'abc123')).toBe(true)
  expect(autorizado(req('Bearer abc124'), 'abc123')).toBe(false)
  expect(autorizado(req('abc123'), 'abc123')).toBe(false)
  expect(autorizado(req(), 'abc123')).toBe(false)
  expect(autorizado(req('Bearer '), '')).toBe(false)
  expect(autorizado(req('Bearer abc123'), undefined)).toBe(false)
})
```

Run: `npx playwright test -c pw-node-only.config.ts`
Expected: FAIL en `avisos-auth.spec.ts` (módulo inexistente).

- [ ] **Step 2: Implementar `lib/avisos/auth.ts`**

```ts
// Autenticación de las consultas y del cron: `Authorization: Bearer <secreto>`, comparada
// en tiempo constante. Sin secreto configurado no pasa nadie.
import { timingSafeEqual } from 'node:crypto'

export function autorizado(req: Request, secreto: string | undefined): boolean {
  if (!secreto) return false
  const recibido = Buffer.from(req.headers.get('authorization') ?? '')
  const esperado = Buffer.from(`Bearer ${secreto}`)
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado)
}
```

Run: `npx playwright test -c pw-node-only.config.ts`
Expected: todo PASS.

- [ ] **Step 3: Implementar `lib/avisos/consultas.ts`**

```ts
// Consultas que los flujos de Julián piden por calendario: el resumen de capacidad
// (quincenal) y los días sin registrar (la escalera de recordatorios la aplica su flujo).
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { addDiasISO } from '@/lib/horas/auditoria-types'
import { nivelesActuales } from '@/lib/avisos/detector-bancos'
import { rankingCapacidad, type NivelBanco } from '@/lib/avisos/capacidad'
import { perfilesPorId, managerDe, managerPorNombre, type Perfil } from '@/lib/avisos/personas'
import { diasSinRegistrar, ultimoAntesDe, dentroDePlazo, TOPE_DIAS } from '@/lib/avisos/calendario'
import { enlaceBanco, esPersonaDePrueba } from '@/lib/avisos/entorno'
import type { ManagerAviso, PersonaAviso } from '@/lib/avisos/contrato'

export async function resumenCapacidad(top: number) {
  const db = createAdminClient()
  const [niveles, perfiles] = await Promise.all([nivelesActuales(db), perfilesPorId(db)])
  const { conMasHoras, masLibres } = rankingCapacidad(niveles.filter((n) => n.alcance === 'proyecto'), top)
  const item = (n: NivelBanco) => ({
    proyecto: n.proyecto, horas: n.horas, porcentaje_consumido: n.porcentajeConsumido,
    manager_proyecto: managerPorNombre(n.managerExcel, perfiles), enlace: enlaceBanco(n.proyecto),
  })
  return { generado: new Date().toISOString(), top, con_mas_horas: conMasHoras.map(item), mas_libres: masLibres.map(item) }
}

export interface PersonaPendiente {
  persona: PersonaAviso
  manager_directo: ManagerAviso | null
  dias: number
  desde: string
  ultimo_registro: string | null // dentro de la ventana consultada (3 × tope días naturales)
  dentro_de_plazo: boolean
}

// Registran los operativos y managers activos (los admin no), sin los usuarios de los E2E.
function debeRegistrar(p: Perfil): boolean {
  return p.activo && (p.persona.rol === 'operativo' || p.persona.rol === 'manager') && !esPersonaDePrueba(p.persona.email)
}

export async function diasSinRegistrarDe(fecha: string): Promise<{ fecha: string; personas: PersonaPendiente[] }> {
  const db = createAdminClient()
  // 3 × tope en días naturales cubre los 30 laborables con fines de semana y festivos.
  const ventana = addDiasISO(fecha, -TOPE_DIAS * 3)
  const [perfiles, logs, fest] = await Promise.all([
    perfilesPorId(db),
    fetchAllRows<{ user_id: string; entry_date: string }>((desde, hasta) =>
      db.from('time_logs').select('user_id, entry_date').neq('status', 'anulado')
        .gte('entry_date', ventana).lt('entry_date', fecha).range(desde, hasta)),
    db.from('festivos').select('fecha'),
  ])
  if (fest.error) throw new Error(`festivos: ${fest.error.message}`)
  const festivos = new Set((fest.data ?? []).map((f) => String(f.fecha)))
  // Cualquier registro no anulado cuenta, Departamento incluido (así cuentan las vacaciones).
  const registradosPor = new Map<string, Set<string>>()
  for (const l of logs) {
    const s = registradosPor.get(l.user_id) ?? new Set<string>()
    s.add(l.entry_date)
    registradosPor.set(l.user_id, s)
  }

  const personas: PersonaPendiente[] = []
  for (const p of perfiles.values()) {
    if (!debeRegistrar(p)) continue
    const registrados = registradosPor.get(p.persona.id) ?? new Set<string>()
    const { dias, desde } = diasSinRegistrar({ fecha, registrados, festivos, alta: p.alta })
    if (dias < 1 || !desde) continue
    personas.push({
      persona: p.persona, manager_directo: managerDe(p, perfiles), dias, desde,
      ultimo_registro: ultimoAntesDe(registrados, fecha),
      dentro_de_plazo: dentroDePlazo(desde, fecha, p.diasAtras ?? 7),
    })
  }
  personas.sort((a, b) => b.dias - a.dias || a.persona.nombre.localeCompare(b.persona.nombre))
  return { fecha, personas }
}
```

- [ ] **Step 4: Las tres rutas y el cron de Vercel**

`app/api/avisos/v1/resumen-capacidad/route.ts`:

```ts
// GET /api/avisos/v1/resumen-capacidad?top=10 — para el resumen quincenal del flujo de Julián.
// `proxy.ts` excluye /api de la sesión: la ruta se autentica con su propia clave.
import { autorizado } from '@/lib/avisos/auth'
import { resumenCapacidad } from '@/lib/avisos/consultas'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  const n = Number(new URL(req.url).searchParams.get('top') ?? '10')
  const top = Number.isInteger(n) ? Math.min(Math.max(n, 1), 50) : 10
  try {
    return Response.json(await resumenCapacidad(top), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[avisos] resumen-capacidad:', e instanceof Error ? e.message : e)
    return Response.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 })
  }
}
```

`app/api/avisos/v1/dias-sin-registrar/route.ts`:

```ts
// GET /api/avisos/v1/dias-sin-registrar?fecha=YYYY-MM-DD — para la escalera de recordatorios.
// Sin fecha, hoy en Madrid (el reloj del servidor va en UTC).
import { autorizado } from '@/lib/avisos/auth'
import { diasSinRegistrarDe } from '@/lib/avisos/consultas'
import { diaMadrid } from '@/lib/horas/auditoria-types'

export const maxDuration = 60

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  if (!autorizado(req, process.env.AVISOS_API_KEY)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  const pedida = new URL(req.url).searchParams.get('fecha')
  if (pedida !== null && !FECHA_ISO.test(pedida)) {
    return Response.json({ error: 'El parámetro fecha tiene que ser YYYY-MM-DD.' }, { status: 400 })
  }
  const fecha = pedida ?? diaMadrid(new Date().toISOString())
  try {
    return Response.json(await diasSinRegistrarDe(fecha), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[avisos] dias-sin-registrar:', e instanceof Error ? e.message : e)
    return Response.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 })
  }
}
```

`app/api/avisos/cron/route.ts`:

```ts
// GET /api/avisos/cron — revisión diaria (vercel.json). Detecta lo que cambia sin que nadie
// registre (cierre de mes, Excel) y reintenta la cola. Vercel manda el CRON_SECRET solo.
import { autorizado } from '@/lib/avisos/auth'
import { esProduccion } from '@/lib/avisos/entorno'
import { evaluarBancos } from '@/lib/avisos/detector-bancos'
import { evaluarHucha } from '@/lib/avisos/detector-hucha'
import { despacharPendientes } from '@/lib/avisos/bandeja'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!autorizado(req, process.env.CRON_SECRET)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  if (!esProduccion()) return Response.json({ ok: true, omitido: 'fuera de producción' })
  await evaluarBancos() // nunca lanzan
  await evaluarHucha()
  try {
    return Response.json({ ok: true, despacho: await despacharPendientes(100) })
  } catch (e) {
    console.error('[avisos] cron despacho:', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 })
  }
}
```

`vercel.json` (06:00 UTC = 08:00 en Madrid en verano, 07:00 en invierno; el plan Hobby solo admite crons diarios):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/avisos/cron", "schedule": "0 6 * * *" }
  ]
}
```

- [ ] **Step 5: Typecheck, build y tests**

Run: `npx tsc --noEmit` y `npm run build`
Expected: sin errores; el build lista las tres rutas nuevas como dinámicas (ƒ).

Run: `npx playwright test -c pw-node-only.config.ts`
Expected: todo PASS.

Opcional, solo si el usuario tiene el dev server levantado (no arrancarlo): `curl -i http://localhost:3000/api/avisos/v1/resumen-capacidad` → `401`.

- [ ] **Step 6: Borrar la config temporal y commitear**

```bash
rm pw-node-only.config.ts
git add lib/avisos/auth.ts lib/avisos/consultas.ts e2e/avisos-auth.spec.ts vercel.json app/api/avisos
git commit -m "feat(avisos): consultas de capacidad y días sin registrar, y cron diario

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Pantalla Administración → Avisos, entrada en el menú y cambio de nombre

**Files:**
- Create: `app/(horas)/admin/avisos/page.tsx`, `app/(horas)/admin/avisos/actions.ts`, `components/horas/AvisosPanel.tsx`
- Modify: `components/AppShell.tsx`, `app/(horas)/mis-registros/page.tsx`

**Interfaces:**
- Consumes: `enviarPrueba` (bandeja), `TIPOS_AVISO`/`DESCRIPCION_TIPO`/`TipoAviso` (contrato), `appUrl` (entorno); componentes `@/components/ui/{table,button,input,badge}`; `toast` de `sonner`.
- Produces: acciones `guardarUrl(url: string)`, `activarTipo(tipo: TipoAviso, activo: boolean)`, `probarAviso(tipo: TipoAviso)`; componente `AvisosPanel` y tipo `EnvioRow`.

Estética: la de la app (mismos patrones que `UsuariosPanel`: `font-display` en títulos, tabla en `rounded-xl bg-card ring-1 ring-foreground/10`, cabecera `bg-(--muted-surface)`, checkbox `accent-(--brand)`, insignias con los colores `--status-*`).

- [ ] **Step 1: Acciones (`app/(horas)/admin/avisos/actions.ts`)**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarPrueba } from '@/lib/avisos/bandeja'
import { TIPOS_AVISO, type TipoAviso } from '@/lib/avisos/contrato'

type Result = { ok: true } | { ok: false; error: string }

// Id del usuario si es admin; null si no. Las acciones son puertas públicas: validan solas.
async function adminId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return me?.role === 'admin' ? user.id : null
}

// Vacía = no sale ningún aviso (el interruptor general).
export async function guardarUrl(url: string): Promise<Result> {
  const id = await adminId()
  if (!id) return { ok: false, error: 'Solo un administrador puede configurar los avisos.' }
  const limpia = url.trim()
  if (limpia) {
    let u: URL
    try { u = new URL(limpia) } catch { return { ok: false, error: 'La URL no es válida.' } }
    if (u.protocol !== 'https:') return { ok: false, error: 'La URL tiene que empezar por https://.' }
  }
  const { error } = await createAdminClient().from('avisos_config')
    .update({ url: limpia || null, updated_by: id, updated_at: new Date().toISOString() })
    .eq('id', true)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/avisos')
  return { ok: true }
}

export async function activarTipo(tipo: TipoAviso, activo: boolean): Promise<Result> {
  const id = await adminId()
  if (!id) return { ok: false, error: 'Solo un administrador puede configurar los avisos.' }
  if (!TIPOS_AVISO.includes(tipo)) return { ok: false, error: 'Tipo de aviso desconocido.' }
  const db = createAdminClient()
  const { data, error: leer } = await db.from('avisos_config').select('tipos_activos').eq('id', true).single()
  if (leer) return { ok: false, error: leer.message }
  const tipos = new Set<string>((data.tipos_activos as string[] | null) ?? [])
  if (activo) tipos.add(tipo)
  else tipos.delete(tipo)
  const { error } = await db.from('avisos_config')
    .update({ tipos_activos: [...tipos], updated_by: id, updated_at: new Date().toISOString() })
    .eq('id', true)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/avisos')
  return { ok: true }
}

export async function probarAviso(tipo: TipoAviso): Promise<{ ok: boolean; mensaje: string }> {
  if (!(await adminId())) return { ok: false, mensaje: 'Solo un administrador puede enviar pruebas.' }
  if (!TIPOS_AVISO.includes(tipo)) return { ok: false, mensaje: 'Tipo de aviso desconocido.' }
  try {
    const r = await enviarPrueba(tipo)
    revalidatePath('/admin/avisos')
    return r
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : 'No se pudo enviar la prueba.' }
  }
}
```

- [ ] **Step 2: Componente (`components/horas/AvisosPanel.tsx`)**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { guardarUrl, activarTipo, probarAviso } from '@/app/(horas)/admin/avisos/actions'
import { TIPOS_AVISO, DESCRIPCION_TIPO, type TipoAviso } from '@/lib/avisos/contrato'
import { cn } from '@/lib/utils'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

export interface EnvioRow {
  id: string
  tipo: string
  estado: 'pendiente' | 'enviando' | 'enviado' | 'fallido' | 'descartado'
  motivo_descarte: string | null
  intentos: number
  ultimo_codigo: number | null
  ultimo_error: string | null
  prueba: boolean
  created_at: string
  enviado_at: string | null
}

const ESTADO_CLASE: Record<EnvioRow['estado'], string> = {
  enviado: 'bg-(--status-disponible)/12 text-(--status-disponible)',
  pendiente: 'bg-(--status-bajo)/12 text-(--status-bajo)',
  enviando: 'bg-(--status-bajo)/12 text-(--status-bajo)',
  fallido: 'bg-(--status-excedido)/12 text-(--status-excedido)',
  descartado: 'bg-neutral-100 text-neutral-500',
}

// La hora que ve el admin es la de Madrid, no la del servidor (UTC).
const FECHA = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})

function respuesta(e: EnvioRow): string {
  if (e.estado === 'descartado') return e.motivo_descarte === 'sin_destino' ? 'Sin destino: tipo pausado o sin URL' : 'Descartado'
  const codigo = e.ultimo_codigo ? `HTTP ${e.ultimo_codigo}` : ''
  return [codigo, e.ultimo_error ?? ''].filter(Boolean).join(' · ') || '—'
}

export default function AvisosPanel({ url, tiposActivos, envios, consultas }: {
  url: string; tiposActivos: string[]; envios: EnvioRow[]; consultas: string[]
}) {
  const router = useRouter()
  const [valor, setValor] = useState(url)
  const [guardando, setGuardando] = useState(false)
  const [ocupado, setOcupado] = useState<TipoAviso | null>(null)
  const [resultados, setResultados] = useState<Partial<Record<TipoAviso, { ok: boolean; mensaje: string }>>>({})
  const activos = new Set(tiposActivos)

  async function guardar() {
    setGuardando(true)
    const res = await guardarUrl(valor)
    setGuardando(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(valor.trim() ? 'URL guardada' : 'URL quitada: ya no sale ningún aviso')
    router.refresh()
  }

  async function alternar(tipo: TipoAviso, activo: boolean) {
    setOcupado(tipo)
    const res = await activarTipo(tipo, activo)
    setOcupado(null)
    if (!res.ok) { toast.error(res.error); return }
    router.refresh()
  }

  async function probar(tipo: TipoAviso) {
    setOcupado(tipo)
    const res = await probarAviso(tipo)
    setOcupado(null)
    setResultados((r) => ({ ...r, [tipo]: res }))
    router.refresh()
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-display text-lg">Webhook</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Una sola URL para todos los avisos; cada uno trae su tipo en el campo <code>tipo</code>. Vacía, no sale ningún aviso.
        </p>
        <div className="flex max-w-2xl gap-2">
          <Input
            aria-label="URL del webhook" placeholder="https://hooks.zapier.com/…" value={valor}
            onChange={(e) => setValor(e.target.value)} className="h-9"
          />
          <Button onClick={guardar} disabled={guardando || valor.trim() === url}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg">Tipos de aviso</h2>
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
                  <TableHead>Aviso</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Prueba</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TIPOS_AVISO.map((tipo) => {
                  const r = resultados[tipo]
                  const activo = activos.has(tipo)
                  return (
                    <TableRow key={tipo}>
                      <TableCell className="py-3">
                        <div className="font-mono text-xs text-foreground">{tipo}</div>
                        <div className="text-sm text-muted-foreground">{DESCRIPCION_TIPO[tipo]}</div>
                      </TableCell>
                      <TableCell className="py-3">
                        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground/80">
                          <input
                            type="checkbox" className="size-4 accent-(--brand)" aria-label={`Activar ${tipo}`}
                            checked={activo} disabled={ocupado === tipo}
                            onChange={(e) => alternar(tipo, e.target.checked)}
                          />
                          {activo ? 'Activo' : 'Pausado'}
                        </label>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-col items-end gap-1">
                          <Button variant="outline" size="sm" disabled={!url || ocupado === tipo} onClick={() => probar(tipo)}>
                            <Send />
                            Enviar prueba
                          </Button>
                          {r && (
                            <span className={cn('text-xs', r.ok ? 'text-(--status-disponible)' : 'text-(--status-excedido)')}>
                              {r.mensaje}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg">Consultas</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Las pide el flujo cuando quiera, con la cabecera <code>Authorization: Bearer</code> y la clave <code>AVISOS_API_KEY</code> de Vercel.
        </p>
        <ul className="space-y-1">
          {consultas.map((c) => <li key={c} className="break-all font-mono text-xs text-foreground/80">GET {c}</li>)}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg">Últimos envíos</h2>
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Intentos</TableHead>
                  <TableHead>Respuesta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {envios.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      Todavía no ha salido ningún aviso.
                    </TableCell>
                  </TableRow>
                )}
                {envios.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="py-2.5 tabular-nums text-foreground/70">{FECHA.format(new Date(e.created_at))}</TableCell>
                    <TableCell className="py-2.5">
                      <span className="font-mono text-xs">{e.tipo}</span>
                      {e.prueba && <Badge className="ml-2 bg-sky-50 text-sky-700">Prueba</Badge>}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <Badge className={cn('capitalize', ESTADO_CLASE[e.estado])}>{e.estado}</Badge>
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums">{e.intentos}</TableCell>
                    <TableCell className="max-w-md truncate py-2.5 text-xs text-muted-foreground" title={respuesta(e)}>
                      {respuesta(e)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Página (`app/(horas)/admin/avisos/page.tsx`)**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/avisos/entorno'
import AvisosPanel, { type EnvioRow } from '@/components/horas/AvisosPanel'

export default async function AvisosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/registrar')

  const admin = createAdminClient()
  const [cfg, envios] = await Promise.all([
    admin.from('avisos_config').select('url, tipos_activos').eq('id', true).single(),
    admin.from('avisos_salientes')
      .select('id, tipo, estado, motivo_descarte, intentos, ultimo_codigo, ultimo_error, prueba, created_at, enviado_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ])
  // Una consulta rota no puede pintarse como "sin envíos": mejor un error visible.
  if (cfg.error) throw new Error(`No se pudo leer la configuración de avisos: ${cfg.error.message}`)
  if (envios.error) throw new Error(`No se pudo leer el historial de avisos: ${envios.error.message}`)

  const base = appUrl()
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl">Avisos</h1>
        <p className="text-sm text-muted-foreground">
          Salen hacia el webhook de los flujos de Zapier o n8n, que deciden a qué canal va cada uno.
        </p>
      </header>
      <AvisosPanel
        url={(cfg.data.url as string | null) ?? ''}
        tiposActivos={(cfg.data.tipos_activos as string[] | null) ?? []}
        envios={(envios.data ?? []) as EnvioRow[]}
        consultas={[`${base}/api/avisos/v1/resumen-capacidad`, `${base}/api/avisos/v1/dias-sin-registrar`]}
      />
    </div>
  )
}
```

- [ ] **Step 4: Menú y cambio de nombre**

`components/AppShell.tsx`:
- En el import de `lucide-react`, añadir `Bell` a la lista.
- `title: 'Control de Horas',` → `title: 'Control de Rentabilidad',`
- En la sección Administración, después de la entrada de Auditoría:

```tsx
        { href: '/admin/avisos', label: 'Avisos', icon: Bell, show: isAdmin },
```

`app/(horas)/mis-registros/page.tsx`: en el antetítulo, `>Control de Horas</p>` → `>Control de Rentabilidad</p>` (la clase no cambia).

- [ ] **Step 5: Typecheck y build**

Run: `npx tsc --noEmit` y `npm run build`
Expected: sin errores; el build lista `/admin/avisos`.

Si el usuario tiene el dev server levantado (no arrancarlo), pedirle que abra `/admin/avisos` como admin y confirme que carga, que la lista muestra los 7 tipos pausados y que el menú dice «Control de Rentabilidad» y tiene «Avisos».

- [ ] **Step 6: Commit**

```bash
git add "app/(horas)/admin/avisos" components/horas/AvisosPanel.tsx components/AppShell.tsx "app/(horas)/mis-registros/page.tsx"
git commit -m "feat(avisos): pantalla de administración de avisos y nombre Control de Rentabilidad

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Manager directo en la edición de usuario

**Files:**
- Modify: `app/(horas)/admin/usuarios/actions.ts`, `app/(horas)/admin/usuarios/page.tsx`, `components/horas/UsuariosPanel.tsx`

**Interfaces:**
- Consumes: columna `profiles.manager_id` y el CHECK `profiles_manager_no_propio` (Task 1).
- Produces: `EdicionUsuario.managerId: string | null`; `UsuarioRow.managerId: string | null`; prop `managers: PosicionOpt[]` en `UsuariosPanel` y en `Editor`.

- [ ] **Step 1: Acción**

En `app/(horas)/admin/usuarios/actions.ts`, la interfaz queda:

```ts
export interface EdicionUsuario {
  full_name: string; positionId: string
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'; areaIds: string[]
  canCreateUsers: boolean
  managerId: string | null // manager directo: a quién escala el recordatorio de días sin registrar
}
```

En `actualizarUsuario`, justo después de la validación del nombre (`if (!input.full_name.trim()) …`):

```ts
  if (input.managerId && input.managerId === id) return { ok: false, error: 'Nadie puede ser su propio manager directo.' }
```

y en el objeto `patch`, añadir la propiedad:

```ts
    manager_id: input.managerId || null,
```

- [ ] **Step 2: Página**

En `app/(horas)/admin/usuarios/page.tsx`:
- `RawUsuario` suma `manager_id: string | null`.
- En el `select` de profiles, añadir `manager_id` tras `registro_dias_atras`.
- En el `map` a `UsuarioRow`, añadir `managerId: u.manager_id,`.
- Tras construir `usuarios`, calcular los candidatos a manager directo:

```ts
  // Candidatos a manager directo: managers y admins activos.
  const managers: PosicionOpt[] = usuarios
    .filter((u) => (u.role === 'manager' || u.role === 'admin') && u.status === 'activo')
    .map((u) => ({ id: u.id, name: u.full_name }))
```

- Pasarlos al panel: `<UsuariosPanel usuarios={usuarios} areas={areas} posiciones={posiciones} managers={managers} readOnly={!esAdmin} />`.

- [ ] **Step 3: Panel**

En `components/horas/UsuariosPanel.tsx`:
- `UsuarioRow` suma `managerId: string | null // manager directo; null = sin asignar`.
- `Editor` recibe `managers: PosicionOpt[]`: firma `function Editor({ u, areas, posiciones, managers, onDone }: { u: UsuarioRow; areas: AreaRow[]; posiciones: PosicionOpt[]; managers: PosicionOpt[]; onDone: () => void })`.
- Su estado inicial suma `managerId: u.managerId,` dentro del `useState<EdicionUsuario>({ … })`.
- Dentro del `grid gap-4 sm:grid-cols-2`, después del campo «Estado»:

```tsx
        <Field label="Manager directo">
          <NativeSelect
            aria-label="Editar manager directo" value={f.managerId ?? ''}
            onChange={(e) => setF({ ...f, managerId: e.target.value || null })} className={fieldSelect} fullWidth
          >
            <option value="">— Sin manager directo —</option>
            {managers.filter((m) => m.id !== u.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </NativeSelect>
        </Field>
```

- El componente por defecto recibe y reenvía la prop: firma `export default function UsuariosPanel({ usuarios, areas, posiciones, managers, readOnly = false }: { usuarios: UsuarioRow[]; areas: AreaRow[]; posiciones: PosicionOpt[]; managers: PosicionOpt[]; readOnly?: boolean })`, y `<Editor u={u} areas={areas} posiciones={posiciones} managers={managers} onDone={() => setEditing(null)} />`.

- [ ] **Step 4: Typecheck y build**

Run: `npx tsc --noEmit` y `npm run build`
Expected: sin errores (si algún otro sitio construye `UsuarioRow` o `EdicionUsuario`, tsc lo señala: añadirle `managerId`). No correr los E2E de usuarios: escriben en producción.

- [ ] **Step 5: Commit**

```bash
git add "app/(horas)/admin/usuarios/actions.ts" "app/(horas)/admin/usuarios/page.tsx" components/horas/UsuariosPanel.tsx
git commit -m "feat(usuarios): manager directo en la edición de usuario

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Puesta en producción y verificación

Esta tarea la hace el controlador con el usuario (hay pasos en Vercel y un push). No la delega en un subagente.

- [ ] **Step 1: Revisión final y gate**

Revisión final de todo el diff de la rama (subagent-driven-development la hace). Después:

Run: `npx tsc --noEmit` y `npm run build`
Expected: sin errores.

- [ ] **Step 2: Secretos**

Run: `node -e "for (const n of ['AVISOS_FIRMA_SECRETO', 'AVISOS_API_KEY', 'CRON_SECRET']) console.log(n + '=' + require('crypto').randomBytes(32).toString('hex'))"`

El usuario los carga en Vercel → Settings → Environment Variables (entorno **Production**), junto con `APP_URL` = el dominio de producción con `https://` y sin barra final. Nunca se escriben en archivos del repo. A Julián se le pasan por privado `AVISOS_FIRMA_SECRETO` (para verificar la firma) y `AVISOS_API_KEY` (para las consultas).

- [ ] **Step 3: Push (solo con el OK explícito del usuario)**

```bash
git push origin master:main
```

Esperar a que Vercel termine el deploy.

- [ ] **Step 4: Verificar en producción**

En las órdenes siguientes, `$APP_URL`, `$CRON_SECRET` y `$AVISOS_API_KEY` son los valores del paso 2.

1. `/admin/avisos` como admin: guardar la URL del webhook de pruebas de Julián (o una de webhook.site) y pulsar **Enviar prueba** en los 7 tipos. Expected: los 7 dicen «Enviado (HTTP 200)» y aparecen en «Últimos envíos» con la insignia Prueba.
2. Cron: `curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/avisos/cron"`. Expected: `{"ok":true,"despacho":{…}}`. Luego, con `execute_sql`:

```sql
select split_part(clave, ':', 1) as tipo, count(*) from public.avisos_estado group by 1;
select estado, count(*) from public.avisos_salientes where not prueba group by 1;
```

Expected: filas `banco` y `hucha` (la línea base) y **ningún** aviso real todavía (la línea base es silenciosa).

3. Consultas:

```bash
curl -s -H "Authorization: Bearer $AVISOS_API_KEY" "$APP_URL/api/avisos/v1/resumen-capacidad?top=5"
curl -s -H "Authorization: Bearer $AVISOS_API_KEY" "$APP_URL/api/avisos/v1/dias-sin-registrar"
curl -s -o /dev/null -w "%{http_code}\n" "$APP_URL/api/avisos/v1/resumen-capacidad"
```

Expected: JSON con la forma del contrato; el último, `401`. Contrastar un par de proyectos del resumen con `/bancos/<proyecto>`.

4. Con Julián (lunes): activar `registro.enviado`, hacer un alta real y comprobar en «Últimos envíos» que sale `enviado`. Después ir activando el resto de tipos.

- [ ] **Step 5: Dejar constancia**

- En `docs/avisos/contrato-avisos-v1.md`, fila `ultimo_registro` de «Días sin registrar»: «Último día que registró dentro de los últimos 90 días (`null` si no hay)».
- En `docs/superpowers/REGISTRO-DECISIONES-Y-ESTADO.md`, una sección «Avisos automáticos (Zapier/n8n)» con qué quedó en producción, las variables de entorno y lo pendiente de negocio (umbrales, festivos, manager directo de cada persona, cuarto día sin registrar).

```bash
git add docs/avisos/contrato-avisos-v1.md docs/superpowers/REGISTRO-DECISIONES-Y-ESTADO.md
git commit -m "docs(avisos): estado en producción y ajuste del contrato

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

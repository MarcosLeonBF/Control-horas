# Plan 2 — App HUCHA (Manager) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la interfaz del manager para la app de Presupuesto HUCHA: ver sus proyectos con saldo, ver el detalle e historial de un proyecto, y registrar consumos contra el presupuesto — sobre la fundación de datos del Plan 1.

**Architecture:** Next.js App Router. Un route group aislado `app/(hucha)/` con su propio layout (valida sesión + rol manager/admin). Las lecturas usan el cliente Supabase server (RLS: el manager solo ve lo suyo). El registro de consumo es una **Server Action** que llama al RPC `registrar_movimiento_hucha`. UI con shadcn/ui sobre una capa de design tokens. Pruebas **E2E con Playwright** (happy-path real contra Supabase).

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript, Tailwind v4, shadcn/ui, `@supabase/ssr`, Playwright, `next/font`.

## Global Constraints

- Nombre **HUCHA** (con H) en UI, rutas y copy. Moneda **EUR**, formato `es-ES` (`1.234,56 €`).
- No tocar el legacy de Horas (`app/(app)/...`, `time_entries`). Construir en paralelo en `app/(hucha)/`.
- Lecturas de datos HUCHA con el **cliente server normal** (anon key + cookies del usuario), NUNCA con `createAdminClient` (service role) en páginas — la seguridad la da RLS.
- Escritura de consumo SOLO vía Server Action que llama `supabase.rpc('registrar_movimiento_hucha', …)`. Nunca insertar movimientos ni tocar saldos desde el cliente.
- 3 roles: `operativo` / `manager` / `admin`. El área HUCHA es para `manager` y `admin`.
- TypeScript estricto: prohibido `any`. Tipar las filas de Supabase.
- **Dirección estética "Estudio" (editorial / suizo): formal, elegante, atemporal, cómoda.** Es el **design system de TODA la plataforma** (Control de Horas como producto principal + HUCHA), no solo HUCHA: los tokens y fuentes viven en `app/globals.css` y `app/layout.tsx` (raíz) y aplican app-wide.
  - Tipografía: títulos **Fraunces** (serif con carácter), cuerpo **Geist Sans**, cifras de dinero en **Geist Mono** (tabular). NO Inter/Roboto.
  - Paleta de **marca Bastida & Farina** (CSS variables, hex exacto): fondo papel cálido `--background: #FAF7F5`; tarjeta `--card: #FFFFFF`; tinta `--foreground: #1D1D1B`; texto secundario `--muted-foreground: #7A716B`; borde `--border: #ECE4DF`. Marca: **carmín** `--brand: #BD0842` (acción/links/nav activa/foco), `--brand-strong: #A0073A` (hover), **vino** `--wine: #54123D` (wordmark/títulos/superficies profundas). Estados: disponible `#157F5B`, bajo `#B5760A`, consumido `#6B6560`, excedido `#A0073A` (carmín = sobre presupuesto), sin_presupuesto `#9A938D`. **Botón primario = carmín sólido.** Además mapear shadcn `--primary`/`--ring` a carmín.
  - Superficies: borde hairline 1px, sombra suave, radio `lg`, grid 8pt, espaciado generoso.
  - UX: badges color+texto (accesible AA), empty states, skeletons de carga, toasts de feedback, focus rings visibles, responsive (cards en móvil / tabla en ≥md), confirmación al exceder presupuesto, reveal escalonado sutil al cargar.
- Alcance: **solo manager**. La gestión de usuarios/proyectos, ampliación, dashboard global y exports son del Plan 3. La descarga del manager (decisión revisable) también se difiere al Plan 3 para centralizar la lógica de export.

## Prerrequisitos de ejecución
- Supabase MCP activo; project_id **`msfylcgtlathccmxuheq`**. La fundación del Plan 1 está aplicada.
- `.env.local` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Trabajo directo sobre `master`, commits directos.

---

## File Structure

- `lib/fonts.ts` — carga de fuentes con `next/font` (Fraunces, Geist Sans, Geist Mono).
- `app/globals.css` — design tokens (CSS variables) del tema Estudio (modificar el existente con cuidado de no romper legacy).
- `lib/hucha/format.ts` — formateo de dinero EUR y helpers de estado.
- `lib/hucha/types.ts` — tipos TS de las filas HUCHA (bank, movement, project).
- `lib/hucha/queries.ts` — funciones server que leen proyectos/banco/movimientos del manager (RLS).
- `components/hucha/StatusBadge.tsx` — badge de estado del presupuesto.
- `components/hucha/HuchaNav.tsx` — navegación del área HUCHA.
- `app/(hucha)/presupuestos/layout.tsx` — layout con auth + gate de rol + nav.
- `app/(hucha)/presupuestos/page.tsx` — "Mis proyectos".
- `app/(hucha)/presupuestos/[id]/page.tsx` — detalle + historial.
- `app/(hucha)/presupuestos/[id]/actions.ts` — Server Action `registrarConsumo`.
- `app/(hucha)/presupuestos/[id]/ConsumoForm.tsx` — form de consumo (client).
- `app/page.tsx` — modificar: redirección por rol.
- `app/login/page.tsx` — modificar: redirigir a `/` tras login.
- `lib/supabase/middleware.ts` — modificar: redirección autenticado→`/`.
- `e2e/` — Playwright: `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/global-teardown.ts`, `e2e/helpers/seed.ts`, `e2e/*.spec.ts`.

---

## Task 1: Design system + shadcn/ui + Playwright harness + seed

**Files:**
- Create: `lib/fonts.ts`, `lib/hucha/format.ts`, `components.json` (shadcn), `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/global-teardown.ts`, `e2e/helpers/seed.ts`, `e2e/smoke.spec.ts`
- Modify: `app/globals.css`, `app/layout.tsx`, `package.json` (scripts)

**Interfaces:**
- Produces:
  - `lib/fonts.ts` exports `fraunces`, `geistSans`, `geistMono` (each a `next/font` object with a `.variable` class).
  - `lib/hucha/format.ts` exports `formatEUR(n: number): string` (→ `"1.234,56 €"`, locale es-ES) and `STATUS_LABELS: Record<string,string>`.
  - `e2e/helpers/seed.ts` exports `seedManagerFixture(): Promise<{ managerEmail: string; managerPassword: string; projectAssignedId: string; projectUnassignedId: string }>` and `cleanupFixture(): Promise<void>`.
  - Playwright `webServer` runs the app at `http://localhost:3000`; `storageState` for the manager saved at `e2e/.auth/manager.json`.

- [ ] **Step 1: Install dependencies and init shadcn**

Run:
```bash
npm install -D @playwright/test dotenv
npx playwright install chromium
npm install geist
npx shadcn@latest init -d
npx shadcn@latest add button card table badge input label dialog sonner skeleton
```
Expected: `components.json` created, `components/ui/*` added, `geist` + Playwright installed. (If `shadcn init` prompts despite `-d`, accept defaults: TypeScript, Tailwind, `app/globals.css`, CSS variables = yes.)

- [ ] **Step 2: Write the fonts module**

Create `lib/fonts.ts`:
```ts
import { Fraunces } from 'next/font/google'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'

export const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
})

export const geistSans = GeistSans   // exposes .variable = '--font-geist-sans'
export const geistMono = GeistMono   // exposes .variable = '--font-geist-mono'
```

- [ ] **Step 3: Wire fonts + design tokens**

Modify `app/layout.tsx` to add the font variables to `<html>` (keep existing structure; add `className={\`${fraunces.variable} ${geistSans.variable} ${geistMono.variable}\`}` to the `<html>` tag and import from `@/lib/fonts`).

Append the Estudio tokens to `app/globals.css` (do not remove existing rules):
```css
:root {
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-display), Georgia, serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;

  /* Estudio · Bastida & Farina (hex de marca) */
  --background: #FAF7F5;        /* papel cálido */
  --foreground: #1D1D1B;        /* tinta */
  --card: #FFFFFF;
  --muted-surface: #F4EFEC;     /* relleno sutil (cabeceras de tabla) */
  --border: #ECE4DF;            /* hairline */
  --muted-foreground: #7A716B;  /* texto secundario */

  --brand: #BD0842;             /* carmín (insignia) */
  --brand-strong: #A0073A;      /* carmín oscuro (hover) */
  --wine: #54123D;              /* vino/berenjena */

  /* estados HUCHA */
  --status-disponible: #157F5B;
  --status-bajo: #B5760A;
  --status-consumido: #6B6560;
  --status-excedido: #A0073A;
  --status-sin: #9A938D;
}

/* Mapear los primitivos de shadcn a la marca (en el bloque @theme/:root que genera shadcn,
   fijar): --primary: #BD0842; --primary-foreground: #FFFFFF; --ring: #BD0842; --background: #FAF7F5;
   --foreground: #1D1D1B; --card: #FFFFFF; --border: #ECE4DF; --muted-foreground: #7A716B;
   Resolver duplicados de :root fusionando; los valores de marca ganan. */

.font-display { font-family: var(--font-display); }
.tabular-money { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 4: Write the money/format helper**

Create `lib/hucha/format.ts`:
```ts
const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

export function formatEUR(n: number): string {
  return EUR.format(n)
}

export const STATUS_LABELS: Record<string, string> = {
  sin_presupuesto: 'Sin presupuesto',
  disponible: 'Disponible',
  bajo: 'Bajo',
  consumido: 'Consumido',
  excedido: 'Excedido',
}
```

- [ ] **Step 5: Write the E2E seed helper**

Create `e2e/helpers/seed.ts`:
```ts
import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const MANAGER_EMAIL = 'e2e-manager@hucha.test'
const MANAGER_PASSWORD = 'E2e-Manager-Pass-123'

export async function seedManagerFixture() {
  await cleanupFixture()

  // 1) Manager auth user (trigger crea el profile como 'operativo')
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: MANAGER_EMAIL,
    password: MANAGER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Manager E2E' },
  })
  if (cErr) throw cErr
  const managerId = created.user!.id
  await admin.from('profiles').update({ role: 'manager', status: 'activo' }).eq('id', managerId)

  // 2) Proyecto asignado (trigger crea el banco en 0) + asignación
  const { data: pA } = await admin.from('projects').insert({ name: 'Cliente E2E Asignado', client: 'ACME' }).select('id').single()
  const projectAssignedId = pA!.id as string
  await admin.from('project_assignments').insert({ project_id: projectAssignedId, user_id: managerId })

  // 3) Proyecto NO asignado (para probar aislamiento)
  const { data: pB } = await admin.from('projects').insert({ name: 'Cliente E2E NoAsignado' }).select('id').single()
  const projectUnassignedId = pB!.id as string

  // 4) Financiar el banco del proyecto asignado: 500 € (movimiento ampliacion + cache)
  const { data: bank } = await admin.from('hucha_banks').select('id').eq('project_id', projectAssignedId).single()
  const bankId = bank!.id as string
  await admin.from('hucha_movements').insert({
    bank_id: bankId, type: 'ampliacion', amount: 500,
    balance_before: 0, balance_after: 500, reason: 'Carga inicial E2E',
    actor_name: 'Seed', entry_date: new Date().toISOString().slice(0, 10),
  })
  await admin.from('hucha_banks').update({
    assigned_total: 500, consumed_total: 0, remaining: 500, status: 'disponible',
  }).eq('id', bankId)

  return { managerEmail: MANAGER_EMAIL, managerPassword: MANAGER_PASSWORD, projectAssignedId, projectUnassignedId }
}

export async function cleanupFixture() {
  const { data: list } = await admin.auth.admin.listUsers()
  const u = list?.users.find((x) => x.email === MANAGER_EMAIL)
  // projects de E2E (cascade borra banks/movements/assignments)
  await admin.from('projects').delete().like('name', 'Cliente E2E%')
  if (u) await admin.auth.admin.deleteUser(u.id)
}
```

- [ ] **Step 6: Write Playwright config + global setup/teardown**

Create `playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { storageState: 'e2e/.auth/manager.json' } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

Create `e2e/global-setup.ts`:
```ts
import { chromium } from '@playwright/test'
import { seedManagerFixture } from './helpers/seed'
import fs from 'node:fs'

export default async function globalSetup() {
  const fixture = await seedManagerFixture()
  fs.mkdirSync('e2e/.auth', { recursive: true })
  fs.writeFileSync('e2e/.fixture.json', JSON.stringify(fixture))

  // Login real por UI → guarda storageState
  const browser = await chromium.launch()
  const page = await browser.newPage({ baseURL: 'http://localhost:3000' })
  await page.goto('/login')
  await page.getByLabel('Email').fill(fixture.managerEmail)
  await page.getByLabel('Contraseña').fill(fixture.managerPassword)
  await page.getByRole('button', { name: /ingresar/i }).click()
  await page.waitForURL('**/presupuestos')
  await page.context().storageState({ path: 'e2e/.auth/manager.json' })
  await browser.close()
}
```

Create `e2e/global-teardown.ts`:
```ts
import { cleanupFixture } from './helpers/seed'

export default async function globalTeardown() {
  await cleanupFixture()
}
```

Add to `package.json` scripts: `"test:e2e": "playwright test"`.

- [ ] **Step 7: Write the smoke test**

Create `e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('login page renders', async ({ page }) => {
  // storageState autentica al manager; /login redirige a la app autenticada
  await page.goto('/login')
  await expect(page).toHaveURL(/presupuestos|registrar|\/$/)
})
```

> Note: global-setup ya depende de que el área `/presupuestos` exista (Task 2). Para que la Task 1 sea verificable de forma aislada, en este punto el smoke test se ejecuta con un **stub temporal**: crear `app/(hucha)/presupuestos/page.tsx` mínimo que renderice `<main>HUCHA</main>` y un `layout.tsx` mínimo que solo verifique sesión (sin gate de rol todavía). Task 2 los reemplaza por las versiones completas. Esto evita acoplar la verificación de la Task 1 a la 2.

Stub `app/(hucha)/presupuestos/layout.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function HuchaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <>{children}</>
}
```
Stub `app/(hucha)/presupuestos/page.tsx`:
```tsx
export default function Page() { return <main>HUCHA</main> }
```

- [ ] **Step 8: Run the smoke test → PASS**

Run: `npm run test:e2e -- smoke`
Expected: 1 passed. (Playwright levanta el dev server, global-setup siembra el manager y guarda storageState, el test confirma que la app autenticada carga.)

- [ ] **Step 9: Commit**
```bash
git add lib/fonts.ts lib/hucha/format.ts components.json components/ui app/globals.css app/layout.tsx playwright.config.ts e2e package.json package-lock.json "app/(hucha)"
git commit -m "feat(hucha): design tokens Estudio + shadcn + Playwright harness + seed"
```

---

## Task 2: Área HUCHA — layout con gate de rol + navegación + ruteo por rol

**Files:**
- Modify: `app/(hucha)/presupuestos/layout.tsx` (reemplaza el stub), `app/page.tsx`, `app/login/page.tsx`, `lib/supabase/middleware.ts`
- Create: `components/hucha/HuchaNav.tsx`
- Test: `e2e/acceso.spec.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/server`.
- Produces: layout que garantiza `user` con `profiles.role in ('manager','admin')`; `app/page.tsx` redirige por rol.

- [ ] **Step 1: Write the failing test**

Create `e2e/acceso.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('manager autenticado aterriza en /presupuestos desde la raíz', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/presupuestos$/)
  await expect(page.getByRole('link', { name: /presupuestos/i })).toBeVisible()
})

test('logout redirige a login y bloquea el área', async ({ page, context }) => {
  await page.goto('/presupuestos')
  await page.getByRole('button', { name: /salir/i }).click()
  await expect(page).toHaveURL(/\/login$/)
  await context.clearCookies()
  await page.goto('/presupuestos')
  await expect(page).toHaveURL(/\/login$/)
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm run test:e2e -- acceso`
Expected: FAIL — la raíz redirige a `/registrar` (no `/presupuestos`) y no hay nav ni botón "Salir".

- [ ] **Step 3: Implement the nav**

Create `components/hucha/HuchaNav.tsx`:
```tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function HuchaNav({ displayName }: { displayName: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const active = pathname.startsWith('/presupuestos')

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto max-w-5xl px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-display text-lg font-semibold tracking-tight">HUCHA</span>
          <nav>
            <Link
              href="/presupuestos"
              className={`text-sm transition-colors ${active ? 'text-foreground font-medium' : 'text-foreground/60 hover:text-foreground'}`}
            >
              Presupuestos
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-foreground/50 hidden sm:block">{displayName}</span>
          <button onClick={logout} className="text-xs text-foreground/60 hover:text-foreground transition-colors">
            Salir
          </button>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Implement the layout with role gate**

Replace `app/(hucha)/presupuestos/layout.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HuchaNav from '@/components/hucha/HuchaNav'

export default async function HuchaLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (!profile || (profile.role !== 'manager' && profile.role !== 'admin')) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <HuchaNav displayName={profile.full_name || user.email!} />
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  )
}
```

- [ ] **Step 5: Implement role-based routing**

Replace `app/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'manager' || profile?.role === 'admin') redirect('/presupuestos')
  redirect('/registrar')
}
```

In `app/login/page.tsx`, change the post-login redirect from `router.push('/registrar')` to `router.push('/')` (and keep `router.refresh()`).

In `lib/supabase/middleware.ts`, change the authenticated-on-login redirect target from `url.pathname = '/registrar'` to `url.pathname = '/'`.

- [ ] **Step 6: Run → PASS**

Run: `npm run test:e2e -- acceso`
Expected: 2 passed.

- [ ] **Step 7: Commit**
```bash
git add "app/(hucha)/presupuestos/layout.tsx" components/hucha/HuchaNav.tsx app/page.tsx app/login/page.tsx lib/supabase/middleware.ts e2e/acceso.spec.ts
git commit -m "feat(hucha): layout con gate de rol, nav y ruteo por rol tras login"
```

---

## Task 3: "Mis proyectos" — lista con saldo y estado

**Files:**
- Create: `lib/hucha/types.ts`, `lib/hucha/queries.ts`, `components/hucha/StatusBadge.tsx`
- Modify: `app/(hucha)/presupuestos/page.tsx` (reemplaza el stub)
- Test: `e2e/mis-proyectos.spec.ts`

**Interfaces:**
- Consumes: `createClient` (server), `formatEUR`, `STATUS_LABELS`.
- Produces:
  - `lib/hucha/types.ts`: `HuchaBankRow` (`{ id: string; project_id: string; currency: string; assigned_total: number; consumed_total: number; remaining: number; status: HuchaStatus }`), `HuchaStatus = 'sin_presupuesto'|'disponible'|'bajo'|'consumido'|'excedido'`, `ProjectWithBank` (`{ id: string; name: string; client: string | null; bank: HuchaBankRow }`), `HuchaMovementRow`.
  - `lib/hucha/queries.ts`: `getMyProjectsWithBanks(): Promise<ProjectWithBank[]>`, `getProjectWithBank(id: string): Promise<ProjectWithBank | null>`, `getMovements(bankId: string): Promise<HuchaMovementRow[]>`.
  - `components/hucha/StatusBadge.tsx`: default export `StatusBadge({ status }: { status: HuchaStatus })`.

- [ ] **Step 1: Write the failing test**

Create `e2e/mis-proyectos.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('el manager ve su proyecto asignado con el saldo correcto', async ({ page }) => {
  await page.goto('/presupuestos')
  const card = page.getByRole('link', { name: /Cliente E2E Asignado/ })
  await expect(card).toBeVisible()
  await expect(card).toContainText('500,00') // asignado/restante en EUR
  await expect(card).toContainText('Disponible')
})

test('el manager NO ve proyectos que no le fueron asignados', async ({ page }) => {
  await page.goto('/presupuestos')
  await expect(page.getByText('Cliente E2E NoAsignado')).toHaveCount(0)
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm run test:e2e -- mis-proyectos`
Expected: FAIL — el stub renderiza solo "HUCHA".

- [ ] **Step 3: Implement types**

Create `lib/hucha/types.ts`:
```ts
export type HuchaStatus = 'sin_presupuesto' | 'disponible' | 'bajo' | 'consumido' | 'excedido'

export interface HuchaBankRow {
  id: string
  project_id: string
  currency: string
  assigned_total: number
  consumed_total: number
  remaining: number
  status: HuchaStatus
}

export interface ProjectWithBank {
  id: string
  name: string
  client: string | null
  bank: HuchaBankRow
}

export interface HuchaMovementRow {
  id: string
  type: 'consumo' | 'ampliacion' | 'correccion' | 'anulacion'
  amount: number
  balance_before: number
  balance_after: number
  description: string | null
  reference: string | null
  reason: string | null
  actor_name: string
  entry_date: string
  created_at: string
}
```

- [ ] **Step 4: Implement queries**

Create `lib/hucha/queries.ts`:
```ts
import { createClient } from '@/lib/supabase/server'
import type { ProjectWithBank, HuchaBankRow, HuchaMovementRow } from './types'

export async function getMyProjectsWithBanks(): Promise<ProjectWithBank[]> {
  const supabase = await createClient()
  // RLS limita a proyectos asignados (manager) o todos (admin)
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client, hucha_banks!inner(id, project_id, currency, assigned_total, consumed_total, remaining, status)')
    .eq('status', 'activo')
    .order('name')
  if (error) throw error
  return (data ?? []).map((p) => ({
    id: p.id, name: p.name, client: p.client,
    bank: (Array.isArray(p.hucha_banks) ? p.hucha_banks[0] : p.hucha_banks) as HuchaBankRow,
  }))
}

export async function getProjectWithBank(id: string): Promise<ProjectWithBank | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client, hucha_banks!inner(id, project_id, currency, assigned_total, consumed_total, remaining, status)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id, name: data.name, client: data.client,
    bank: (Array.isArray(data.hucha_banks) ? data.hucha_banks[0] : data.hucha_banks) as HuchaBankRow,
  }
}

export async function getMovements(bankId: string): Promise<HuchaMovementRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('hucha_movements')
    .select('id, type, amount, balance_before, balance_after, description, reference, reason, actor_name, entry_date, created_at')
    .eq('bank_id', bankId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as HuchaMovementRow[]
}
```

- [ ] **Step 5: Implement the StatusBadge**

Create `components/hucha/StatusBadge.tsx`:
```tsx
import type { HuchaStatus } from '@/lib/hucha/types'
import { STATUS_LABELS } from '@/lib/hucha/format'

const STYLES: Record<HuchaStatus, string> = {
  disponible: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  bajo: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  consumido: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  excedido: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  sin_presupuesto: 'bg-neutral-100 text-neutral-500 ring-neutral-400/20',
}

export default function StatusBadge({ status }: { status: HuchaStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}
```

- [ ] **Step 6: Implement the list page**

Replace `app/(hucha)/presupuestos/page.tsx`:
```tsx
import Link from 'next/link'
import { getMyProjectsWithBanks } from '@/lib/hucha/queries'
import { formatEUR } from '@/lib/hucha/format'
import StatusBadge from '@/components/hucha/StatusBadge'

export default async function MisProyectosPage() {
  const projects = await getMyProjectsWithBanks()

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Mis presupuestos</h1>
        <p className="mt-1 text-sm text-foreground/55">
          {projects.length} {projects.length === 1 ? 'proyecto' : 'proyectos'} asignado{projects.length === 1 ? '' : 's'}
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-foreground/55">
          No tienes proyectos asignados todavía.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/presupuestos/${p.id}`}
              className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:border-(--brand)/40"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium leading-tight">{p.name}</h2>
                  {p.client && <p className="mt-0.5 text-xs text-foreground/50">{p.client}</p>}
                </div>
                <StatusBadge status={p.bank.status} />
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-foreground/50">Restante</p>
                  <p className="tabular-money text-2xl font-semibold">{formatEUR(p.bank.remaining)}</p>
                </div>
                <div className="text-right text-xs text-foreground/50">
                  <p>Asignado <span className="tabular-money text-foreground/70">{formatEUR(p.bank.assigned_total)}</span></p>
                  <p>Consumido <span className="tabular-money text-foreground/70">{formatEUR(p.bank.consumed_total)}</span></p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Run → PASS**

Run: `npm run test:e2e -- mis-proyectos`
Expected: 2 passed.

- [ ] **Step 8: Commit**
```bash
git add lib/hucha/types.ts lib/hucha/queries.ts components/hucha/StatusBadge.tsx "app/(hucha)/presupuestos/page.tsx" e2e/mis-proyectos.spec.ts
git commit -m "feat(hucha): Mis proyectos con saldo, estado y aislamiento por RLS"
```

---

## Task 4: Detalle de proyecto + historial de movimientos

**Files:**
- Create: `app/(hucha)/presupuestos/[id]/page.tsx`, `components/hucha/MovementsTable.tsx`
- Test: `e2e/detalle.spec.ts`

**Interfaces:**
- Consumes: `getProjectWithBank`, `getMovements`, `formatEUR`, `StatusBadge`, `HuchaMovementRow`.
- Produces: página de detalle en `/presupuestos/[id]`; `MovementsTable({ movements }: { movements: HuchaMovementRow[] })`.

- [ ] **Step 1: Write the failing test**

Create `e2e/detalle.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const fixture = JSON.parse(fs.readFileSync('e2e/.fixture.json', 'utf8'))

test('el detalle muestra el saldo y el historial', async ({ page }) => {
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)
  await expect(page.getByRole('heading', { name: /Cliente E2E Asignado/ })).toBeVisible()
  await expect(page.getByText('Restante')).toBeVisible()
  await expect(page.locator('.tabular-money').first()).toContainText('500,00')
  // el historial muestra la carga inicial (ampliacion)
  await expect(page.getByText('Carga inicial E2E')).toBeVisible()
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm run test:e2e -- detalle`
Expected: FAIL — la ruta `[id]` no existe (404).

- [ ] **Step 3: Implement the movements table**

Create `components/hucha/MovementsTable.tsx`:
```tsx
import type { HuchaMovementRow } from '@/lib/hucha/types'
import { formatEUR } from '@/lib/hucha/format'

const TYPE_LABELS: Record<HuchaMovementRow['type'], string> = {
  consumo: 'Consumo', ampliacion: 'Ampliación', correccion: 'Corrección', anulacion: 'Anulación',
}

export default function MovementsTable({ movements }: { movements: HuchaMovementRow[] }) {
  if (movements.length === 0) {
    return <p className="text-sm text-foreground/55">Sin movimientos todavía.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-(--muted-surface) text-left text-xs text-foreground/55">
          <tr>
            <th className="px-4 py-3 font-medium">Fecha</th>
            <th className="px-4 py-3 font-medium">Tipo</th>
            <th className="px-4 py-3 font-medium">Descripción</th>
            <th className="px-4 py-3 font-medium text-right">Importe</th>
            <th className="px-4 py-3 font-medium text-right">Saldo</th>
            <th className="px-4 py-3 font-medium">Por</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {movements.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-3 text-foreground/70">{m.entry_date}</td>
              <td className="px-4 py-3">{TYPE_LABELS[m.type]}</td>
              <td className="px-4 py-3 text-foreground/70">{m.description ?? m.reason ?? '—'}</td>
              <td className={`px-4 py-3 text-right tabular-money ${m.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                {m.amount < 0 ? '' : '+'}{formatEUR(m.amount)}
              </td>
              <td className="px-4 py-3 text-right tabular-money text-foreground/70">{formatEUR(m.balance_after)}</td>
              <td className="px-4 py-3 text-foreground/55">{m.actor_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Implement the detail page**

Create `app/(hucha)/presupuestos/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getProjectWithBank, getMovements } from '@/lib/hucha/queries'
import { formatEUR } from '@/lib/hucha/format'
import StatusBadge from '@/components/hucha/StatusBadge'
import MovementsTable from '@/components/hucha/MovementsTable'

export default async function DetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const project = await getProjectWithBank(id)
  if (!project) notFound()
  const movements = await getMovements(project.bank.id)

  return (
    <div>
      <Link href="/presupuestos" className="text-xs text-foreground/55 hover:text-foreground">← Mis presupuestos</Link>

      <header className="mt-3 mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{project.name}</h1>
          {project.client && <p className="mt-1 text-sm text-foreground/55">{project.client}</p>}
        </div>
        <StatusBadge status={project.bank.status} />
      </header>

      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Asignado', value: project.bank.assigned_total },
          { label: 'Consumido', value: project.bank.consumed_total },
          { label: 'Restante', value: project.bank.remaining },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="text-xs text-foreground/50">{s.label}</p>
            <p className="tabular-money mt-1 text-2xl font-semibold">{formatEUR(s.value)}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="font-display mb-4 text-xl font-semibold">Historial</h2>
        <MovementsTable movements={movements} />
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Run → PASS**

Run: `npm run test:e2e -- detalle`
Expected: 1 passed.

- [ ] **Step 6: Commit**
```bash
git add "app/(hucha)/presupuestos/[id]/page.tsx" components/hucha/MovementsTable.tsx e2e/detalle.spec.ts
git commit -m "feat(hucha): detalle de proyecto con saldo e historial de movimientos"
```

---

## Task 5: Registrar consumo (Server Action + formulario)

**Files:**
- Create: `app/(hucha)/presupuestos/[id]/actions.ts`, `app/(hucha)/presupuestos/[id]/ConsumoForm.tsx`
- Modify: `app/(hucha)/presupuestos/[id]/page.tsx` (montar el form), `app/layout.tsx` (montar `<Toaster />` de sonner)
- Test: `e2e/registrar-consumo.spec.ts`

**Interfaces:**
- Consumes: `createClient` (server), `getProjectWithBank` (para el saldo disponible).
- Produces:
  - `registrarConsumo(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }>` (Server Action, `'use server'`). Lee `project_id`, `amount`, `description`, `entry_date`; llama `supabase.rpc('registrar_movimiento_hucha', { p_project_id, p_type: 'consumo', p_amount, p_description, p_entry_date })`; en éxito `revalidatePath('/presupuestos/[id]','page')` y `revalidatePath('/presupuestos')`.
  - `ConsumoForm({ projectId, remaining }: { projectId: string; remaining: number })` (client).

- [ ] **Step 1: Write the failing test**

Create `e2e/registrar-consumo.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import fs from 'node:fs'

const fixture = JSON.parse(fs.readFileSync('e2e/.fixture.json', 'utf8'))

test('registrar un consumo descuenta el saldo y aparece en el historial', async ({ page }) => {
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)

  await page.getByRole('button', { name: /registrar consumo/i }).click()
  await page.getByLabel(/importe/i).fill('120')
  await page.getByLabel(/descripción/i).fill('Compra recurso E2E')
  await page.getByRole('button', { name: /guardar/i }).click()

  // saldo restante 500 - 120 = 380
  await expect(page.locator('.tabular-money').filter({ hasText: '380,00' }).first()).toBeVisible()
  // historial muestra el consumo
  await expect(page.getByText('Compra recurso E2E')).toBeVisible()
  await expect(page.getByText('120,00').first()).toBeVisible()
})

test('validación: importe vacío no envía', async ({ page }) => {
  await page.goto(`/presupuestos/${fixture.projectAssignedId}`)
  await page.getByRole('button', { name: /registrar consumo/i }).click()
  await page.getByLabel(/descripción/i).fill('sin importe')
  await page.getByRole('button', { name: /guardar/i }).click()
  await expect(page.getByText(/importe.*mayor a 0/i)).toBeVisible()
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm run test:e2e -- registrar-consumo`
Expected: FAIL — no existe el botón "Registrar consumo".

- [ ] **Step 3: Implement the Server Action**

Create `app/(hucha)/presupuestos/[id]/actions.ts`:
```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function registrarConsumo(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const projectId = String(formData.get('project_id') ?? '')
  const amount = Number(formData.get('amount'))
  const description = String(formData.get('description') ?? '').trim()
  const entryDate = String(formData.get('entry_date') ?? '')

  if (!projectId) return { ok: false, error: 'Proyecto inválido.' }
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'El importe debe ser mayor a 0.' }
  if (!description) return { ok: false, error: 'La descripción es obligatoria.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('registrar_movimiento_hucha', {
    p_project_id: projectId,
    p_type: 'consumo',
    p_amount: amount,
    p_description: description,
    p_entry_date: entryDate || undefined,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/presupuestos/${projectId}`)
  revalidatePath('/presupuestos')
  return { ok: true }
}
```

- [ ] **Step 4: Implement the form**

Create `app/(hucha)/presupuestos/[id]/ConsumoForm.tsx`:
```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { registrarConsumo } from './actions'
import { formatEUR } from '@/lib/hucha/format'

function todayISO() { return new Date().toISOString().slice(0, 10) }

export default function ConsumoForm({ projectId, remaining }: { projectId: string; remaining: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [entryDate, setEntryDate] = useState(todayISO())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const numericAmount = Number(amount)
  const willExceed = Number.isFinite(numericAmount) && numericAmount > remaining

  function reset() {
    setAmount(''); setDescription(''); setEntryDate(todayISO()); setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('El importe debe ser mayor a 0.'); return
    }
    if (!description.trim()) { setError('La descripción es obligatoria.'); return }
    if (willExceed && !confirm('Este consumo excederá el presupuesto disponible. ¿Continuar?')) return

    const fd = new FormData()
    fd.set('project_id', projectId)
    fd.set('amount', amount)
    fd.set('description', description)
    fd.set('entry_date', entryDate)

    startTransition(async () => {
      const res = await registrarConsumo(fd)
      if (!res.ok) { setError(res.error); return }
      toast.success('Consumo registrado')
      reset(); setOpen(false); router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-(--brand) px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Registrar consumo
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-md">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Registrar consumo</h3>
        <span className="text-xs text-foreground/50">Disponible: <span className="tabular-money">{formatEUR(remaining)}</span></span>
      </div>
      <div className="space-y-3">
        <div>
          <label htmlFor="amount" className="mb-1 block text-sm font-medium">Importe (€)</label>
          <input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--brand)" placeholder="0,00" />
        </div>
        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium">Descripción</label>
          <input id="description" value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--brand)" placeholder="Motivo del consumo" />
        </div>
        <div>
          <label htmlFor="entry_date" className="mb-1 block text-sm font-medium">Fecha</label>
          <input id="entry_date" type="date" max={todayISO()} value={entryDate} onChange={(e) => setEntryDate(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--brand)" />
        </div>
        {willExceed && <p className="text-xs text-amber-700">Atención: excede el presupuesto disponible.</p>}
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={pending}
            className="rounded-lg bg-(--brand) px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" onClick={() => { reset(); setOpen(false) }}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 hover:text-foreground">Cancelar</button>
        </div>
      </div>
    </form>
  )
}
```

- [ ] **Step 5: Mount the form and the Toaster**

In `app/(hucha)/presupuestos/[id]/page.tsx`, import `ConsumoForm` and render it in the header area, e.g. after the status badge block, passing `projectId={project.id}` and `remaining={project.bank.remaining}`:
```tsx
import ConsumoForm from './ConsumoForm'
// …inside the returned JSX, below the <header>:
<div className="mb-10"><ConsumoForm projectId={project.id} remaining={project.bank.remaining} /></div>
```

In `app/layout.tsx`, add the sonner Toaster inside `<body>` (after `{children}`):
```tsx
import { Toaster } from '@/components/ui/sonner'
// …inside <body>: {children}<Toaster richColors position="top-center" />
```

- [ ] **Step 6: Run → PASS**

Run: `npm run test:e2e -- registrar-consumo`
Expected: 2 passed (consumo descuenta + aparece en historial; validación de importe).

- [ ] **Step 7: Run the full E2E suite (regression)**

Run: `npm run test:e2e`
Expected: todos los specs verdes (smoke, acceso, mis-proyectos, detalle, registrar-consumo).

- [ ] **Step 8: Commit**
```bash
git add "app/(hucha)/presupuestos/[id]/actions.ts" "app/(hucha)/presupuestos/[id]/ConsumoForm.tsx" "app/(hucha)/presupuestos/[id]/page.tsx" app/layout.tsx e2e/registrar-consumo.spec.ts
git commit -m "feat(hucha): registrar consumo (Server Action + RPC) con validación y feedback"
```

---

## Self-Review (completado por el autor del plan)

**Cobertura del spec (Plan 2 = manager UI):**
- §4.1 manager ve proyectos asignados → Task 3 (RLS-scoped). ✅
- §4.1 ve presupuesto disponible → Task 3 (cards) + Task 4 (detalle). ✅
- §6 registro individual de consumo + descuento automático → Task 5 (Server Action → RPC). ✅
- §6.1 form (proyecto, disponible auto, importe, descripción, fecha default hoy, usuario auto) → Task 5. ✅
- §9 historial de movimientos → Task 4. ✅
- §10 validaciones cliente (monto>0, descripción, fecha no futura) → Task 5 (cliente) + RPC (autoridad). ✅
- §10 sobreconsumo permitido con aviso → Task 5 (confirm). ✅
- §11 estados (badge) → Task 3/StatusBadge. ✅
- §15 flujo manager (login → proyectos → detalle → registrar → historial) → Tasks 2-5. ✅
- Aislamiento por RLS (no ve lo no asignado) → Task 3 test. ✅
- Estética Estudio (editorial/suizo) + UX cómoda → Task 1 (tokens/fonts) aplicada en todas las pantallas. ✅

**Fuera de alcance (Plan 3):** gestión de usuarios/proyectos, ampliación, corrección/anulación desde UI, dashboard global con filtros, descargas Excel/CSV (incluida la del manager). Correcto.

**Placeholders:** ninguno — todo el código está completo.

**Consistencia de tipos:** `ProjectWithBank`/`HuchaBankRow`/`HuchaMovementRow`/`HuchaStatus` se definen en Task 3 (`lib/hucha/types.ts`) y se consumen con las mismas firmas en Tasks 4-5. La firma del RPC `registrar_movimiento_hucha(p_project_id, p_type, p_amount, p_description, p_entry_date)` coincide con la función del Plan 1. `formatEUR`/`STATUS_LABELS` (Task 1) se usan consistentemente.

**Nota de dependencia E2E:** la Task 1 deja stubs de `layout.tsx`/`page.tsx` para que su smoke test sea verificable de forma aislada; la Task 2 reemplaza el layout y la Task 3 la page. El seed (`e2e/.fixture.json`) lo consumen las Tasks 4-5.

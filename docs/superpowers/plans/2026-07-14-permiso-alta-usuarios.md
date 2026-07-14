# Permiso delegado de alta de usuarios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El admin marca usuarios concretos (`can_create_users`) para que puedan dar de alta usuarios nuevos (solo operativo/manager), sin poder editar ni desactivar.

**Architecture:** Flag booleano en `profiles`. El server action `crearUsuario` acepta admin **o** usuario activo con flag (rechazando `role: 'admin'` para no-admins). La página `/admin/usuarios` pasa de solo-admin a admitir usuarios con flag en modo lectura (lista sin acciones + alta con roles limitados). El flag se concede solo desde el editor del panel (solo-admin).

**Tech Stack:** Next.js App Router + Supabase (service role en server actions), shadcn/ui, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-07-14-permiso-alta-usuarios-design.md`

## Global Constraints

- Proyecto Supabase `msfylcgtlathccmxuheq`, se trabaja directo sobre producción. Migraciones = archivo en `supabase/migrations/` + aplicar vía Supabase MCP (`apply_migration`); si el MCP no está autenticado, usar el skill `supabase:supabase` / pedir al usuario.
- No hay infraestructura de tests unitarios. Gate del repo = `npx tsc --noEmit` + `npm run build` (`npm run lint` está roto repo-wide desde Next 16 — no usarlo).
- E2E = Playwright contra `http://localhost:3000`; **el dev server lo gestiona el usuario** (nunca arrancarlo/pararlo; el config no tiene `webServer`). Antes de correr E2E, confirmar con el usuario que está levantado.
- Textos de UI en español, siguiendo la estética existente (shadcn/ui, corporate).
- Commits frecuentes, mensajes estilo repo: `feat(usuarios): …`, `fix(usuarios): …`, en español.

---

### Task 1: Migración `can_create_users`

**Files:**
- Create: `supabase/migrations/0035_profiles_can_create_users.sql`

**Interfaces:**
- Produces: columna `public.profiles.can_create_users boolean not null default false` (la consumen Tasks 2, 4, 5, 6, 7).

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================
-- 0035 Permiso delegado: dar de alta usuarios
-- ============================================================

-- Flag por usuario (lo concede el admin editando al usuario en /admin/usuarios).
-- Permite SOLO crear usuarios nuevos con rol operativo/manager; editar,
-- activar/desactivar y conceder este flag siguen siendo solo-admin.
-- No necesita RLS propia: se lee/escribe vía service role en server actions.
alter table public.profiles
  add column if not exists can_create_users boolean not null default false;
```

- [ ] **Step 2: Aplicar la migración en Supabase**

Aplicar vía Supabase MCP `apply_migration` con nombre `0035_profiles_can_create_users` y el SQL anterior. Si el MCP pide autenticación, ejecutar `authenticate` primero.

- [ ] **Step 3: Verificar que la columna existe**

Ejecutar (`execute_sql`):

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'can_create_users';
```

Expected: 1 fila — `can_create_users | boolean | false | NO`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0035_profiles_can_create_users.sql
git commit -m "feat(usuarios): columna can_create_users en profiles (permiso delegado de alta)"
```

---

### Task 2: Server actions — permitir alta delegada y editar el flag

**Files:**
- Modify: `app/(horas)/admin/usuarios/actions.ts`

**Interfaces:**
- Consumes: columna `profiles.can_create_users` (Task 1).
- Produces: `crearUsuario` acepta actor con flag; `EdicionUsuario` gana `canCreateUsers: boolean` (lo consumen `UsuariosPanel` en Task 4 y la página en Task 5). `NuevoUsuario` no cambia.

- [ ] **Step 1: Ampliar el gate de `crearUsuario`**

Reemplazar el bloque de verificación del actor (líneas 11–16) por:

```ts
export async function crearUsuario(input: NuevoUsuario): Promise<{ ok: true } | { ok: false; error: string }> {
  // Actor válido: admin, o usuario activo con permiso delegado de alta (can_create_users).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role, status, can_create_users').eq('id', user.id).single()
  const esAdmin = me?.role === 'admin'
  if (!esAdmin && !(me?.can_create_users === true && me?.status === 'activo')) {
    return { ok: false, error: 'No tienes permiso para crear usuarios.' }
  }
  // El permiso delegado no alcanza para crear admins.
  if (!esAdmin && input.role === 'admin') {
    return { ok: false, error: 'Solo un administrador puede crear usuarios admin.' }
  }
```

El resto de la función queda igual (el perfil nuevo no toca `can_create_users`: nace `false` por el default de la columna).

- [ ] **Step 2: Añadir `canCreateUsers` a `EdicionUsuario` y persistirlo**

```ts
export interface EdicionUsuario {
  full_name: string; positionId: string
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'; areaIds: string[]
  canCreateUsers: boolean
}
```

Y en el `update` de `actualizarUsuario`:

```ts
  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({
    full_name: input.full_name.trim(), position_id: input.positionId || null, role: input.role, status: input.status,
    // Un admin ya puede crear usuarios por rol: el flag delegado se limpia para no dejarlo huérfano.
    can_create_users: input.role === 'admin' ? false : input.canCreateUsers,
  }).eq('id', id)
```

`cambiarEstadoUsuario` no cambia.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errores solo en los consumidores de `EdicionUsuario` (`components/horas/UsuariosPanel.tsx`, que aún no pasa `canCreateUsers`). Si aparece ese error, es el esperado y se resuelve en Task 4 — para mantener el commit verde, hacer Tasks 2 y 4 en el mismo ciclo de verificación **o** commitear igualmente anotándolo. Preferencia: continuar con Task 4 antes de commitear si tsc falla.

- [ ] **Step 4: Commit (si tsc pasó) o aplazar al final de Task 4**

```bash
git add "app/(horas)/admin/usuarios/actions.ts"
git commit -m "feat(usuarios): crearUsuario acepta permiso delegado y el editor persiste can_create_users"
```

---

### Task 3: `UsuarioForm` — ocultar el rol admin para no-admins

**Files:**
- Modify: `components/horas/UsuarioForm.tsx`

**Interfaces:**
- Produces: prop `allowAdminRole?: boolean` (default `true`); la consume la página en Task 5.

- [ ] **Step 1: Añadir la prop y condicionar la opción admin**

Firma del componente:

```ts
export default function UsuarioForm({ areas, posiciones, allowAdminRole = true }: { areas: AreaRow[]; posiciones: PosicionOpt[]; allowAdminRole?: boolean }) {
```

Select de rol (sustituye la línea actual de opciones):

```tsx
      <NativeSelect aria-label="Rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as NuevoUsuario['role'] })} className={selectClass} fullWidth>
        <option value="operativo">operativo</option>
        <option value="manager">manager</option>
        {allowAdminRole && <option value="admin">admin</option>}
      </NativeSelect>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos (la prop tiene default; los mismos errores pendientes de Task 2 si aún no se cerró Task 4).

- [ ] **Step 3: Commit**

```bash
git add components/horas/UsuarioForm.tsx
git commit -m "feat(usuarios): UsuarioForm puede ocultar el rol admin (alta delegada)"
```

---

### Task 4: `UsuariosPanel` — modo solo lectura, badge y checkbox del permiso

**Files:**
- Modify: `components/horas/UsuariosPanel.tsx`
- Modify: `app/(horas)/admin/usuarios/page.tsx` (solo select/mapping de la fila; el gating es Task 5)

**Interfaces:**
- Consumes: `EdicionUsuario.canCreateUsers` (Task 2).
- Produces: `UsuarioRow.canCreateUsers: boolean`; prop `readOnly?: boolean` (default `false`) en `UsuariosPanel`. Los consume la página (Task 5).

- [ ] **Step 1: Ampliar `UsuarioRow` y el estado del editor**

```ts
export interface UsuarioRow {
  id: string; full_name: string; email: string; positionId: string | null
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'; areaIds: string[]
  canCreateUsers: boolean
}
```

En `Editor`, estado inicial:

```ts
  const [f, setF] = useState<EdicionUsuario>({
    full_name: u.full_name, positionId: u.positionId ?? '', role: u.role, status: u.status, areaIds: u.areaIds,
    canCreateUsers: u.canCreateUsers,
  })
```

- [ ] **Step 2: Checkbox del permiso en el editor**

Insertar entre el bloque de áreas y los botones Guardar/Cancelar (el flag no aplica a admins: ya crean usuarios por rol):

```tsx
      {f.role !== 'admin' && (
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-foreground/80 hover:text-foreground">
          <input type="checkbox" className="size-4 accent-(--brand)" checked={f.canCreateUsers}
            onChange={(e) => setF({ ...f, canCreateUsers: e.target.checked })} />
          Puede dar de alta usuarios (solo operativos y managers; no edita ni desactiva)
        </label>
      )}
```

- [ ] **Step 3: Prop `readOnly` en el panel + badge en la columna Rol**

Firma:

```ts
export default function UsuariosPanel({ usuarios, areas, posiciones, readOnly = false }: { usuarios: UsuarioRow[]; areas: AreaRow[]; posiciones: PosicionOpt[]; readOnly?: boolean }) {
```

Cabecera — la columna Acciones solo si no es readOnly:

```tsx
            <TableHead>Estado</TableHead>
            {!readOnly && <TableHead className="text-right">Acciones</TableHead>}
```

Celda Rol con badge del permiso:

```tsx
                <TableCell className="py-3 text-foreground/70">
                  <span className="capitalize">{u.role}</span>
                  {u.canCreateUsers && u.role !== 'admin' && (
                    <Badge className="ml-2 bg-sky-50 text-sky-700">Alta de usuarios</Badge>
                  )}
                </TableCell>
```

Celda Acciones y fila del editor, solo si no es readOnly:

```tsx
                {!readOnly && (
                  <TableCell className="py-3 text-right">
                    <Button variant="link" size="sm" className="px-1" onClick={() => setEditing(editing === u.id ? null : u.id)}>Editar</Button>
                    <Button variant="ghost" size="sm" disabled={busy === u.id} onClick={() => toggle(u)}>
                      {u.status === 'activo' ? 'Desactivar' : 'Activar'}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
              {!readOnly && editing === u.id && (
                <TableRow>
                  <TableCell colSpan={6} className="py-3"><Editor u={u} areas={areas} posiciones={posiciones} onDone={() => setEditing(null)} /></TableCell>
                </TableRow>
              )}
```

- [ ] **Step 4: Página — select y mapping de la fila**

En `app/(horas)/admin/usuarios/page.tsx`:

```ts
interface RawUsuario {
  id: string; full_name: string; email: string; position_id: string | null
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'
  can_create_users: boolean
  user_areas: { area_id: string }[]
}
```

Select: `'id, full_name, email, position_id, role, status, can_create_users, user_areas(area_id)'`

Mapping: añadir `canCreateUsers: u.can_create_users,` al objeto de `usuarios`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS sin errores (aquí se cierran también los pendientes de Task 2).

- [ ] **Step 6: Commit (incluye actions.ts si quedó aplazado de Task 2)**

```bash
git add components/horas/UsuariosPanel.tsx "app/(horas)/admin/usuarios/page.tsx" "app/(horas)/admin/usuarios/actions.ts"
git commit -m "feat(usuarios): panel con modo lectura, badge y checkbox del permiso de alta"
```

---

### Task 5: Página `/admin/usuarios` — gating para usuarios con flag

**Files:**
- Modify: `app/(horas)/admin/usuarios/page.tsx`

**Interfaces:**
- Consumes: `readOnly` (Task 4), `allowAdminRole` (Task 3), columna `can_create_users` (Task 1).

- [ ] **Step 1: Gate y props**

Reemplazar el gate actual (`if (me?.role !== 'admin') redirect('/registrar')`):

```ts
  const { data: me } = await supabase.from('profiles').select('role, can_create_users').eq('id', user.id).single()
  const esAdmin = me?.role === 'admin'
  // Usuarios con permiso delegado (p. ej. RRHH): entran en modo lectura + alta.
  if (!esAdmin && !me?.can_create_users) redirect('/registrar')
```

Y en el JSX:

```tsx
        <UsuariosPanel usuarios={usuarios} areas={areas} posiciones={posiciones} readOnly={!esAdmin} />
        ...
        <UsuarioForm areas={areas} posiciones={posiciones} allowAdminRole={esAdmin} />
```

(El estado del layout ya garantiza `status === 'activo'` para llegar aquí; el server action revalida por su cuenta.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(horas)/admin/usuarios/page.tsx"
git commit -m "feat(usuarios): la sección Usuarios admite el permiso delegado en modo lectura"
```

---

### Task 6: Navegación — enlace «Usuarios» para usuarios con flag

**Files:**
- Modify: `components/AppShell.tsx`
- Modify: `app/(horas)/layout.tsx`
- Modify: `app/(hucha)/presupuestos/layout.tsx`

**Interfaces:**
- Consumes: columna `can_create_users` (Task 1).
- Produces: prop `canCreateUsers?: boolean` (default `false`) en `AppShell`.

- [ ] **Step 1: `AppShell` — prop y sección de navegación**

```ts
function buildSections(role: string, canCreateUsers: boolean): Section[] {
```

Ítem Usuarios (los demás ítems de Administración siguen solo-admin):

```ts
        { href: '/admin/usuarios', label: 'Usuarios', icon: UserCog, show: isAdmin || canCreateUsers },
```

Firma del componente y llamada:

```ts
export default function AppShell({ displayName, role, canCreateUsers = false, children }: { displayName: string; role: string; canCreateUsers?: boolean; children: React.ReactNode }) {
  ...
  const sections = buildSections(role, canCreateUsers)
```

- [ ] **Step 2: Layouts — leer y pasar el flag**

`app/(horas)/layout.tsx` — select: `'role, full_name, status, must_change_password, can_create_users'` y:

```tsx
    <AppShell displayName={profile.full_name || user.email!} role={profile.role} canCreateUsers={profile.can_create_users === true}>
```

`app/(hucha)/presupuestos/layout.tsx` — select: `'role, full_name, can_create_users'` y:

```tsx
    <AppShell displayName={profile.full_name || user.email!} role={profile.role} canCreateUsers={profile.can_create_users === true}>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/AppShell.tsx "app/(horas)/layout.tsx" "app/(hucha)/presupuestos/layout.tsx"
git commit -m "feat(usuarios): enlace Usuarios visible para quien tiene permiso de alta"
```

---

### Task 7: E2E — fixture RRHH + specs

**Files:**
- Modify: `e2e/helpers/seed-horas.ts`
- Modify: `e2e/global-setup.ts`
- Modify: `playwright.config.ts`
- Create: `e2e/horas-usuarios-alta-delegada.spec.ts`
- Modify: `e2e/horas-usuarios-editar.spec.ts`

**Interfaces:**
- Consumes: toda la feature (Tasks 1–6) y la migración aplicada en producción.
- Produces: usuario fixture `e2e-rrhh@horas.test` con `can_create_users=true`, storage state `e2e/.auth/rrhh.json`, proyecto Playwright `chromium-horas-rrhh`.

- [ ] **Step 1: Seed del usuario RRHH**

En `e2e/helpers/seed-horas.ts`, junto a los consts existentes:

```ts
const RRHH = { email: 'e2e-rrhh@horas.test', password: 'E2e-Rrhh-Pass-123', full_name: 'RRHH E2E' }
```

En `seedHorasFixture()`, tras crear el admin:

```ts
  // Usuario con permiso delegado de alta (operativo + can_create_users).
  const { data: createdRrhh, error: rrhhError } = await admin.auth.admin.createUser({
    email: RRHH.email, password: RRHH.password, email_confirm: true,
    user_metadata: { full_name: RRHH.full_name },
  })
  if (rrhhError) throw rrhhError
  const rrhhUserId = createdRrhh.user!.id
  await admin.from('profiles').update({
    role: 'operativo', status: 'activo', must_change_password: false, can_create_users: true,
  }).eq('id', rrhhUserId)
```

En el objeto `return`, añadir:

```ts
    rrhhEmail: RRHH.email,
    rrhhPassword: RRHH.password,
    rrhhUserId,
```

En `cleanupHorasFixture()`, dentro del `for`, añadir:

```ts
    // Delete RRHH E2E user
    if (u.email === RRHH.email) {
      await admin.from('time_logs').delete().eq('user_id', u.id)
      await admin.from('user_areas').delete().eq('user_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
```

(Los usuarios que RRHH cree en los tests usan prefijo `e2e-nuevo-`, ya cubierto por el cleanup.)

- [ ] **Step 2: Storage state en `global-setup.ts`**

Tras el bloque del admin:

```ts
  // Login RRHH (permiso delegado de alta) → /registrar
  const rrhhPage = await browser.newPage({ baseURL: 'http://localhost:3000' })
  await rrhhPage.goto('/login')
  await rrhhPage.getByLabel('Email').fill(horasFixture.rrhhEmail)
  await rrhhPage.getByLabel('Contraseña').fill(horasFixture.rrhhPassword)
  await rrhhPage.getByRole('button', { name: /ingresar/i }).click()
  await rrhhPage.waitForURL('**/registrar')
  await rrhhPage.context().storageState({ path: 'e2e/.auth/rrhh.json' })
  await rrhhPage.close()
```

- [ ] **Step 3: Proyecto Playwright**

En `playwright.config.ts`:
- Añadir `'**/horas-usuarios-alta-delegada.spec.ts'` al `testIgnore` del proyecto `chromium-horas` (para que no corra con el operativo).
- Añadir proyecto nuevo tras `chromium-horas-admin`:

```ts
    {
      name: 'chromium-horas-rrhh',
      use: { storageState: 'e2e/.auth/rrhh.json' },
      testMatch: '**/horas-usuarios-alta-delegada.spec.ts',
    },
```

- [ ] **Step 4: Spec del flujo delegado**

Create `e2e/horas-usuarios-alta-delegada.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// Corre con storage state de e2e-rrhh@horas.test (can_create_users, rol operativo).
test('un usuario con permiso delegado ve la lista sin acciones y da de alta un operativo', async ({ page }) => {
  await page.goto('/admin/usuarios')

  // Ve la lista, pero en solo lectura: sin columna Acciones ni botones de edición.
  await expect(page.getByRole('columnheader', { name: 'Usuario' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Acciones' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Desactivar' })).toHaveCount(0)

  // El selector de rol del alta no ofrece admin.
  await expect(page.getByLabel('Rol').locator('option[value="admin"]')).toHaveCount(0)

  // Alta de un operativo (prefijo e2e-nuevo-: lo borra el cleanup del fixture).
  const email = `e2e-nuevo-deleg-${Date.now()}@horas.test`
  await page.getByLabel('Nombre').fill('Alta Delegada E2E')
  await page.getByLabel('Correo').fill(email)
  await page.getByLabel('Contraseña').fill('Deleg-Pass-123')
  await page.getByRole('button', { name: /crear usuario/i }).click()
  await expect(page.getByText(/usuario creado/i)).toBeVisible()

  // El nuevo usuario aparece en la lista tras recargar.
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible()
})

test('el usuario delegado no ve otras secciones de administración', async ({ page }) => {
  await page.goto('/admin/usuarios')
  await expect(page.getByRole('link', { name: 'Usuarios' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Catálogos' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Auditoría' })).toHaveCount(0)
})
```

- [ ] **Step 5: Test admin — conceder el permiso desde el editor**

Añadir al final de `e2e/horas-usuarios-editar.spec.ts`:

```ts
// El admin concede el permiso de alta a un usuario nuevo y ve el badge en el panel.
test('el admin concede el permiso de alta de usuarios', async ({ page }) => {
  const email = `e2e-nuevo-flag-${Date.now()}@horas.test`
  await page.goto('/admin/usuarios')

  await page.getByLabel('Nombre').fill('Con Permiso E2E')
  await page.getByLabel('Correo').fill(email)
  await page.getByLabel('Contraseña').fill('E2e-Flag-Pass-123')
  await page.getByRole('button', { name: 'Crear usuario' }).click()
  await expect(page.getByText('Usuario creado')).toBeVisible()

  await page.reload()
  const fila = page.getByRole('row').filter({ hasText: email })
  await fila.getByRole('button', { name: 'Editar' }).click()
  await page.getByRole('checkbox', { name: /puede dar de alta usuarios/i }).check()
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('Usuario actualizado')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: email }).getByText('Alta de usuarios')).toBeVisible()
})
```

- [ ] **Step 6: Confirmar dev server y correr los E2E afectados**

Confirmar con el usuario que el dev server está levantado en `http://localhost:3000` (no arrancarlo nunca). Luego:

Run: `npx playwright test --project=chromium-horas-rrhh --project=chromium-horas-admin horas-usuarios-alta-delegada horas-usuarios-editar horas-alta-usuario`
Expected: PASS (3 specs). Si falla el global-setup en el login de RRHH, revisar que la migración de Task 1 está aplicada.

- [ ] **Step 7: Commit**

```bash
git add e2e/helpers/seed-horas.ts e2e/global-setup.ts playwright.config.ts e2e/horas-usuarios-alta-delegada.spec.ts e2e/horas-usuarios-editar.spec.ts
git commit -m "test(usuarios): e2e del permiso delegado de alta (fixture RRHH + specs)"
```

---

### Task 8: Verificación final

**Files:** ninguno nuevo.

- [ ] **Step 1: Gate del repo**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run build`
Expected: build OK (warnings preexistentes aparte).

- [ ] **Step 2: Verificación funcional resumida**

Con los E2E de Task 7 en verde ya está cubierto: acceso delegado en modo lectura, alta de operativo, ausencia de opción admin, concesión del flag por el admin y badge. Si algún flujo no quedó cubierto por E2E (p. ej. rechazo server-side de `role: 'admin'` llamando al action directamente), verificarlo manualmente o dejar constancia en el resumen final.

- [ ] **Step 3: Commit de cierre si quedó algo suelto**

```bash
git status --short
```

Expected: árbol limpio (salvo los archivos de test-results/.auth que ya estaban modificados antes de empezar).

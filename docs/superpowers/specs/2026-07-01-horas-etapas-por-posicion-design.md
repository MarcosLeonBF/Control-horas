# Diseño: Etapas por posición

Fecha: 2026-07-01

## Objetivo

Cada **posición** (columnas del Excel: CRM, SEO, Growth Strategists…) puede tener
**etapas asignadas**, igual que ya tiene áreas asignadas. Al **registrar horas en
un proyecto cliente**, un usuario solo podrá elegir entre las etapas de su posición.

Esto separa dos mecanismos ya existentes/nuevos de forma limpia:

- **Proyecto = "Departamento"** → la etapa la determina el **departamento** elegido
  (`departamento_etapas`, ya existente). Sin cambios.
- **Proyecto = cliente** → la etapa la determina la **posición del usuario**
  (`position_etapas`, nuevo). Antes se mostraban **todas** las etapas sin filtrar.

## Decisiones (acordadas en brainstorming)

1. **Fallback estricto:** si la posición del usuario no tiene etapas asignadas (o el
   usuario no tiene posición), en proyecto cliente el desplegable de etapa queda
   **vacío/deshabilitado** y no puede registrar hasta que el admin le asigne etapas.
2. **Admin exento:** al registrar, un `admin` ve **todas** las etapas (igual que hoy
   ve todas las áreas). No se filtra por su posición.
3. **UI de asignación:** checkboxes de las etapas existentes (mismo patrón que el
   botón "Áreas" de las posiciones). Solo asigna etapas ya existentes en el catálogo.
4. **Refuerzo cliente + servidor:** se filtra en el formulario y **además** se valida
   en `guardarRegistro`.

## Modelo de datos

Nueva migración `supabase/migrations/0021_horas_position_etapas.sql`, calcada de
`position_areas` (0019):

```sql
create table public.position_etapas (
  id          uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  etapa_id    uuid not null references public.etapas(id)    on delete cascade,
  created_at  timestamptz not null default now(),
  unique (position_id, etapa_id)
);
create index position_etapas_position_idx on public.position_etapas(position_id);
create index position_etapas_etapa_idx    on public.position_etapas(etapa_id);

alter table public.position_etapas enable row level security;
create policy position_etapas_select on public.position_etapas
  for select to authenticated using (true);
create policy position_etapas_admin_write on public.position_etapas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
```

`on delete cascade` en ambas FKs: borrar una posición o una etapa (botón Eliminar de
Catálogos) limpia el vínculo automáticamente.

### Semilla de arranque (rollout)

Para no bloquear a los usuarios existentes en el momento del deploy (el modo estricto
haría que nadie pueda registrar en proyecto cliente hasta que el admin configure),
la migración **siembra todas las etapas activas en todas las posiciones existentes**:

```sql
insert into public.position_etapas (position_id, etapa_id)
  select p.id, e.id from public.positions p cross join public.etapas e
  where e.active
  on conflict do nothing;
```

Así el comportamiento inicial equivale al actual ("todas las etapas") y el admin va
**restringiendo** cada posición después. *(Decisión revisable en la revisión del spec.)*

## Componentes

### A. Server actions — `app/(horas)/admin/catalogos/actions.ts`

Nueva acción calcada de `setPosicionAreas`:

```ts
// Reemplaza las etapas ligadas a una posición.
export async function setPosicionEtapas(id: string, etapaIds: string[]): Promise<Result>
```
Borra `position_etapas` de esa posición e inserta las nuevas. Solo admin (`requireAdmin`).

### B. Loader de Catálogos — `app/(horas)/admin/catalogos/page.tsx`

Añadir una consulta `position_etapas(position_id, etapa_id)` y mapear `etapaIds` en cada
`PosicionRow`, igual que hoy se hace con `posAreas`/`areaIds`.

### C. UI Catálogos — `components/horas/CatalogosPanel.tsx` (`PosicionesSection`)

- `PosicionRow` gana `etapaIds: string[]`.
- Junto al nombre de cada posición, además de los badges de áreas, badges de **etapas**.
- Nuevo botón **Etapas** (junto a "Áreas") que abre un panel de checkboxes con las
  etapas activas (`etapas.filter(e => e.active)`), preseleccionadas con `p.etapaIds`.
- Botón "Guardar etapas" → `setPosicionEtapas(p.id, etapaSel)`; "Cancelar" cierra.
- Estado local independiente del de "Áreas" (`etapasFor`, `etapaSel`).
- El componente recibe `etapas: CatalogoRow[]` (ya disponibles en el panel).

### D. Registro — `app/(horas)/registrar/page.tsx`

- Cargar las etapas de la posición del usuario:
  `profiles.position_id` → `position_etapas` → ids de etapa.
- Calcular `clientEtapas: EtapaRow[]`:
  - `admin` → todas las `etapas`.
  - resto → `etapas.filter(e => positionEtapaIds.includes(e.id))` (puede quedar vacío).
- Pasar `clientEtapas` a `RegistroForm` (además de `etapas`, que se sigue usando para
  resolver los nombres de etapa de las líneas de Departamento).

### E. Formulario — `components/horas/RegistroForm.tsx`

- Nueva prop `clientEtapas: EtapaRow[]`.
- En líneas de **proyecto cliente**, el desplegable de Etapa lista `clientEtapas`
  en vez de `etapas`.
- Si `clientEtapas` está vacío → desplegable deshabilitado con opción única
  *"— Sin etapas asignadas (contacta al admin) —"* y `value=""`.
- **Modo edición:** si la etapa de una línea ya guardada no está en `clientEtapas`,
  se añade esa etapa (resuelta desde `etapas`) a las opciones de esa línea para no
  perderla al editar.
- Líneas de **Departamento**: sin cambios.

### F. Refuerzo servidor — `app/(horas)/registrar/actions.ts` (`guardarRegistro`)

- Cargar rol y etapas de posición del usuario una vez.
- Para cada línea de **proyecto cliente** (proyecto ≠ "Departamento") con `etapa_id`:
  si el usuario no es admin y `etapa_id` no está en sus etapas de posición → devolver
  `{ ok:false, error: 'Etapa no permitida para tu posición.' }`.
- Las líneas de Departamento se validan como hoy (etapa del departamento).

## Casos borde

- **Usuario sin posición** (no admin): `clientEtapas` vacío → no puede registrar en
  proyecto cliente (estricto). Sí puede en Departamento.
- **Etapa desactivada** que estaba asignada a una posición: no aparece en el selector
  (se filtran activas); en registros ya guardados se conserva vía la regla de edición.
- **Borrado de posición/etapa:** `on delete cascade` limpia `position_etapas`.

## Testing (e2e Playwright, patrón existente)

- Admin asigna etapas a una posición en Catálogos → persisten (badges + recarga).
- Usuario con posición X: al registrar en proyecto cliente solo ve las etapas de X.
- Usuario cuya posición no tiene etapas: desplegable deshabilitado, no puede guardar.
- Admin: ve todas las etapas al registrar.
- Refuerzo servidor: petición con etapa no permitida → error.
- Líneas de Departamento siguen filtrando por departamento (sin regresión).

## Fuera de alcance

- Reportes (ya agrupan/filtran por posición; no cambian).
- Etapas por departamento (mecanismo existente intacto).
- Multi-posición por usuario (sigue siendo una posición por usuario).

# Libertad de registro en julio — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durante julio 2026 los usuarios no-admin pueden registrar horas en cualquier día de julio; desde agosto rige una ventana normal de 7 días (baja de 14). La excepción se auto-vence sin revertir nada.

**Architecture:** La restricción real vive en la RPC `guardar_registro` (servidor = fuente de verdad); una migración nueva la redefine con un piso dinámico. El frontend (`RegistroForm`) replica el piso como pista de UI. El test SQL se endurece para ser correcto dentro y fuera de julio.

**Tech Stack:** Postgres (plpgsql, Supabase), Next.js 16 + React 19 + TypeScript (strict, noEmit), migraciones SQL versionadas en `supabase/migrations/`.

## Global Constraints

- Migración nueva = `supabase/migrations/0039_horas_registro_julio_libertad.sql` (0038 es la última existente).
- La ventana normal no-admin baja de 14 → **7 días** (`current_date - 7`).
- Excepción julio anclada a fechas **literales**: activa mientras `current_date <= DATE '2026-07-31'`, permite registrar desde `DATE '2026-07-01'`. Nunca usar "mes actual" dinámico.
- El piso es el **más permisivo** de los dos (`LEAST`): la excepción nunca reduce libertad.
- Admin sin cambios (sigue sin límite). Fecha futura sigue rechazada aparte.
- Fuera de alcance: la RPC `anular_registro` (mantiene su ventana de 7 días propia).
- `guardar_registro` NO está en `supabase/schema.sql`: no hay snapshot que actualizar.
- Gate del repo = `npx tsc` (noEmit) + `npm run build`. El lint está roto repo-wide (no es gate).

---

### Task 1: Servidor — migración 0039 (RPC `guardar_registro`) + test SQL

**Files:**
- Create: `supabase/migrations/0039_horas_registro_julio_libertad.sql`
- Modify: `supabase/tests/horas_rpc_guardar.sql:86`

**Interfaces:**
- Consumes: la definición viva de `guardar_registro(p_anchor_log_id uuid, p_lines jsonb) returns uuid` de `supabase/migrations/0033_horas_department_clientes_en_proyectos.sql`.
- Produces: misma firma `public.guardar_registro(uuid, jsonb) returns uuid`, con piso de fecha dinámico. El frontend (Task 2) espeja el piso pero no depende de la firma.

- [ ] **Step 1: Crear el archivo de migración copiando 0033 verbatim**

Copiar **íntegro** el contenido de `supabase/migrations/0033_horas_department_clientes_en_proyectos.sql` a `supabase/migrations/0039_horas_registro_julio_libertad.sql`. Es el punto de partida; luego se aplican solo los 3 cambios de los steps 2–4. No inventar nada más: el resto (validaciones de área/etapa/departamento, dedup, split por fecha, auditoría) queda idéntico.

- [ ] **Step 2: Reemplazar la cabecera del banner de comentarios**

Reemplazar el bloque de comentario superior (líneas 1–13 de la copia, el banner `0033 ... =====`) por:

```sql
-- ============================================================
-- 0039 HORAS: libertad de registro en julio (ventana 7 días + excepción 2026-07)
-- ------------------------------------------------------------
-- Cambios sobre la definición viva (0033):
--   * La ventana normal no-admin baja de 14 → 7 días (current_date - 7).
--   * Excepción temporal auto-vencible: mientras current_date <= '2026-07-31',
--     el piso mínimo se relaja a '2026-07-01' (LEAST con la ventana normal, para
--     que nunca reduzca libertad). Desde el 2026-08-01 la rama deja de aplicar
--     sola y rige solo la regla de 7 días; no hay que revertir nada.
--   * El resto (validaciones, dedup, split por fecha, auditoría) = 0033 sin cambios.
-- Fuera de alcance: anular_registro conserva su propia ventana de 7 días.
-- ============================================================
```

- [ ] **Step 3: Declarar `v_min_date` y calcularlo una vez antes del loop de líneas**

En el bloque `declare`, junto a las otras variables `v_date date;` / `v_dates date[];`, agregar la declaración:

```sql
  v_min_date         date;           -- piso mínimo de fecha para no-admin (0039)
```

Y justo **antes** del `for v_line in select value from jsonb_array_elements(p_lines) loop` (el loop de validación por línea), insertar el cálculo del piso:

```sql
  -- Piso mínimo de registro (no-admin): normal 7 días; en julio 2026, desde el 01/07.
  v_min_date := current_date - 7;
  if current_date <= date '2026-07-31' then
    v_min_date := least(v_min_date, date '2026-07-01');
  end if;

```

- [ ] **Step 4: Reemplazar el chequeo de rango dentro del loop**

Dentro del loop de validación por línea, reemplazar exactamente:

```sql
    if v_role <> 'admin' and v_date < current_date - 14 then
      raise exception 'fecha fuera de rango: máximo 14 días atrás';
    end if;
```

por:

```sql
    if v_role <> 'admin' and v_date < v_min_date then
      raise exception 'fecha fuera de rango: %',
        case when current_date <= date '2026-07-31'
             then 'en julio se registra desde el 01/07'
             else 'máximo 7 días atrás' end;
    end if;
```

- [ ] **Step 5: Endurecer el caso "fuera de rango" del test SQL**

En `supabase/tests/horas_rpc_guardar.sql`, el caso de rechazo del operativo usa `current_date - 10`, que **durante julio cae dentro de la excepción** (≥ 01/07) y ya no se rechazaría. Cambiar la línea 86, de:

```sql
    jsonb_build_object('entry_date', current_date - 10, 'project','Y','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_libre))); ok := false;
```

a (fecha robusta a ambos regímenes: en julio es < 01/07 → rechazada; fuera de julio es > 7 días → rechazada):

```sql
    jsonb_build_object('entry_date', current_date - 40, 'project','Y','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description',v_libre))); ok := false;
```

> Nota deliberada: NO se añade al test SQL una aserción "durante julio se acepta el 02/07", porque dependería del reloj y rompería fuera de julio. Esa parte se verifica en el round-trip manual (sección Despliegue). El test SQL, tras este cambio, valida correctamente la ventana de 7 días (−40 rechazada) y que admin no tiene límite — coherente con sus comentarios, que ya asumían 7 días.

- [ ] **Step 6: Sanity de SQL — sin ejecutar contra la DB**

Verificar visualmente el diff del archivo 0039 contra 0033 (debe mostrar SOLO: banner, `v_min_date` declarada, bloque de cálculo del piso, y el `if ... raise` cambiado). Confirmar balance de `begin/end` y `$function$` intacto.

Run: `git diff --no-index supabase/migrations/0033_horas_department_clientes_en_proyectos.sql supabase/migrations/0039_horas_registro_julio_libertad.sql`
Expected: solo aparecen los 4 cambios de los steps 2–4 (banner + declaración + bloque piso + chequeo). Ningún otro renglón funcional cambia.

- [ ] **Step 7: (Cuando haya DB segura) aplicar y correr el test SQL**

El test es **destructivo sobre `time_logs`** (crea y borra registros de prueba) y se auto-limpia. NO correrlo contra producción con datos reales; usar una Supabase branch/DB de prueba con las semillas (operativo con posición CRM/Setup). Si no hay DB segura disponible en este momento, dejar este step para el despliegue y continuar.

Aplicar la migración 0039 (vía Supabase MCP `apply_migration` o el SQL editor del dashboard) y luego ejecutar el contenido de `supabase/tests/horas_rpc_guardar.sql` (vía MCP `execute_sql` o el editor).
Expected: termina con `NOTICE: OK rpc guardar (multifecha, 0025)` y sin excepción. En particular el caso del step 5 debe seguir rechazando (`current_date - 40`).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0039_horas_registro_julio_libertad.sql supabase/tests/horas_rpc_guardar.sql
git commit -m "feat(horas): libertad de registro en julio (ventana 7d + excepcion 2026-07)"
```

---

### Task 2: Frontend — `RegistroForm` (piso de fecha + texto de ayuda)

**Files:**
- Modify: `components/horas/RegistroForm.tsx:16-17` (helpers), `:164`, `:225`, `:228`

**Interfaces:**
- Consumes: helpers locales `today()` y `daysAgo(n)` ya existentes (líneas 16–17). El prop `canBackdate?: boolean` (admin → sin `min`) ya existe.
- Produces: nada que otro archivo consuma; es solo UI. El servidor (Task 1) es quien valida de verdad.

- [ ] **Step 1: Añadir el helper `registroMinDate` espejo del servidor**

En `components/horas/RegistroForm.tsx`, justo debajo de los helpers `today`/`daysAgo` (línea 17), agregar:

```tsx
// Piso mínimo de registro (espejo de guardar_registro, migración 0039):
// normal 7 días; en julio 2026 se relaja al 01/07 (el más permisivo). Solo pista de UI.
const registroMinDate = () => {
  const base = daysAgo(7)
  if (today() > '2026-07-31') return base
  return base < '2026-07-01' ? base : '2026-07-01'
}
```

(Las cadenas ISO `YYYY-MM-DD` comparan cronológicamente, así que `<` da la fecha más temprana = más permisiva.)

- [ ] **Step 2: Usar el piso en el date input por línea (línea 164)**

Reemplazar en la línea 164:

```tsx
      <Input aria-label="Fecha" type="date" value={l.entry_date} max={today()} min={canBackdate ? undefined : daysAgo(14)}
```

por:

```tsx
      <Input aria-label="Fecha" type="date" value={l.entry_date} max={today()} min={canBackdate ? undefined : registroMinDate()}
```

- [ ] **Step 3: Usar el piso en el date input de "Fecha por defecto" (línea 225)**

Reemplazar en la línea 225:

```tsx
          id="fecha" type="date" value={defaultDate} max={today()} min={canBackdate ? undefined : daysAgo(14)}
```

por:

```tsx
          id="fecha" type="date" value={defaultDate} max={today()} min={canBackdate ? undefined : registroMinDate()}
```

- [ ] **Step 4: Texto de ayuda dinámico (línea 228)**

Reemplazar en la línea 228:

```tsx
        {!canBackdate && <span className="text-xs text-muted-foreground">Hasta 14 días atrás</span>}
```

por:

```tsx
        {!canBackdate && <span className="text-xs text-muted-foreground">{today() <= '2026-07-31' ? 'En julio podés registrar desde el 1' : 'Hasta 7 días atrás'}</span>}
```

- [ ] **Step 5: Gate de tipos**

Run: `npx tsc`
Expected: sin errores (exit 0). No debe reportar nada sobre `RegistroForm.tsx`.

- [ ] **Step 6: Gate de build**

Run: `npm run build`
Expected: build de Next completa sin errores.

- [ ] **Step 7: Commit**

```bash
git add components/horas/RegistroForm.tsx
git commit -m "feat(horas): RegistroForm refleja el piso de fecha de julio (UI)"
```

---

## Despliegue y verificación manual

Ejecutar tras aprobar ambas tasks. El dev server es gestionado por el usuario; no arrancarlo ni pararlo.

- [ ] Aplicar la migración `0039` en Supabase (remoto) vía MCP `apply_migration` o el SQL editor del dashboard.
- [ ] (Si no se corrió en Task 1 step 7) Ejecutar el test SQL contra una DB segura y confirmar `OK rpc guardar`.
- [ ] Deploy del frontend a Vercel (push a la rama que dispara el deploy).
- [ ] Round-trip manual en producción, **durante julio**, como usuario **no-admin**:
  - Registrar una línea con fecha **02/07/2026** (fuera de la ventana de 7 días a esta altura del mes) → debe **guardar**.
  - Intentar una fecha de **junio** (p. ej. 25/06/2026) → debe ser **rechazada** ("en julio se registra desde el 01/07").
  - Verificar que el date picker no deja elegir antes del 01/07 y que el texto dice "En julio podés registrar desde el 1".
- [ ] (Opcional, tras julio) Confirmar que desde el 01/08 el piso vuelve a 7 días y el texto a "Hasta 7 días atrás".

---

## Self-Review (hecha por quien escribió el plan)

- **Cobertura del spec:** ventana 7 días ✔ (Task 1 step 4), excepción julio con `LEAST` ✔ (steps 3–4), auto-vencimiento por fecha literal ✔ (`<= '2026-07-31'`), admin sin cambios ✔ (condición `v_role <> 'admin'` intacta), frontend espejo + texto ✔ (Task 2), tests ✔ (step 5), anular fuera de alcance ✔ (no se toca), despliegue + round-trip ✔.
- **Placeholders:** ninguno; todo el código a insertar/reemplazar está mostrado literal.
- **Consistencia de tipos/nombres:** `v_min_date date` declarada y usada; `registroMinDate()` definida en Task 2 step 1 y usada en steps 2–3; firma de `guardar_registro` sin cambios.

# Diseño — HUCHA Plan 3a: Sincronización desde el Excel de presupuestos

> Primer sub-proyecto del Plan 3 de HUCHA. Habilita la app HUCHA (ya construida) con datos reales, leyendo el Excel `Presupuestos Hucha.xlsx` desde SharePoint (Microsoft Graph).
> Relacionados: [`2026-06-23-hucha-presupuestos-design.md`](2026-06-23-hucha-presupuestos-design.md), [`../REGISTRO-DECISIONES-Y-ESTADO.md`](../REGISTRO-DECISIONES-Y-ESTADO.md) §6.

**Fecha:** 2026-06-26

---

## 1. Contexto y objetivo

La app HUCHA (Manager) ya existe (Plan 2) pero está **vacía**: los proyectos y presupuestos no se crean a mano, vienen de un Excel dedicado (decisión registrada en §6 del registro de decisiones). Este sub-proyecto construye la **sincronización de solo lectura** desde ese Excel hacia la base de datos, replicando la arquitectura del banco de horas: el Excel es la **fuente de la base**, HUCHA nunca le escribe, y los consumos/ampliaciones viven en la base.

**Objetivo:** que un admin pueda apretar "Sincronizar con Excel" y que los proyectos con presupuesto HUCHA aparezcan en la app con su saldo y su manager asignado.

### Estructura real del Excel (inspeccionada 2026-06-25)
Archivo `Presupuestos Hucha.xlsx`, URL en `.env.local` como `SHAREPOINT_HUCHA_FILE_URL`. Tres tablas (233 filas):
- **`ProyectosHucha_1`** — columnas `Proyecto`, `Hucha`. `Hucha` = monto asignado (EUR). **Tiene HUCHA ⇔ `Hucha` > 0.** Hoy solo 1 proyecto tiene `Hucha > 0` (la feature recién arranca).
- **`Clientes_Proyectos`** — maestro de proyectos; columna `Manager del proyecto` (nombres, ej. "Pilar"), + `Estado`, `Mostrar`, etc.
- **`Facturas_Completas`** — facturas; no se usa en 3a.

---

## 2. Decisiones de modelo (confirmadas con el usuario)

1. **El Excel es la base re-sincronizable, no un movimiento.** `Hucha` se lee y se guarda como base; si cambia en el Excel, el próximo sync la actualiza. No genera movimientos de ampliación.
2. **Ampliaciones = "valor agregado" encima de la base**, viven en HUCHA (admin), nunca se escriben al Excel. `restante = (Hucha del Excel + ampliaciones) − consumos`.
3. **Asignación manager↔proyecto: por nombre.** Se matchea `Manager del proyecto` con `profiles.full_name`; lo no-matcheado se reporta, no bloquea el sync.
4. **Disparo manual** por el admin (botón), con resumen del resultado. Igual que "Actualizar banco" de Horas.
5. **Solo se sincronizan proyectos con `Hucha > 0`.** Los de `Hucha = 0` se saltan.

---

## 3. Arquitectura (3 unidades separadas)

- **`lib/hucha/excel.ts`** — lector Graph (espeja `lib/graph/client.ts`). Obtiene token (client credentials), resuelve el `driveItem` desde `SHAREPOINT_HUCHA_FILE_URL`, y lee:
  - `ProyectosHucha_1` → `[{ proyecto: string, hucha: number }]`
  - `Clientes_Proyectos` → `Map<proyecto, managerNombre>` (de las columnas `Proyecto` y `Manager del proyecto`).
  - Devuelve `{ proyectos, managerPorProyecto }`. No toca la base.
- **`lib/hucha/sync.ts`** — `aplicarSync(datos, adminDb): Promise<SyncReport>`. Lógica pura de upsert + matching + recálculo (recibe el cliente admin de Supabase; no toca Graph). **Esta es la unidad testeable.**
- **Server Action `sincronizarHucha()`** — admin-gated: llama a `excel.ts`, pasa el resultado a `aplicarSync`, devuelve el `SyncReport`.

**Interfaces:**
```ts
interface ExcelProyecto { proyecto: string; hucha: number }
interface HuchaExcelData { proyectos: ExcelProyecto[]; managerPorProyecto: Map<string, string> }
interface SyncReport {
  proyectosCreados: number
  proyectosActualizados: number
  managersAsignados: number
  managersNoEncontrados: { proyecto: string; manager: string }[]
  saltadosSinHucha: number
}
```

---

## 4. Lógica del sync (`aplicarSync`)

Para cada `ExcelProyecto` con `hucha > 0`:
1. **Upsert `projects`** por `name = proyecto` (crea si no existe; el trigger de Plan 1 crea su `hucha_banks`). El `client` no se sincroniza en 3a (queda como está / null); se puede agregar luego si el Excel expone una columna de cliente.
2. **Setear base:** `hucha_banks.excel_hucha = hucha` para ese proyecto.
3. **Asignar manager:** `managerPorProyecto.get(proyecto)`; si hay nombre, buscar `profiles` con `lower(trim(full_name)) = lower(trim(nombre))`.
   - Match único → `insert into project_assignments (project_id, user_id) on conflict do nothing`. Cuenta en `managersAsignados`.
   - Cero o múltiples matches → agregar a `managersNoEncontrados`, no asignar.
4. **Recalcular el banco** vía `recompute_hucha_bank(bank_id)`.

Los `hucha = 0` incrementan `saltadosSinHucha` y no tocan nada.

> **Edge case (diferido a 3b):** un proyecto que pasa de `Hucha>0` a `0` en el Excel no se "desactiva" automáticamente en 3a; queda como está y el admin lo maneja. Se registra como decisión diferida.

---

## 5. Ajuste al modelo de datos (migración nueva)

Hoy `assigned_total` se arma **solo** de movimientos (Plan 1). Se agrega la base del Excel:
- **`hucha_banks.excel_hucha numeric(14,2) not null default 0`** — base sincronizada.
- **`recompute_hucha_bank(p_bank_id uuid)`** (función): recalcula
  - `assigned_total = excel_hucha + Σ(ampliaciones netas de anulaciones)`
  - `consumed_total = Σ(consumos netos)`
  - `remaining = assigned_total − consumed_total`
  - `status = compute_hucha_status(assigned_total, consumed_total)`
- Se ajusta el RPC `registrar_movimiento_hucha` para que el recálculo del banco use `excel_hucha + movimientos` (en vez de asumir que el asignado nace solo de movimientos). Los consumos/ampliaciones siguen registrándose igual.

> Compatibilidad: con `excel_hucha = 0` (default) el comportamiento es idéntico al de Plan 1, así que los datos/tests existentes no se rompen.

---

## 6. Pantalla de sincronización (admin)

- Ruta **solo-admin** dentro de HUCHA: `app/(hucha)/presupuestos/sincronizar/page.tsx` (gate: redirige a `/presupuestos` si no es admin).
- Botón **"Sincronizar con Excel"** → llama a `sincronizarHucha()` (Server Action).
- Muestra el **resumen**: proyectos creados/actualizados, managers asignados, **lista de managers no encontrados** (proyecto + nombre), y saltados sin HUCHA.
- Si el Excel/Graph falla, muestra el error sin romper la página.
- Acceso al enlace desde la nav de HUCHA solo para admin.

---

## 7. Testing

- **`aplicarSync` con fixtures (determinístico, sin Graph):** un test que invoca `aplicarSync` con datos de prueba contra la base (cliente admin), cubriendo: (a) proyecto nuevo con manager que matchea un usuario sembrado → crea proyecto + banco con `excel_hucha` + asignación; (b) proyecto con manager inexistente → se crea pero queda en `managersNoEncontrados`; (c) proyecto con `hucha = 0` → saltado; (d) re-sync que cambia el `Hucha` → actualiza la base y recalcula. Limpieza al final.
- **E2E happy-path (Playwright, sesión admin):** el admin entra a `/presupuestos/sincronizar`, ve el botón, lo aprieta y aparece un resumen. (El lector Graph se valida aparte porque depende de SharePoint.)
- Dev server gestionado por el usuario; Playwright **sin** bloque `webServer`. Seed vía service_role.

---

## 8. Fuera de alcance (Plan 3b)
- Ampliar / corregir presupuestos desde la UI admin (la RPC ya existe; falta la pantalla).
- Dashboard global y descargas Excel/CSV.
- Desactivación automática de proyectos que pierden su HUCHA en el Excel.
- Sincronización programada (cron) — en 3a es solo manual.

---

## 9. Trazabilidad con el PDF de HUCHA
| Sección | PDF HUCHA |
|---|---|
| Excel como fuente de la base (§2, §3) | §5 ("el presupuesto puede venir de un cálculo externo"), §16 |
| Ampliaciones = valor agregado (§2) | §8 |
| Solo proyectos con presupuesto (§2.5) | §5 |
| Pantalla admin (§6) | §4.2 |

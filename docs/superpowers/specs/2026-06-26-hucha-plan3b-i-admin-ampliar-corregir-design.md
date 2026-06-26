# Diseño — HUCHA Plan 3b-i: Admin (ampliar + corregir/anular)

> Primer sub-proyecto del Plan 3b. Da al admin las operaciones de dinero sobre los presupuestos: ampliar (valor agregado) y corregir mediante anulación, sobre el ledger existente.
> Relacionados: [`2026-06-23-hucha-presupuestos-design.md`](2026-06-23-hucha-presupuestos-design.md), [`2026-06-26-hucha-plan3a-sync-excel-design.md`](2026-06-26-hucha-plan3a-sync-excel-design.md), [`../REGISTRO-DECISIONES-Y-ESTADO.md`](../REGISTRO-DECISIONES-Y-ESTADO.md)
> PDF: `Especificaciones App de presupuestos.pdf` — §8 (ampliación), §4.2 (admin), §9 (historial), §7 (descripción/referencia).

**Fecha:** 2026-06-26

---

## 1. Contexto y objetivo

La app HUCHA ya tiene: managers que registran consumos, detalle de proyecto con saldo e historial, y la sincronización del presupuesto base desde el Excel (Plan 3a). El **motor de ledger** `registrar_movimiento_hucha` ya soporta los tres tipos de movimiento (`consumo`, `ampliacion`, `anulacion`) con su autorización interna. Falta la **interfaz admin** para dos operaciones que hoy no tienen pantalla: **ampliar** un presupuesto y **corregir** (anular) movimientos.

**Objetivo:** que un admin, desde el detalle de un proyecto, pueda ampliar su presupuesto (valor agregado encima de la base del Excel) y anular movimientos mal cargados, con todo quedando en el historial inmutable.

---

## 2. Decisiones (confirmadas con el usuario)

1. **Corrección = anular + volver a registrar.** El ledger es inmutable; corregir un movimiento equivocado se hace anulándolo (asiento de reversión) y registrando el correcto con el form normal. No hay edición in-place.
2. **Ubicación:** los controles admin viven en el **detalle existente** `/presupuestos/[id]`, renderizados solo si el rol es `admin`. El admin ya ve todos los proyectos en `/presupuestos` (por RLS), así que no hace falta una lista nueva (esa es la del dashboard, 3b-ii).
3. **Ampliación = "valor agregado"** encima de la base del Excel: sube `assigned_total`, deja `excel_hucha` intacto. Alineado con la decisión del Plan 3a y el PDF §8.

---

## 3. Backend: cerrar el hueco de doble-anulación

El guard actual (migración 0003b) impide anular una anulación, pero **no** impide anular **dos veces** el mismo `consumo`/`ampliacion`, lo que duplicaría la reversión del saldo. Se actualiza la RPC `registrar_movimiento_hucha` (vía nueva migración, `create or replace`) para que, en una `anulacion`, rechace si el `p_corrects_movement_id` **ya tiene una anulación** que lo corrige:

```
if exists (select 1 from hucha_movements
           where corrects_movement_id = p_corrects_movement_id and type = 'anulacion')
then raise exception 'el movimiento ya fue anulado'; end if;
```

Todo el resto de la RPC queda igual (autorización admin, cálculo de reversión, caches del banco). Compatibilidad total: solo agrega una validación.

**Test SQL:** anular un consumo una vez funciona; anularlo de nuevo lanza `'el movimiento ya fue anulado'`.

---

## 4. Ampliar presupuesto (admin)

Form **solo-admin** en el detalle del proyecto. Campos (PDF §8.1):
- **Monto** añadido (> 0, EUR).
- **Motivo** (obligatorio — la RPC exige `p_reason` no vacío para `ampliacion`).
- **Referencia** (opcional — factura/aprobación).
- **Fecha** (default hoy; no futura).
- *Responsable:* automático (el actor admin, vía `auth.uid()` en la RPC).

Server Action `ampliarPresupuesto(projectId, { monto, motivo, referencia, fecha })` → `supabase.rpc('registrar_movimiento_hucha', { p_project_id, p_type: 'ampliacion', p_amount: monto, p_reason: motivo, p_reference: referencia, p_entry_date: fecha })`. Tras éxito: `revalidatePath('/presupuestos/[id]')` y `/presupuestos`. El banco sube `assigned_total += monto` y recalcula `remaining`/`status`; `excel_hucha` no cambia.

---

## 5. Corregir / anular (admin)

En cada fila del historial (componente de movimientos), botón **"Anular"** solo-admin. Flujo: click → confirmación → Server Action `anularMovimiento(projectId, movementId)` → `rpc('registrar_movimiento_hucha', { p_project_id, p_type: 'anulacion', p_amount: <monto absoluto del original>, p_corrects_movement_id: movementId })`. *(La RPC recalcula la reversión a partir del movimiento original; `p_amount` se pasa > 0 para cumplir la validación común, pero el efecto real lo deriva la RPC del original.)*

El botón **se deshabilita / no se muestra** cuando el movimiento:
- es de tipo `anulacion` (no se anula una anulación), o
- **ya fue anulado** (existe una anulación con `corrects_movement_id` = su id).

Para detectarlo, `getMovements` se extiende para traer `corrects_movement_id`, y la UI computa el conjunto de ids ya-anulados (los `corrects_movement_id` de las filas tipo `anulacion`).

**Corregir un valor** = anular el equivocado + registrar el correcto con el form que ya existe (consumo para managers/admin, o ampliación para admin).

---

## 6. Acceso

- La página de detalle sigue habilitada para `manager` y `admin`. El **manager ve** el saldo y el historial (incluido quién amplió/anuló — el historial es visible), pero **no ve** los controles de ampliar/anular.
- Los controles admin se renderizan condicionalmente por rol (el gate real es la RPC, que ya exige `admin` para `ampliacion`/`anulacion`; la UI es defensa en profundidad).

---

## 7. Testing

- **Test SQL** del guard de doble-anulación (anular dos veces el mismo consumo → error).
- **E2E (sesión admin):** en el detalle de un proyecto con saldo, **ampliar** sube el asignado/restante visible; **anular** un consumo previo restaura el restante; el botón "Anular" desaparece/inhabilita sobre el movimiento ya anulado.
- Dev server gestionado por el usuario; Playwright **sin** `webServer`. Reusar la sesión admin existente (`admin-horas.json` / proyecto `chromium-horas-admin`) o la de HUCHA, según convenga.

---

## 8. Fuera de alcance (siguientes sub-proyectos del 3b)
- **3b-ii Dashboard global:** todos los proyectos con métricas y filtros (proyecto, manager, estado, rango de fechas).
- **3b-iii Descargas:** Excel/CSV (presupuestos, consumos, ampliaciones, excedidos, disponibles).

---

## 9. Trazabilidad con el PDF
| Sección de este spec | PDF |
|---|---|
| Ampliar (§4) | §8, §8.1 |
| Corregir/anular (§5) | §4.2 ("corregir consumos"), §9 |
| Motivo/referencia (§4) | §7, §8.1 |
| Acceso admin (§6) | §4.2, §11 permisos |

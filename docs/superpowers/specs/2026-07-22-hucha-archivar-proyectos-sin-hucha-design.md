# Diseño — HUCHA: archivar proyectos que pierden su presupuesto en el Excel

> Cierra el edge case diferido del Plan 3a: un proyecto que pasa de `Hucha > 0` a `Hucha = 0` en el Excel debe desaparecer de la app al sincronizar (y reaparecer si vuelve a tener presupuesto).
> Relacionados: [`2026-06-26-hucha-plan3a-sync-excel-design.md`](2026-06-26-hucha-plan3a-sync-excel-design.md) §4 (nota de edge case) y §8 (fuera de alcance).

**Fecha:** 2026-07-22

---

## 1. Contexto y problema

En el Plan 3a, el sync desde el Excel `Presupuestos Hucha.xlsx` **solo procesa proyectos con `Hucha > 0`** y **salta** los de `Hucha = 0` (`saltadosSinHucha`). La consecuencia observada en producción: se editó en el Excel un proyecto de 2500 → 0, se le dio "Sincronizar", y el proyecto **siguió apareciendo con su base de 2500 intacta**. El sync nunca lo tocó.

Esto es exactamente el edge case que el 3a dejó diferido:

> "un proyecto que pasa de `Hucha>0` a `0` en el Excel no se 'desactiva' automáticamente en 3a; queda como está y el admin lo maneja."

**Objetivo:** que al sincronizar, un proyecto que perdió su HUCHA en el Excel quede **oculto** de la app, conservando su banco y su histórico; y que si vuelve a tener presupuesto, **reaparezca** solo.

---

## 2. Decisión de comportamiento (confirmada con el usuario)

Elegida entre tres opciones (ocultar/desactivar · poner base en 0 y dejar visible · borrar): **ocultar/desactivar, conservando el banco y el histórico**. Reversible.

1. **Archivar, no borrar.** El proyecto que cae a `Hucha = 0` se marca `projects.status = 'archivado'`. No se borra el proyecto, ni el banco, ni los movimientos.
2. **El banco no se toca.** `excel_hucha`, `assigned_total`, consumos y ampliaciones quedan como estaban. Solo cambia el `status` del proyecto. (Se descartó bajar la base a 0: dejaría el restante negativo si hubo consumos, y no aporta nada estando oculto.)
3. **Reactivación automática.** Si un proyecto archivado vuelve a aparecer con `Hucha > 0` en el Excel, el sync lo vuelve a poner `activo`. Es el inverso natural del archivado y evita que quede oculto para siempre.
4. **Fuera de alcance:** bloquear nuevos consumos/ampliaciones sobre un proyecto archivado. Es un caso de borde (requiere tener la URL de detalle guardada) y se maneja aparte si hace falta.

---

## 3. Por qué es un cambio contenido

- `projects.status` **ya existe** con `check (status in ('activo','archivado'))` (migración `0001_foundation.sql`). No hace falta migración ni columnas nuevas.
- Los listados de HUCHA **ya filtran** `.eq('status', 'activo')`: `getDashboardRows` (dashboard admin) y `getMyProjectsWithBanks` (mis proyectos, manager). Al archivar, el proyecto desaparece de ambos **sin tocar la UI de listados**.
- `getProjectWithBank(id)` (vista de detalle) **no** filtra por status → un proyecto archivado sigue siendo consultable por URL directa (histórico), que es justo lo que queremos.
- La tabla `projects` la puebla y la lee **solo HUCHA**. Horas lee sus proyectos del Excel en vivo y guarda el nombre como texto; **no** consulta `projects.status`. Por lo tanto archivar un proyecto HUCHA no tiene efectos colaterales en Horas.

---

## 4. Cambio de lógica (`lib/hucha/sync.ts` → `aplicarSync`)

Es la única unidad de fondo que cambia. Sigue siendo pura (recibe el cliente admin, no toca Graph) y testeable. Por cada `ExcelProyecto`:

**Caso `hucha > 0`** (comportamiento actual + reactivación):
1. Upsert `projects` por `name` (crea si no existe; el trigger crea su `hucha_banks`).
2. Si el proyecto **ya existía y estaba `archivado`** → `update projects set status = 'activo'` y `proyectosReactivados++`.
3. Setear base (`set_hucha_excel_base`) y asignar manager — **igual que hoy**.

**Caso `hucha = 0`** (nuevo):
- Si el proyecto **existe y está `activo`** → `update projects set status = 'archivado'`. `proyectosArchivados++`. El banco no se toca.
- Si **no existe** o **ya está `archivado`** → nada que hacer → `saltadosSinHucha++`.

Idempotencia: re-sincronizar sin cambios en el Excel no reordena nada (archivar un ya-archivado no ocurre porque se filtra por `activo`; reactivar un ya-activo tampoco).

### Reporte (`SyncReport`)

Se agregan dos contadores; el resto queda igual:

```ts
interface SyncReport {
  proyectosCreados: number
  proyectosActualizados: number
  proyectosArchivados: number      // NUEVO — cayeron a Hucha=0 y estaban activos
  proyectosReactivados: number     // NUEVO — volvieron con Hucha>0 estando archivados
  managersAsignados: number
  managersNoEncontrados: { proyecto: string; manager: string }[]
  saltadosSinHucha: number         // ahora: Hucha=0 sin acción (no existe o ya archivado)
}
```

---

## 5. UI (`components/hucha/SincronizarButton.tsx`)

El resumen post-sync suma dos líneas, para que el admin vea qué pasó:

- **Proyectos archivados (perdieron su HUCHA): N**
- **Proyectos reactivados: N**

Sin cambios de flujo ni de pantalla. La pantalla `/presupuestos/sincronizar` y la Server Action `sincronizarHucha()` no cambian (siguen admin-gated; el `SyncReport` viaja tal cual con los campos nuevos).

---

## 6. Testing

Se extiende `e2e/hucha-sync.spec.ts` (test de `aplicarSync` con cliente service_role, determinístico, sin Graph):

- **(a) Baja a 0 → archiva:** un proyecto se siembra con `hucha > 0` (queda `activo`); un segundo sync del mismo proyecto con `hucha = 0` lo deja `status = 'archivado'`, `proyectosArchivados = 1`, y **no** aparece en `getMyProjectsWithBanks` / `getDashboardRows` (o consulta equivalente filtrada por `activo`). El banco conserva su `excel_hucha` y su histórico.
- **(b) Vuelve con presupuesto → reactiva:** partiendo del proyecto archivado de (a), un sync con `hucha > 0` lo deja `activo`, `proyectosReactivados = 1`, con la base recalculada por `set_hucha_excel_base`.
- **(c) `hucha = 0` inexistente → salta:** un `hucha = 0` de un proyecto que no existe cuenta en `saltadosSinHucha` y no crea nada (se preserva la semántica actual).

Los asserts existentes del test se mantienen. Dev server gestionado por el usuario; Playwright sin `webServer`; limpieza al final.

---

## 7. Fuera de alcance

- Bloquear consumos/ampliaciones sobre proyectos archivados (caso de borde con URL guardada).
- Una vista de "archivados" para el admin (por ahora, el reporte del sync es la señal de qué se archivó).
- Sincronización programada (cron) — sigue siendo manual, como en 3a.

---

## 8. Trazabilidad

| Sección | Origen |
|---|---|
| Archivar en vez de borrar / conservar histórico (§2) | Decisión del usuario 2026-07-22; cierra edge case §4 de 3a |
| Reactivación automática (§2.3, §4) | Inverso natural del archivado |
| `projects.status` reutilizado (§3) | `0001_foundation.sql`, listados en `lib/hucha/queries.ts` |

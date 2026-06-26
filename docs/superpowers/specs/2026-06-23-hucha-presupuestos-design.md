# Diseño — App de Presupuesto HUCHA + Fundación compartida

- **Fecha:** 2026-06-23
- **Autor:** Equipo de desarrollo (brainstorming con Claude)
- **Estado:** Aprobado para escribir plan de implementación
- **Proyecto:** `controlHoras` — Bastida & Farina
- **Stack:** Next.js (App Router) + Supabase (Postgres, Auth, RLS) + Tailwind + shadcn/ui

> **Nota de nombre:** el presupuesto se llama **HUCHA** (con H, como la hucha/alcancía).
> El PDF de especificaciones lo escribe "UCHA" sin H; en este proyecto se usa siempre **HUCHA**.

---

## 1. Resumen ejecutivo

Construimos **dos apps internas relacionadas** que comparten una misma base:

1. **Control de Horas** — registro de horas con bancos por cliente/proyecto/área (app compleja; ya existe un MVP temprano).
2. **Presupuesto HUCHA** — versión simple del mismo concepto de "banco": cada proyecto tiene un presupuesto en dinero, los managers registran consumos y el admin amplía.

**Decisión estratégica:** empezar por **HUCHA** y, al hacerlo, construir la **fundación compartida** (usuarios+roles, proyectos como entidad real, asignación de managers a proyectos, y un patrón genérico de *banco + ledger*). HUCHA es el primer consumidor de esa fundación en su forma más simple; **Control de Horas v2** la reutilizará después sin reescribir la base.

**Por qué empezar por HUCHA:** ejercita la misma columna vertebral (auth, roles, banco, ledger, historial, dashboard, export) en un contexto mucho más simple, es entregable rápido, valida decisiones técnicas con bajo riesgo, y deja ~60-70% reutilizable para Horas.

---

## 2. Alcance

### En alcance (esta entrega — HUCHA + fundación)
- Login (reutiliza el `/login` actual de Supabase Auth).
- Usuarios creados internamente por el admin, con rol y asignación de proyectos.
- Proyectos como entidad real; cada proyecto tiene un banco HUCHA (creado en 0 automáticamente).
- Registro **individual** de consumo (sin multilínea).
- Descuento automático del presupuesto vía ledger.
- Ampliación manual del presupuesto (solo admin).
- Historial de movimientos (consumo / ampliación / corrección / anulación).
- Dashboard con estados y filtros.
- Descarga de data en Excel / CSV.

### Fuera de alcance (es de Control de Horas, no de HUCHA)
Según §3 y §16 de la spec de HUCHA, **explícitamente NO** se incluye: registro diario multilínea, etapas, departamento, banco por rol operativo, cálculo por usuario, registro de horas, ni flujos de aprobación. Estas features llegarán con **Horas v2**, sobre esta misma fundación.

### Decisión sobre el código existente (estrategia *strangler fig*)
El MVP actual de Horas (`time_entries`, páginas `/registrar`, `/reportes`, `/proyectos`) se **congela como legacy** y no se toca. La fundación nueva nace al lado; HUCHA la estrena. Cuando se construya Horas v2 (multilínea), será greenfield sobre la fundación ya probada, y entonces se retira el MVP viejo (con una migración única de datos `time_entries` → estructura padre+líneas, trabajo futuro fuera de esta entrega).

**Motivo:** no se refactoriza código ya condenado a reescribirse. Migrar el `time_entries` plano ahora sería trabajo tirado dos veces.

---

## 3. Roles y permisos

### Roles (3, en `profiles.role`)
| Rol | En HUCHA | En Horas (futuro) |
|---|---|---|
| `operativo` | (no usa HUCHA) | registra sus horas, ve sus bancos |
| `manager` | ve sus proyectos asignados, registra consumos, ve historial, descarga lo suyo | ve bancos de su equipo/área |
| `admin` | crea proyectos y usuarios, amplía/corrige presupuesto, ve y descarga todo | todo: usuarios, bancos, correcciones, alertas |

> **Decisión:** fusionamos "Administración" y "Admin" del PDF en un solo `admin`. El **"usuario autorizado"** que menciona §8 (para ampliar) hoy = `admin`.
> **Revisable a futuro:** si se necesita una persona que amplíe sin ser admin completo, se introduce un 4º rol. No es necesario ahora.

### Permisos detallados (§4, §8, §10)
**Manager PUEDE:** ver proyectos asignados; ver presupuesto disponible; registrar consumos con descripción/referencia; ver historial de sus proyectos; **descargar datos de sus proyectos**.
**Manager NO PUEDE:** editar el total; ampliar; eliminar presupuesto; ver proyectos no asignados.
**Admin PUEDE:** crear/editar proyectos y usuarios; ver todos los presupuestos; ampliar/ajustar; corregir consumos; ver historial completo; descargar todo.

> **Decisión sobre descargas (REVISABLE en reunión):** el PDF da "descargar data" explícito solo al admin (§4.2) y lo omite del manager (§4.1), pero sí le da "ver el historial". Decidimos que **el manager puede descargar los datos de sus propios proyectos** (es el mismo dato que ya ve, scoped por RLS, sin coste técnico). Marcado como **posible revisión**: si se decide solo-admin, es un cambio mínimo.

---

## 4. Arquitectura

```
app/
  (legacy-horas)/        ← MVP actual CONGELADO: /registrar, /reportes, /proyectos
  (app)/presupuestos/    ← App HUCHA (manager)
  (app)/admin/           ← Gestión: usuarios, proyectos, presupuestos (admin)
  login/                 ← reutilizado

Fundación compartida (Supabase / Postgres):
  profiles · projects · project_assignments        ← base relacional
  hucha_banks · hucha_movements                     ← banco + ledger
  fn: registrar_movimiento_hucha()                  ← motor de ledger (SECURITY DEFINER)
  trigger: crea hucha_bank en 0 al crear proyecto
```

**Principios:**
- Toda la autorización vive en Postgres (RLS + funciones). El frontend solo oculta botones por comodidad.
- Las **escrituras de saldo** pasan siempre por la función de ledger (RPC), nunca por `INSERT/UPDATE` directo del cliente.
- El helper `is_admin()` se redefine para leer de `profiles.role='admin'`; las políticas legacy de `time_entries` siguen funcionando sin tocarse.

### Enfoque del banco + ledger (Enfoque 2 — tablas separadas, motor compartido)
HUCHA usa `hucha_banks` + `hucha_movements`. Horas v2 clonará el patrón con `hour_banks` + `hour_movements`. Lo que se reutiliza es el **motor** (función de ledger + convenciones de columnas), no la tabla literal — evita columnas nullable sin sentido y mantiene RLS limpio por dominio.

**Ledger = libro de movimientos.** La tabla `hucha_movements` es la **fuente de verdad** (append-only, inmutable). `hucha_banks` guarda una **copia cacheada del saldo** para leer rápido. Esto da auditoría completa (quién/cuándo/por qué) y permite **corregir sin borrar** (una corrección es un movimiento nuevo que revierte).

---

## 5. Modelo de datos

### Fundación

**`profiles`** (extiende `auth.users`)
| campo | tipo | nota |
|---|---|---|
| id | uuid PK | = auth.users.id |
| email | text | |
| full_name | text | |
| position | text | cargo (opcional) |
| role | text | CHECK `operativo` / `manager` / `admin` |
| status | text | CHECK `activo` / `inactivo` |
| created_by | uuid | auditoría |
| created_at, updated_at | timestamptz | |

**`projects`**
| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| name | text | nombre del proyecto |
| client | text | cliente (opcional) |
| status | text | CHECK `activo` / `archivado` |
| created_by | uuid | |
| created_at, updated_at | timestamptz | |

**`project_assignments`** — qué manager ve qué proyecto
| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| project_id | uuid FK | |
| user_id | uuid FK → profiles | |
| created_by | uuid | |
| created_at | timestamptz | |
| | | `UNIQUE(project_id, user_id)` |

### HUCHA

**`hucha_banks`** — 1 por proyecto (saldo cacheado)
| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| project_id | uuid FK | `UNIQUE` (un banco por proyecto) |
| currency | text | default `EUR` (euros) |
| assigned_total | numeric(14,2) | Σ ampliaciones/carga inicial *(cache)* |
| consumed_total | numeric(14,2) | Σ consumos *(cache)* |
| remaining | numeric(14,2) | `assigned_total − consumed_total` *(cache)* |
| status | text | `sin_presupuesto`/`disponible`/`bajo`/`consumido`/`excedido` |
| updated_at | timestamptz | |

> Estado "bajo" se calcula con un **umbral global** (ej. `remaining < 20% de assigned_total`), no configurable por banco.

**`hucha_movements`** — ledger append-only e inmutable
| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| bank_id | uuid FK | |
| type | text | CHECK `consumo`/`ampliacion`/`correccion`/`anulacion` |
| amount | numeric(14,2) | con signo: consumo −, ampliación + |
| balance_before | numeric(14,2) | saldo (remaining) antes |
| balance_after | numeric(14,2) | saldo (remaining) después |
| description | text | descripción del consumo |
| reference | text | factura / aprobación / comentario |
| reason | text | motivo (ampliación/corrección) |
| actor_id | uuid FK → profiles | quién lo hizo |
| actor_name | text | **snapshot** del nombre al momento (historial exacto) |
| entry_date | date | fecha del movimiento (default hoy, no futura) |
| created_at | timestamptz | timestamp real |
| corrects_movement_id | uuid FK nullable | si corrige/anula otro movimiento |

> **Decisión técnica:** se denormaliza `actor_name` en el movimiento. Así el manager no necesita permiso para leer otros `profiles`, el historial es históricamente exacto y el export es autocontenido. Es consistente con el `time_entries.specialist_name` ya existente.

### Invariantes
- `assigned_total = Σ(amount de movimientos type ampliacion)` (la carga inicial es una ampliación).
- `consumed_total = Σ(|amount| de movimientos type consumo)` (ajustado por correcciones/anulaciones).
- `remaining = assigned_total − consumed_total` (puede ser negativo → excedido).

---

## 6. Motor de ledger

Función `registrar_movimiento_hucha(...)` (`SECURITY DEFINER`), en una transacción:
1. Verifica permisos del caller (asignación para consumo; admin para ampliación/corrección; usuario activo).
2. Valida campos (monto > 0, descripción no vacía para consumo, fecha no futura, etc.).
3. Bloquea la fila del banco (`SELECT … FOR UPDATE`) para evitar carreras.
4. Calcula `balance_before`, inserta el movimiento inmutable (con `actor_name` snapshot), calcula `balance_after`.
5. Actualiza los caches del banco (`assigned_total` / `consumed_total` / `remaining` / `status`).

**Corregir = postear un movimiento reverso** (`correccion`/`anulacion` con `corrects_movement_id`), nunca un DELETE. El historial pasado permanece intacto.

---

## 7. Permisos a nivel de datos (RLS)

### Lecturas (RLS por tabla)
| Tabla | `operativo` | `manager` | `admin` |
|---|---|---|---|
| `profiles` | propio | propio | todos |
| `projects` | — | solo asignados | todos |
| `project_assignments` | — | propias | todas |
| `hucha_banks` | — | bancos de proyectos asignados | todos |
| `hucha_movements` | — | movimientos de sus proyectos | todos |

### Escrituras
| Acción | Quién | Mecanismo |
|---|---|---|
| Crear/editar proyecto | admin | RLS write admin-only |
| Crear usuarios / asignar proyectos | admin | RLS write admin-only |
| Registrar consumo | manager asignado | función (verifica asignación) |
| Ampliar presupuesto | admin | función (rechaza no-admin) |
| Corregir / anular | admin | función (crea reverso) |
| Modificar saldo directamente | **nadie** | `hucha_banks` sin policy UPDATE para clientes |
| Borrar movimientos | **nadie** | sin policy DELETE (ledger inmutable) |

El banco se crea por **trigger** al crear el proyecto (en 0) → siempre existe presupuesto asociado (§10).

---

## 8. Superficie de la app (pantallas y flujos)

### Manager — `/presupuestos`
- **Mis proyectos** (= su dashboard): lista de proyectos asignados con Asignado · Consumido · Restante · Estado (badge). Doble como dashboard scoped del manager.
- **Detalle proyecto** `/presupuestos/[id]`: saldo disponible + form de consumo + historial del proyecto.
- **Descargar** CSV/Excel de sus proyectos.

**Form "Registrar consumo"** (§6.1, entrada individual):
Proyecto (preseleccionado) · Presupuesto disponible (auto, solo lectura) · Monto consumido (>0) · Descripción/referencia (obligatoria) · Fecha (default hoy, no futura) · Usuario (auto).
→ Llama `registrar_movimiento_hucha('consumo')`.

### Admin — `/admin`
- **Usuarios:** crear usuario (nombre, email, rol, estado) + asignar proyectos.
- **Proyectos:** crear/editar (nombre, cliente opcional, estado); crea banco en 0 automáticamente; asignar managers.
- **Presupuestos / Dashboard:** todos los proyectos + acciones **Ampliar** y **Corregir**.
- **Descargas:** todos los export.

**Form "Ampliar presupuesto"** (§8.1, solo admin):
Proyecto · Monto añadido (>0) · Motivo · Referencia · Fecha · Usuario responsable (auto).
→ Llama `registrar_movimiento_hucha('ampliacion')`.

### Dashboard (§12) — compartido, scoped por RLS
Tabla **Proyecto · Asignado · Consumido · Restante · Estado**; filtros **Proyecto · Manager · Estado · Rango de fechas**. Manager scoped a lo suyo; admin ve todo (misma pantalla, distinto alcance por RLS).

### Descargas (§13) — Excel/CSV (reusa `xlsx`)
Presupuestos por proyecto · Historial de consumos · Historial de ampliaciones · Proyectos excedidos · Proyectos con disponible.

### Flujos (§15)
- **Manager:** login → Mis proyectos → selecciona → ve disponible → registra consumo → guarda → se descuenta → queda en historial.
- **Admin:** login → ve todos → amplía / corrige → descarga → revisa excedidos o sin presupuesto.

### Capa visual
Componentes **shadcn/ui** sobre Tailwind, diseño **limpio y corporativo** (sobrio, profesional). Consistencia visual entre HUCHA y Horas. shadcn/ui se inicializa en el proyecto (hoy hay Tailwind v4, sin shadcn).

---

## 9. Validaciones y casos borde

**Doble capa:** cliente (UX) + función de Postgres (autoridad).

### Validaciones de consumo (§10)
Usuario con permiso sobre el proyecto · proyecto/banco existe · monto > 0 y numérico · descripción no vacía · fecha no futura · manager no modifica el total · movimiento siempre en historial.

> HUCHA **no** tiene ventana de "7 días atrás" (eso es de Horas); solo "fecha no futura".

### Validaciones de ampliación (§8.1)
Monto añadido > 0 · motivo obligatorio · solo admin.

### Casos borde (decisiones)
1. **Sobreconsumo** (incl. banco en 0): permitido, `remaining` negativo, estado `excedido`. La UI avisa antes de confirmar, no bloquea.
2. **Concurrencia:** la función bloquea la fila del banco (`FOR UPDATE`) → saldo siempre consistente.
3. **Corrección/anulación:** movimiento reverso con su propio before/after; no reescribe el pasado.
4. **Estados (precedencia):** `excedido` (rem<0) → `consumido` (rem=0) → `bajo` (0<rem<umbral) → `disponible` (rem≥umbral) → `sin_presupuesto` (nunca asignado ni consumido).
5. **Dinero:** `numeric(14,2)`, una moneda por banco (`EUR` default — euros).
6. **Usuario inactivo:** no puede registrar.
7. **Proyecto:** se archiva (no se borra); archivado no acepta nuevos consumos, conserva historial.

---

## 10. Testing

Cobertura proporcional al riesgo. El ledger mueve dinero → se prueba en serio; el CRUD → smoke tests.

1. **Ledger (crítico):** consumo descuenta exacto (before/after); ampliación suma; carga inicial; sobreconsumo → negativo/excedido; corrección revierte sin tocar el pasado; **concurrencia** (dos consumos simultáneos → consistente).
2. **Permisos (RLS + función):** manager no amplía; manager no ve/consume proyectos no asignados; manager descarga solo lo suyo.
3. **Validaciones:** monto ≤ 0, descripción vacía, fecha futura → rechazados.

**Herramientas:** `pgTAP` para función y políticas RLS dentro de Postgres; tests de integración con el cliente Supabase contra stack local (`supabase start`) para caminos felices/tristes del RPC; smoke tests ligeros en pantallas CRUD.

---

## 11. Decisiones abiertas / revisables
1. **Descargas del manager** — habilitadas para sus proyectos; revisar en reunión si se restringe a solo-admin.
2. **4º rol** ("usuario autorizado" que amplíe sin ser admin) — no necesario ahora; reconsiderar si surge el caso.
3. **Migración de `time_entries`** a la estructura padre+líneas — trabajo futuro, al construir Horas v2.

---

## 12. Mapa a las especificaciones (trazabilidad)
| Sección PDF HUCHA | Cubierto en |
|---|---|
| §1-2 objetivo / banco | §1, §4, §5 |
| §3 diferencia con horas | §2 (fuera de alcance) |
| §4 usuarios y permisos | §3, §7 |
| §5 banco de presupuesto | §5, §6 |
| §6 registro de consumo | §8 (form) |
| §7 descripción/referencia | §5 (campos) |
| §8 ampliación | §3, §7, §8 (form) |
| §9 historial | §4 (ledger), §5 |
| §10 validaciones | §9 |
| §11 estados | §9 (precedencia) |
| §12 dashboard | §8 |
| §13 descargas | §8 |
| §14 MVP | §2 (alcance) |
| §15 flujos | §8 |
| §16 punto clave | §2, §4 (Enfoque 2) |

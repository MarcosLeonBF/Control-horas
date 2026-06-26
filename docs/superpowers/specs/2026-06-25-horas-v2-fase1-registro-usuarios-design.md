# Diseño — Horas v2 · Fase 1: Registro diario + usuarios

> Spec de la primera fase de la reconstrucción de la app de Control de Horas (Horas v2).
> Fuente de requisitos: `Especificaciones App de Control de horas.pdf` (se citan secciones como §N).
> Documento vivo. Estética y fundación compartidas con HUCHA.
> Relacionados: [`2026-06-23-hucha-presupuestos-design.md`](2026-06-23-hucha-presupuestos-design.md), [`../REGISTRO-DECISIONES-Y-ESTADO.md`](../REGISTRO-DECISIONES-Y-ESTADO.md)

**Fecha:** 2026-06-25

---

## 1. Contexto y objetivo

La app de Horas actual ("legacy") es una versión mínima: guarda registros planos de una sola línea en `time_entries` (con `specialist_email` como texto, sin vínculo a `profiles`), lee los proyectos y sus horas totales en vivo desde un Excel (Microsoft Graph, solo lectura) y muestra pantallas básicas de registrar/proyectos/reportes. **No** tiene registro diario multilínea, **ni** bancos en base de datos, **ni** ledger de movimientos.

El PDF describe una reconstrucción completa (Horas v2) en 5 fases (§19). Este spec cubre **solo la Fase 1**: registro diario multilínea + usuarios. Se construye sobre la **fundación compartida** ya creada para HUCHA (`profiles` con roles, patrón ledger) siguiendo un enfoque **strangler fig**: la Horas legacy queda congelada y se reemplaza por v2 de forma incremental.

**Objetivo de la Fase 1:** que cada usuario registre "su día de trabajo" en una sola pantalla, con varias líneas, guardado de forma estructurada (padre + líneas) y validado, listo para que la Fase 2 enganche los bancos de horas sin rehacer el modelo.

---

## 2. Alcance (PDF §19, "Fase 1: Registro y usuarios")

**Incluye:**
- Login (auth Supabase, ya existente).
- Alta interna de usuarios por admin (formulario mínimo).
- Roles y permisos básicos.
- Registro diario con múltiples líneas.
- Fecha editable hasta 7 días atrás.
- Corrección de registros propios dentro del rango permitido.
- Proyecto especial "Departamento" (horas internas).
- Campo Departamento con lógica condicional.

**Fuera de alcance (fases siguientes):**
- Descuento de bancos de horas y movimientos (Fase 2).
- Ampliación manual de bancos (Fase 2).
- Historial de movimientos del banco (Fase 2).
- Alertas 80/100/exceso vía Slack/Zapier (Fase 4).
- Dashboard con filtros y descargas Excel/CSV (Fase 5).
- Panel de administración de usuarios completo y auditoría completa (Fase 3).

> En la Fase 1, las líneas capturan el **área** pero **no descuentan** de ningún banco (los bancos no existen todavía en DB). El área queda registrada para reportes y para el enganche de la Fase 2.

---

## 3. Roles y permisos

**Decisión (definida por el usuario):** se mantienen **3 roles**, reusando `profiles`:

- **operativo** — solo gestiona **sus** horas: registra y corrige sus propios registros (dentro de la ventana de 7 días). No ve registros de otros, no amplía bancos, no crea nada.
- **manager** — todo lo de operativo **+ ver** las horas registradas (de su equipo/área). **No** puede ampliar horas/bancos ni "agregar" (crear usuarios, bancos ni ampliaciones).
- **administrador (admin)** — **poder absoluto**: registrar/corregir cualquier registro incluso fuera de rango, ver todo, ampliar bancos, crear usuarios y gestionar catálogos.

**Alineación con el PDF:** el PDF (§15) usa 4 niveles (operativo / manager / Administración / Admin); aquí "administrador" **consolida** "Administración" + "Admin". La definición de los 3 roles es consistente con la tabla §15: el manager ve registros/bancos de su equipo pero no amplía ni crea usuarios; el admin puede todo.

**Decisión diferida (D-Horas-1):** evaluar separar "Administración" de "Admin" cuando se construyan las fases de bancos/descargas. Relacionado con el punto abierto D9 del registro de decisiones.

**Permisos relevantes a la Fase 1 (consistente con PDF §15):**

| Funcionalidad | operativo | manager | admin |
|---|---|---|---|
| Registrar horas propias | Sí | Sí | Sí |
| Registrar horas hasta 7 días atrás | Sí | Sí | Sí |
| Corregir registros **propios** dentro de 7 días | Sí | Sí | Sí |
| Registrar/corregir horas **fuera** del rango | No | No | Sí |
| **Ver** horas registradas de otros | No | Sí (equipo/área) | Sí (todas) |
| Corregir registros de **otros** usuarios | No | No | Sí |
| Crear usuarios | No | No | Sí |
| Ampliar bancos / agregar | No | No | Sí (Fase 2+) |

> **"Ver horas registradas" (manager):** en la Fase 1 se habilita a **nivel de datos** vía RLS (el manager puede leer los `time_logs` de su ámbito; el operativo solo los propios; el admin todos). La pantalla consolidada de visualización/reportes para manager/admin se construye en la **Fase 5** (dashboard); en Fase 1 puede incluirse, si se quiere, un listado de solo lectura básico.

---

## 4. Modelo de datos (PDF §14)

Tablas nuevas (esquema `public`, Postgres/Supabase). Todas con RLS.

### 4.1 `areas` — catálogo de áreas/especialidades (§9)
- `id` uuid pk
- `name` text único (CRM, SEO, Paid Media, Diseño, Automatizaciones…)
- `active` boolean default true
- timestamps

Semilla inicial (editable): **CRM, SEO, Paid Media, Diseño, Automatizaciones, Contenido, Estrategia**.

Además, un área especial **"Interno"** (no asignable a usuarios), que representa el trabajo interno ilimitado del proyecto "Departamento" (PDF §2.2/§3.4: "Interno / ilimitado"). Se marca con un flag `is_internal` para distinguirla de las áreas operativas.

### 4.2 `etapas` — catálogo de etapas (selector "Etapa", §2)
- `id` uuid pk
- `name` text único
- `active` boolean default true
- timestamps

Semilla inicial (editable, tomada del código legacy `lib/types.ts`): **Setup, CRM, Servicios Mensuales**.

### 4.3 `user_areas` — relación usuario↔áreas (muchos-a-muchos, §9, §14.1)
- `id` uuid pk
- `user_id` uuid fk → `profiles.id`
- `area_id` uuid fk → `areas.id`
- único (`user_id`, `area_id`)

Un usuario puede tener varias áreas (PDF: "CRM + Automatizaciones"). El selector "Banco/Área" de cada línea se limita a las áreas del usuario.

### 4.4 `profiles` — usuarios (ya existe; se reusa)
Columnas existentes: `id, email, full_name, position, role, status, created_by, timestamps`. Cubren §14.1 salvo "área operativa" (→ `user_areas`) y "bancos asignados" (→ Fase 2/3).

### 4.5 `time_logs` — registro diario padre (§14.2)
- `id` uuid pk
- `user_id` uuid fk → `profiles.id`
- `entry_date` date
- `total_hours` numeric(6,2) (cache de la suma de líneas)
- `status` text — `guardado` | `editado` | `anulado`
- `created_by` uuid, `updated_by` uuid
- timestamps

> El estado `borrador` del PDF se omite en Fase 1 (YAGNI: el flujo es "guardar todo en una acción"). Se puede añadir luego sin romper nada.

### 4.6 `time_log_lines` — líneas del registro (§14.3)
- `id` uuid pk
- `log_id` uuid fk → `time_logs.id` (on delete cascade)
- `project` text — nombre del proyecto (del Excel) o "Departamento"
- `area_id` uuid fk → `areas.id` (not null; para el proyecto "Departamento" se usa el área especial **"Interno"**)
- `department` text — `Clientes` | `Ventas` | `Marketing` | `Todos`
- `etapa_id` uuid fk → `etapas.id`
- `hours` numeric(5,2) (> 0)
- `description` text (no vacío)
- `created_by` uuid, `updated_by` uuid
- timestamps

> Cálculo: `time_logs.total_hours = Σ time_log_lines.hours`. Se mantiene en el guardado/edición transaccional.
>
> **Divergencia deliberada del "modelo sugerido" (§14.3):** el PDF sugiere repetir `usuario` y `fecha` en cada línea y un `estado` por línea. Aquí se **normaliza**: `user_id`/`entry_date`/`status` viven en el padre `time_logs` (única fuente de verdad), y las líneas heredan ese contexto vía `log_id`. El §14 es explícitamente un "modelo **sugerido**"; esta normalización conserva la misma información sin duplicarla y evita inconsistencias.

### 4.7 Guardado transaccional
El registro diario se guarda en **una sola operación atómica** (función RPC `security definer`): inserta/actualiza el `time_logs` y sus `time_log_lines` juntos, recalcula `total_hours`, valida permisos y rango de fecha. Alinea con §2.3 y §20 ("una sola experiencia para el usuario, varias líneas para el sistema"). Mismo patrón de RPC que el ledger de HUCHA.

---

## 5. Registro diario multilínea (PDF §2–§7)

### 5.1 Pantalla (§2.1, §2.3)
Tabla editable. El usuario puede:
- Seleccionar la fecha del registro (default hoy).
- Ver su usuario cargado automáticamente.
- Añadir / eliminar líneas antes de guardar.
- Completar en cada línea: proyecto, banco/área, departamento, etapa, horas, descripción.
- Ver el **total del día** acumulado antes de guardar.
- Guardar todo el día en una sola acción.

Columnas de cada línea: **Proyecto · Banco/Área · Departamento · Etapa · Horas · Descripción · (eliminar)**.

### 5.2 Selectores y su origen
- **Proyecto:** lista del Excel (solo lectura, vía Graph, como hoy) + el especial **"Departamento"**.
- **Banco/Área:** para proyectos de cliente, limitado a las áreas del usuario (`user_areas`) — "automático con el usuario" (§2): si tiene una sola área se autocompleta, si tiene varias se elige. Para el proyecto "Departamento", el área se fija en **"Interno"** (no se elige de las del usuario).
- **Departamento:** según lógica condicional (§5.3).
- **Etapa:** catálogo `etapas`.

### 5.3 Campo Departamento condicional (§3)
| Proyecto seleccionado | Comportamiento del campo Departamento |
|---|---|
| Proyecto de cliente | `Departamento = Clientes`, **no editable** |
| "Departamento" (especial) | **Editable**: `Clientes` / `Ventas` / `Marketing` / `Todos` |

El proyecto "Departamento" representa trabajo interno ilimitado: en Fase 2 **no** descontará banco. En Fase 1 solo se registra.

### 5.4 Fecha y ventana de 7 días (§4)
- Default: fecha actual.
- Operativo/manager: pueden registrar/corregir desde hoy hasta **7 días atrás**.
- No se permiten fechas futuras ni con más de 7 días de antigüedad.
- **Admin**: puede registrar/corregir fuera de ese rango.

### 5.5 Validaciones antes de guardar (§5)
- Al menos una línea.
- Cada línea con proyecto, banco/área, departamento, etapa.
- Horas > 0 y numéricas.
- Descripción completa (no vacía).
- Fecha no futura y dentro del rango permitido (según rol).
- Sin líneas duplicadas por error (misma combinación proyecto+área+departamento+etapa).
- Total de horas del día visible antes de guardar.

### 5.6 Corrección / edición (§7)
- El usuario corrige **registros propios** dentro de los 7 días; el **admin** corrige cualquiera, incluso fuera de rango.
- Editar un registro actualiza sus líneas y marca el `time_logs` como `editado`.
- **En Fase 1 no hay recálculo de bancos** (no existen aún); ese comportamiento (§7: devolver/descontar horas al cambiar proyecto/banco) se implementa en la Fase 2.
- La auditoría completa (§7 "toda corrección registrada en auditoría") es de Fase 3; en Fase 1 se conserva `updated_by`/`updated_at` y el estado `editado`.

---

## 6. Alta de usuarios (PDF §8)

Formulario mínimo, solo para `admin`:
- Nombre, correo, contraseña inicial, posición, rol, área(s), estado (activo/inactivo).
- El alta crea el usuario en Supabase Auth + su `profiles` + sus `user_areas`.
- El usuario **no** puede editar por su cuenta datos sensibles (rol, posición, permisos, áreas).

"Bancos asignados" (§8) se difiere a Fase 2/3 (no hay bancos aún).

---

## 7. Rutas, estética y testing

- **Strangler fig:** Horas v2 vive en un grupo de rutas nuevo (p. ej. `app/(horas)/…`). La Horas legacy (`app/(app)/…`) queda **congelada** hasta el corte. El redireccionamiento por rol (`app/page.tsx`) se actualizará para apuntar a v2 cuando la fase esté lista.
- **Estética:** paleta de marca Bastida & Farina + shadcn/ui (la estética editorial aplica a toda la plataforma, no solo a HUCHA).
- **Testing:** E2E Playwright happy-path (alta de usuario, registro diario multilínea, validaciones, ventana de 7 días, Departamento condicional). El **dev server lo gestiona el usuario**: la config de Playwright no arranca el server (sin bloque `webServer`), asume `http://localhost:3000` levantado. Seed vía service_role, como en HUCHA.

---

## 8. Decisiones diferidas y preguntas abiertas

- **D-Horas-1:** 3 vs 4 roles (separar "Administración" de "Admin") — revisitar en fases de bancos/descargas.
- **Catálogos** (`areas`, `etapas`) sembrados con valores iniciales editables; falta la lista definitiva de la agencia.
- **Bancos por área (pista importante):** el archivo de SharePoint configurado se llama **"Banco de Horas CRM.xlsx"** — es decir, el banco específico de **CRM**. Esto sugiere que los bancos viven en **archivos Excel separados por área** (Banco de Horas CRM, SEO, Diseño…), cada uno con `proyecto + horas`. El modelo de bancos por cliente+área de la Fase 2 deberá confirmar esto (¿un archivo por área? ¿una pestaña por área?) y cómo se sincroniza cada uno. A definir en el spec de Fase 2.
- **Fuente de proyectos:** en Fase 1 se leen del Excel en vivo (como hoy). Si en el futuro se sincronizan a DB, no afecta el modelo de líneas (guardan el nombre del proyecto).

---

## 9. Trazabilidad con el PDF

| Sección de este spec | PDF |
|---|---|
| Alcance (§2) | §19 Fase 1 |
| Roles y permisos (§3) | §15 |
| `time_logs` / `time_log_lines` (§4.5–4.6) | §14.2, §14.3 |
| `areas` / `user_areas` (§4.1, §4.3) | §9, §14.1 |
| Registro multilínea (§5.1) | §2.1, §2.3, §20 |
| Departamento condicional (§5.3) | §3 |
| Ventana 7 días (§5.4) | §4 |
| Validaciones (§5.5) | §5 |
| Corrección (§5.6) | §7 |
| Alta de usuarios (§6) | §8 |

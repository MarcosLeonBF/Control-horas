# Registro de decisiones y estado — Proyecto controlHoras

> Documento vivo, en lenguaje no técnico, pensado para reuniones y seguimiento.
> Para el detalle técnico ver:
> - Diseño: [`specs/2026-06-23-hucha-presupuestos-design.md`](specs/2026-06-23-hucha-presupuestos-design.md)
> - Plan de implementación 1: [`plans/2026-06-23-plan1-fundacion-datos-ledger.md`](plans/2026-06-23-plan1-fundacion-datos-ledger.md)

**Última actualización:** 2026-06-28 (HUCHA Plan 3b completo: admin + dashboard + descargas. Confirmado el Excel real en SharePoint y sus tablas/columnas)

---

## 1. Qué estamos construyendo

Dos aplicaciones internas relacionadas para Bastida & Farina, que comparten una misma base:

1. **Control de Horas** — registro de horas del equipo con "bancos de horas" por cliente/proyecto/área, alertas, dashboard. Ya existe una primera versión muy básica.
2. **Presupuesto HUCHA** — versión simple del mismo concepto de "banco", pero con **dinero**: cada proyecto tiene una hucha de presupuesto; los managers registran gastos (consumos) y administración la amplía.

---

## 2. Decisiones tomadas (con su porqué)

| # | Decisión | Por qué | Estado |
|---|---|---|---|
| D1 | **Empezar por HUCHA**, no por Horas | HUCHA es la app simple y ejercita la misma base (usuarios, banco, historial, dashboard, export) con mucho menos riesgo y entrega rápida | Firme |
| D2 | **Construir una "fundación compartida"** al hacer HUCHA | Usuarios+roles, proyectos y el "banco+historial" se diseñan una vez y Horas los reutiliza después | Firme |
| D3 | **Nombre: HUCHA** (con H) | El PDF lo escribe "UCHA" sin H; es un error. Se usa HUCHA en todo | Firme |
| D4 | **Moneda: EUR (euros)** | Confirmado por el cliente; el PDF usaba USD en ejemplos | Firme |
| D5 | **3 roles**: operativo / manager / admin | Suficiente para ambas apps; se fusiona "Administración" y "Admin" en uno | Firme (revisable a 4 roles si hace falta) |
| D6 | **No tocar la versión actual de Horas**; construir al lado y reconstruir Horas después | La versión actual se reescribirá igual (para registro multilínea); migrarla ahora sería trabajo doble | Firme |
| D7 | **Banco + "ledger" (libro de movimientos)** como patrón central | Guardar cada movimiento (no solo el saldo) da auditoría completa y permite corregir sin borrar | Firme |
| D8 | **El manager puede descargar los datos de sus proyectos** | Es el mismo dato que ya ve; sin coste técnico | **Revisable en reunión** (el PDF da la descarga solo al admin) |
| D9 | **"Usuario autorizado" que amplía = admin** por ahora | Con 3 roles, ese permiso recae en admin | Revisable (futuro 4º rol) |
| D10 | **Design system de plataforma: shadcn/ui + estética "Estudio"** (editorial/suizo: formal, elegante, atemporal, cómoda) con **paleta de colores de marca Bastida & Farina** (carmín #BD0842, vino #54123D, tinta #1D1D1B + neutros cálidos) | Consistencia visual profesional en **toda la plataforma**, anclada al producto principal (Control de Horas); HUCHA la hereda. Tokens globales en `app/globals.css`. Se descartó "Tesorería" por sesgo a dinero | Firme |
| D11 | **Trabajar directo sobre producción** (Supabase y git) | El proyecto aún no está en uso → es seguro y ágil | Firme (mientras no haya usuarios reales) |

---

## 3. Alcance de HUCHA (resumen)

**Incluye:** login, usuarios creados por admin con proyectos asignados, presupuesto por proyecto (empieza en 0), registro individual de consumo, descuento automático, ampliación solo admin, historial de movimientos, dashboard con estados, y descarga Excel/CSV.

**No incluye** (es de Horas, lo dice el propio PDF): registro multilínea, etapas, departamento, banco por rol, cálculo por usuario, flujos de aprobación.

**Estados de una hucha:** sin presupuesto · disponible · bajo · consumido · excedido.

---

## 4. Plan de trabajo por fases

- **Plan 1 — Fundación de datos + Ledger** (base de datos): usuarios/roles, proyectos, asignaciones, banco+movimientos y sus reglas. *(en curso)*
- **Plan 2 — App HUCHA (Manager):** pantallas del manager (sus proyectos, registrar consumo, historial).
- **Plan 3 — App HUCHA (Admin + Dashboard + Descargas):** gestión de usuarios/proyectos, ampliar/corregir, dashboard global y exports.

Cada plan deja software funcionando y probado antes de pasar al siguiente.

---

## 5. Estado de avance

### Plan 1 — Fundación de datos + Ledger — ✅ COMPLETADO
| Task | Descripción | Estado |
|---|---|---|
| 1 | Usuarios/roles, proyectos, asignaciones (+ creación automática de perfil, permisos base) | ✅ Completada y revisada |
| 2 | Tablas de la hucha (banco + movimientos), estados y creación automática de la hucha al crear proyecto | ✅ Completada y revisada |
| 3 | Motor del libro de movimientos (registrar consumo/ampliación/anulación con sus validaciones) | ✅ Completada y revisada |
| 4 | Reglas de seguridad/permisos a nivel base de datos (RLS) | ✅ Completada y revisada |

**Review final de toda la rama: ✅ aprobado** — esquema coherente, seguridad de punta a punta (sin escalación de rol, sin escritura directa de saldos, aislamiento entre managers), cuentas del dinero correctas. Sin hallazgos graves; 6 observaciones menores registradas y diferidas.

**Método de calidad:** cada pieza se construye con prueba primero (falla → se implementa → pasa), se revisa de forma independiente, y se corrige antes de avanzar. Migraciones aplicadas a producción vía Supabase; un hallazgo importante (anular una anulación) se detectó en review y se corrigió con su propio test.

**Lo que ya existe en la base de datos:** las 5 tablas, la creación automática de la hucha al crear un proyecto, el alta automática de perfil al crear un usuario, y el motor que registra consumos/ampliaciones/anulaciones manteniendo el saldo y el historial — todo con permisos por rol. Falta solo la interfaz (Planes 2 y 3).

### Plan 2 — App HUCHA (Manager) — ✅ COMPLETADO
| Task | Descripción | Estado |
|---|---|---|
| 1 | Identidad de marca (Bastida & Farina), componentes base y arnés de pruebas E2E | ✅ Completada y revisada |
| 2 | Acceso por rol, navegación y pantalla de ingreso con la marca | ✅ Completada y revisada |
| 3 | "Mis proyectos": lista con saldo y estado de cada hucha | ✅ Completada y revisada |
| 4 | Detalle de proyecto con saldo e historial de movimientos | ✅ Completada y revisada |
| 5 | Registrar consumo (con validación y aviso de confirmación) | ✅ Completada y revisada |

**Estética:** se aplicó la paleta de marca (carmín/vino sobre fondo cálido) y un estilo editorial limpio a toda la plataforma, no solo a HUCHA.

**Pruebas:** suite E2E de camino feliz (acceso, mis proyectos, detalle, registrar consumo) — 8/8 en verde. El dev server lo gestiona el usuario; las pruebas asumen el servidor ya levantado.

### Horas v2 — Fase 1 (Registro diario + usuarios) — ✅ COMPLETADA
Reconstrucción de la app de Control de Horas (estaba pausado HUCHA a la espera del Excel). Enfoque *strangler fig*: se **retiró la app de Horas legacy** y la v2 ocupa las rutas raíz, reutilizando la fundación compartida (perfiles, roles, patrón ledger).

| Pieza | Estado |
|---|---|
| Catálogos (áreas, etapas) + relación usuario↔áreas | ✅ migración + RLS + test |
| Registro diario padre/líneas (`time_logs` + `time_log_lines`) | ✅ migración + RLS (escritura solo por RPC) + test |
| Motor transaccional para guardar/anular registros (validaciones, ventana 7 días, sin duplicados, **área debe ser del usuario**) | ✅ RPC + tests de autorización |
| Pantalla de **registro diario multilínea** (añadir/quitar líneas, total del día, Departamento condicional) + edición | ✅ + E2E |
| **Mis registros** (ver, editar y anular los propios) | ✅ + E2E |
| **Alta de usuarios** por admin (rol + áreas) | ✅ + E2E |
| **Vista de equipo** (manager/admin, solo lectura) | ✅ + E2E |

**Roles (definidos por el usuario):** *operativo* (solo registra/corrige sus horas), *manager* (ve las horas registradas, no amplía ni crea), *administrador* (poder absoluto).

**Calidad:** cada pieza con prueba (SQL para la base, E2E Playwright para la app), revisión independiente por tarea y review final de toda la rama. Se cerró un hallazgo importante: la validación de que el área de cada línea pertenece al usuario ahora vive en el motor (no solo en la pantalla), dejando la base lista para los bancos de la Fase 2. El dashboard/descargas, las alertas y los bancos de horas por área quedan para fases siguientes.

### HUCHA · Plan 3a — Sincronización desde el Excel — ✅ COMPLETADA
Con el Excel `Presupuestos Hucha.xlsx` provisto, se construyó el **sincronizador** que puebla la app HUCHA con datos reales:
- Lee la tabla `ProyectosHucha_1` (Proyecto, Hucha) y el `Manager del proyecto` de `Clientes_Proyectos` (solo lectura, vía Microsoft Graph; nunca escribe al Excel).
- Sincroniza solo los proyectos con presupuesto (`Hucha > 0`); el monto es la **base** del banco (las ampliaciones del admin van encima como valor agregado).
- Asigna el manager **por nombre** (los que no matchean un usuario se reportan, sin bloquear).
- Pantalla **solo-admin** con botón "Sincronizar con Excel" y un resumen del resultado.

*Estado del Excel hoy:* de 233 proyectos, **1** tiene presupuesto cargado (Impladent, 2.500 €, manager "Pilar"); a medida que carguen más `Hucha` en el Excel, el sync los irá tomando.

**Calidad:** modelo con test SQL, lógica con test de fixtures (incluye re-sync), lector verificado contra el Excel real, pantalla con E2E; revisión por tarea + review final ("listo para merge con fixes", sin defectos críticos).

### HUCHA · Plan 3b-i — Admin: ampliar + corregir/anular — ✅ COMPLETADA
El admin ya puede operar el dinero desde el detalle del proyecto:
- **Ampliar** presupuesto (valor agregado, con motivo/referencia/fecha) — sube el asignado sin tocar la base del Excel.
- **Anular** movimientos (corregir = anular el equivocado + volver a registrar). El botón se inhabilita en anulaciones y en movimientos ya anulados.
- Se cerró un hueco del motor: no se puede anular dos veces el mismo movimiento.

**Calidad:** test SQL del guard + E2E de ampliar y anular (sesión admin); cada tarea revisada y aprobada.

### Login y navegación (mejoras transversales)
- **Login de pantalla completa** con identidad de marca (gradiente carmín→vino, logo, campos editoriales, ojo de contraseña), construido con shadcn/ui.
- **Entrada unificada a Horas:** tras el login todos entran a Control de Horas; manager/admin acceden a HUCHA por un link en la barra. Logo de la empresa en ambas barras.
- Corrección: el área de cada línea de horas se exige solo a **operativos**; manager/admin registran contra cualquier área.

### HUCHA · Plan 3b-ii — Dashboard global (admin) — ✅ COMPLETADA (PDF §12)
Vista solo-admin `/presupuestos/dashboard` con la foto de **todos** los proyectos, diseñada para ser legible y no redundante:
- **KPIs** arriba: asignado / consumido / restante totales + conteo de **excedidos** y **bajos**, que se recalculan según los filtros.
- **Tabla** con una **barra de consumo** coloreada por estado (restante / asignado) en vez de tres columnas de números; **ordenada por severidad** (los excedidos/bajos primero).
- **Filtros**: búsqueda de proyecto/cliente, estado y manager.
- Construida con shadcn (Card/Table/Input) + lucide, tipada; E2E admin verde.

### HUCHA · Plan 3b-iii — Descargas (admin) — ✅ COMPLETADA (PDF §13)
Todas las descargas viven en el **Dashboard**, en una barra única bajo los filtros, sin botones redundantes:
- **Presupuestos**: exporta la **vista filtrada** de la tabla (proyecto, cliente, manager, asignado, consumido, restante, estado). Así los reportes de **excedidos** y **disponibles** del §13 salen filtrando el estado y descargando — un solo punto de descarga en lugar de un botón por cada caso.
- **Consumos** y **Ampliaciones**: el monto y detalle de **todos** los proyectos, vía Server Action solo-admin (`getMovimientosExport`).
- Cada dataset se baja en **Excel** (SheetJS, import dinámico) o **CSV** (con BOM para Excel/acentos). Utilidad común en `lib/hucha/export.ts`.
- Construido inline (sin sobre-planificar); E2E admin verde (descarga del CSV de presupuestos verificada por `suggestedFilename`).

### Horas v2 · Fase 2 — Paso 1: Bancos de horas (vista) — ✅ COMPLETADA
Decisión confirmada: **banco por proyecto** (el Excel de banco de horas — tabla `BancoHoras` = [Proyecto, Horas CRM] — da el total **por proyecto, no por área**; el área sigue siendo solo dimensión de la línea).
- Nueva vista **`/bancos`** (manager+admin, enlazada en la nav de Horas): por proyecto, **asignado** (Excel, lectura en vivo) vs. **registrado** (suma de horas de logs no anulados), restante, estado y barra de consumo. KPIs + filtros (búsqueda/estado), mismo lenguaje visual que el dashboard HUCHA.
- Estados con los **mismos umbrales** que `compute_hucha_status` (disponible/bajo/consumido/excedido), calculados en `lib/horas/bancos-status.ts`. Read-model en `lib/horas/bancos.ts`. **Sin migración** (solo lectura).
- E2E admin verde. De paso se corrigió una fragilidad pre-existente: el E2E de ampliar HUCHA afirmaba un total absoluto del proyecto-fixture (compartido) → ahora afirma su propia fila de movimiento (a prueba de paralelismo).

### Horas v2 · Fase 2 — Paso 2: Ampliaciones de horas (admin) — ✅ COMPLETADA
El admin puede **ampliar el banco de horas** de un proyecto dentro de la app, sobre la base del Excel (igual que las ampliaciones de HUCHA). El Excel sigue siendo de solo lectura.
- **Detalle por proyecto** `/bancos/[proyecto]` (cada fila de `/bancos` enlaza aquí): asignado (Excel + ampliaciones), consumido, restante, estado, y el historial de ampliaciones. Asignado = **Horas CRM + Σ ampliaciones activas**.
- **Ampliar** (form admin: horas + motivo + fecha) y **anular** (soft-delete; deja de sumar). Escrituras vía RPC `SECURITY DEFINER` solo-admin (`ampliar_horas`, `anular_ampliacion_horas`); tabla `horas_ampliaciones` con RLS (lectura manager/admin, sin escritura directa). Migraciones 0014 (tabla+RPCs) y 0015 (FKs `created_by/voided_by` → `ON DELETE SET NULL`).
- **Calidad:** E2E admin (ampliar→anular, auto-limpiante) + test SQL del guard de rol (no-admin rechazado, sin fila residual); 9/9 del proyecto admin en verde.

### Horas v2 · Fase 5 — Reportes (dashboard consolidado) — ✅ COMPLETADA (PDF §17)
Pantalla **`/reportes`** (manager+admin), que el PDF llama "Dashboard / Reportes":
- **Resumen**: total de horas, horas **cliente vs internas** (Departamento), nº de líneas; recalculado con los filtros.
- **Agrupable** por **proyecto / usuario / área / departamento / etapa** (control segmentado), con barra de reparto y % sobre el total — cubre las vistas del §17 (consumo por proyecto/usuario/área/departamento, internas vs cliente).
- **Filtros**: rango de fechas (servidor) + proyecto/usuario/área (cliente, instantáneos).
- **Descargas Excel + CSV** (§17.5 pide ambos): **Resumen** (la vista agrupada actual) y **Detalle** (las líneas de registro crudas: fecha, usuario, proyecto, área, departamento, etapa, horas, descripción) — respetando los filtros activos. Utilidad de export compartida en `lib/export.ts`.
- Construida con el sistema editorial de marca; E2E admin verde (agrupar + descargar CSV).
- **Diferido:** el §17.6 pide que el manager vea solo su equipo/área; hoy manager+admin ven todo (igual que `/equipo`). Afinar el alcance por RLS queda para la fase de auditoría. "Consumo por cliente" no sale aún (el Excel de banco no trae cliente).

### Horas v2 · Fase 4 — Alertas de banco (Slack) — ✅ COMPLETADA (PDF §13)
Cuando alguien guarda/edita un registro, el sistema **recalcula el consumo de los proyectos afectados** y avisa a Slack si el banco cruza un umbral:
- **80%** (banco casi agotado), **100%** (sin horas disponibles), **exceso** (consumió más de lo asignado). Mensajes con el formato de los ejemplos del §13.
- **Dedupe**: cada umbral se avisa **una sola vez por proyecto** (tabla `horas_alertas`, migración 0016). Si un guardado salta varios umbrales, avisa solo el más severo y marca los demás.
- Se dispara desde el Server Action de guardar (`checkHorasAlertas`); **nunca rompe el guardado** (todo en try/catch). El envío usa un **Incoming Webhook de Slack** (`SLACK_WEBHOOK_URL` en `.env.local`); si no está configurado, es un no-op.
- **Calidad:** 7 unit tests del núcleo (umbrales + mensajes) en el proyecto `node-horas`; smoke del orquestador contra la DB real (siembra→verifica→limpia).
- **Pendiente del usuario:** crear el Incoming Webhook en Slack y poner su URL en `SLACK_WEBHOOK_URL`.

### Próximo
- Descargas adicionales del §17.5 (registros, líneas, movimientos), filtro de fechas en el dashboard HUCHA, y auditoría/editar-desactivar usuarios (Fase 3). ⏳ Por planificar.

---

## 6. De dónde salen los proyectos y presupuestos (definición 2026-06-25)

**Decisión clave:** HUCHA **no inventa proyectos ni presupuestos**. Replica exactamente la arquitectura del **banco de horas** que ya funciona en la app de Horas.

**Cómo funciona el banco de horas hoy (referencia):** la app lee en vivo una tabla de un Excel en SharePoint (vía Microsoft Graph). El Excel manda; la app solo lo muestra y **nunca lo escribe**. Lo único que guarda en su base de datos son los **consumos**. El restante y lo "excedido" se calculan. La descarga se arma desde la base de datos.

**HUCHA hace lo mismo, pero con dinero:**

| | Banco de Horas | Presupuesto HUCHA |
|---|---|---|
| Lista de proyectos | Excel (lectura en vivo) | Excel (lectura, **sincronizable**) |
| Presupuesto/total asignado | Excel | Excel |
| Qué proyectos aplican | Todos | **Solo los marcados** en el Excel (no todos tienen HUCHA) |
| Consumos | Base de datos | Base de datos |
| Restante / excedido | Se calculan | Se calculan |
| ¿Se escribe al Excel? | **Nunca** | **Nunca** |
| Historial / reporte | Desde la base de datos | Desde la base de datos |

**Reglas firmes acordadas:**
1. El **Excel es la única fuente** de proyectos y presupuesto asignado, y es de **solo lectura**. HUCHA jamás escribe ahí. Se podrá **resincronizar** con un botón (como "Actualizar banco").
2. **No todos los proyectos tienen HUCHA.** El Excel indicará con alguna columna/cualidad cuáles sí.
3. Los **consumos** los registran los managers dentro de HUCHA (van a la base de datos), nunca al Excel.
4. **Ampliaciones / "valor agregado":** como no se escribe al Excel, el presupuesto extra se maneja en HUCHA y aparece en el **reporte descargado**, sumado al total y marcado como agregado. Se hace de **dos formas combinadas**: (a) el **admin registra ampliaciones** con su motivo/referencia, y (b) lo que un proyecto quede **excedido sin ampliación** se reporta **automáticamente** como valor agregado. Mismo criterio que el banco de horas.

**El Excel SÍ existe y está cableado (Microsoft Graph).** Las 4 preguntas de abajo quedaron resueltas leyendo el archivo real (sincronización HUCHA ya corrida en producción):
- **Archivo HUCHA aparte** (`SHAREPOINT_HUCHA_FILE_URL`), distinto del banco de horas (`SHAREPOINT_FILE_URL`).
- **Tablas/columnas reales:**
  - Banco de horas → `BancoHoras` = **[Proyecto, Horas CRM]** (total de horas por proyecto).
  - HUCHA → `ProyectosHucha_1` = **[Proyecto, Hucha]** (presupuesto €; `Hucha > 0` marca "tiene HUCHA").
  - Maestro común → `Clientes_Proyectos` (Proyecto, **Manager del proyecto**, Estado, Mostrar, "Cuenta como Proyecto"…) y `Facturas_Completas`.
- **Clave de cruce**: nombre de proyecto (string), igual que el banco de horas.
- **Manager↔proyecto**: viene del Excel (`Clientes_Proyectos` → "Manager del proyecto"; se matchea por nombre contra `profiles.full_name`).

**Modelo de banco de horas (aclarado 2026-06-29 por el usuario):** el banco es **por proyecto**. El archivo `Banco de Horas CRM.xlsx` (`BancoHoras` = [Proyecto, Horas CRM]) es el **banco general de todos los proyectos**; **"CRM" NO es un área**, es el total del proyecto. El **área es un atributo del usuario** (el admin la asigna al crearlo, una o varias). No hay bancos separados por área. Así el §9/§10 se cumple con un banco por proyecto: cada línea descuenta del banco del proyecto, sin importar el área. → Lo construido (banco por proyecto + áreas de usuario) es el modelo correcto y final.

---

## 7. Temas a confirmar en la reunión
1. ✅ ~~Estructura del Excel de presupuestos~~ — **resuelto** (ver sección 6): el Excel existe y está cableado; HUCHA ya sincroniza.
2. ✅ ~~Banco de horas por área~~ — **resuelto** (2026-06-29): el banco es **por proyecto** (`Horas CRM` = banco general del proyecto, no un área); el **área es atributo del usuario** que el admin asigna al crearlo. No hay bancos por área. Lo construido es el modelo final.
3. **Descargas del manager** (D8) — ¿se mantiene o se restringe a solo admin?
4. **¿Hace falta un 4º rol** (alguien que amplíe presupuesto sin ser admin completo)? (D9)
5. Validar la frontera de alcance HUCHA vs Horas y el orden de fases.

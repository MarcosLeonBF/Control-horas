# Registro de decisiones y estado — Proyecto controlHoras

> Documento vivo, en lenguaje no técnico, pensado para reuniones y seguimiento.
> Para el detalle técnico ver:
> - Diseño: [`specs/2026-06-23-hucha-presupuestos-design.md`](specs/2026-06-23-hucha-presupuestos-design.md)
> - Plan de implementación 1: [`plans/2026-06-23-plan1-fundacion-datos-ledger.md`](plans/2026-06-23-plan1-fundacion-datos-ledger.md)

**Última actualización:** 2026-07-03 (Horas · descripciones por departamento + descripción libre en proyectos normales — aplicado a prod)

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
- **Consumos** y **Ampliaciones**: el monto y detalle de **todos** los proyectos, vía Server Action solo-admin (`getMovimientosExport`), **acotables por rango de fechas** (§12 "rango de fechas") con los campos *Período*. La tabla de estado es a fecha de hoy (asignado/restante son punto-en-tiempo), así que el rango aplica a estas descargas de movimientos, que es donde tiene sentido.
- Cada dataset se baja en **Excel** (SheetJS, import dinámico) o **CSV** (con BOM para Excel/acentos). Utilidad común en `lib/export.ts`.
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
- **Descargas Excel + CSV** (§17.5 pide ambos), respetando los filtros activos: **Resumen** (vista agrupada), **Detalle** (líneas de registro: fecha, usuario, proyecto, área, departamento, etapa, horas, descripción) y **Registros** (totales diarios por usuario). Además, `/bancos` descarga la **vista de bancos de horas** (y excedidos/cerca filtrando estado). Utilidad de export compartida en `lib/export.ts`.
- Construida con el sistema editorial de marca; E2E admin verde (agrupar + descargar CSV).
- **Diferido:** el §17.6 pide que el manager vea solo su equipo/área; hoy manager+admin ven todo (igual que `/equipo`). Afinar el alcance por RLS queda para la fase de auditoría. "Consumo por cliente" no sale aún (el Excel de banco no trae cliente).

### Horas v2 · Fase 4 — Alertas de banco (Slack) — ✅ COMPLETADA (PDF §13)
Cuando alguien guarda/edita un registro, el sistema **recalcula el consumo de los proyectos afectados** y avisa a Slack si el banco cruza un umbral:
- **80%** (banco casi agotado), **100%** (sin horas disponibles), **exceso** (consumió más de lo asignado). Mensajes con el formato de los ejemplos del §13.
- **Dedupe**: cada umbral se avisa **una sola vez por proyecto** (tabla `horas_alertas`, migración 0016). Si un guardado salta varios umbrales, avisa solo el más severo y marca los demás.
- Se dispara desde el Server Action de guardar (`checkHorasAlertas`); **nunca rompe el guardado** (todo en try/catch). El envío usa un **Incoming Webhook de Slack** (`SLACK_WEBHOOK_URL` en `.env.local`); si no está configurado, es un no-op.
- **Calidad:** 7 unit tests del núcleo (umbrales + mensajes) en el proyecto `node-horas`; smoke del orquestador contra la DB real (siembra→verifica→limpia).
- **Pendiente del usuario:** crear el Incoming Webhook en Slack y poner su URL en `SLACK_WEBHOOK_URL`.

### Horas v2 · Fase 3 — Panel de usuarios — ✅ COMPLETADA (parcial; PDF §8/§19)
La pantalla de Usuarios (admin) ya no solo da de alta — ahora **gestiona**:
- **Panel** con la lista de usuarios (nombre, correo, posición, rol, áreas, estado).
- **Editar** por fila: nombre, posición, rol, **estado activo/inactivo** y áreas asignadas (`actualizarUsuario`).
- **Activar/Desactivar** rápido (`cambiarEstadoUsuario`). El `status` ya gobernaba el acceso (el RPC de guardar rechaza usuarios inactivos).
- Guardas: un admin **no puede desactivarse ni quitarse el rol** a sí mismo (evita auto-bloqueo). Escrituras solo-admin vía service role.
- **Calidad:** E2E admin (crear → ver en panel → desactivar), auto-limpiante.

**Auditoría (§7) — ✅ COMPLETADA.** Toda **creación, edición y anulación** de registros queda trazada en la tabla `time_log_audit` (migración 0017), poblada **dentro de los RPC** (`guardar_registro`, `anular_registro_diario`) — atómico con el cambio, guardando quién (actor), de quién es el registro (subject), acción, fecha y total. Vista **`/admin/auditoria`** (admin) con el historial. Test SQL (crear+editar+anular) verde + E2E de la pantalla.
- **Pendiente de Fase 3:** gestión de proyectos/etapas/departamentos desde la app (hoy se administran fuera).

### Horas · Mejoras de registro (2026-06-29)
Dos ajustes sobre la pantalla de **Registrar horas**, pedidos por el usuario:
- **Fecha por línea.** Antes el registro tenía **una sola fecha** para todas las líneas. Ahora hay una **fecha por defecto** (hoy) que heredan todas las líneas, pero **cada línea puede llevar su propia fecha** — para anotar algo de un día pasado sin abrir otro registro. Al guardar, las líneas se **reparten por día**: cada fecha se guarda como su **propia entrada diaria** (el modelo "un registro por día" **no cambia**, así reportes/bancos/auditoría siguen igual). Al **editar**, también se puede mover una línea a otro día: el registro se **divide** en los días que toque, sin dejar registros vacíos. La **ventana de 7 días** (no-admin) se valida **por línea**; el admin puede saltarla.
  - *Motor:* nuevo RPC `guardar_registro` (migración **0019**) que reemplaza a `guardar_registro_diario`: valida fecha/7 días por línea, **anti-duplicados por fecha+combinación** (la misma combinación en días distintos ya no es duplicado), agrupa por fecha y reconcilia (alta = un log por fecha; edición = reutiliza el registro editado para su día y crea logs nuevos para el resto). La **auditoría** escribe un asiento por día afectado.
- **Selector "Departamento" condicional (UI).** El selector de Departamento (Clientes/Ventas/Marketing/Todos) ahora **permanece oculto** hasta elegir el proyecto **"Departamento"** (antes salía deshabilitado).
- **Calidad:** test SQL del RPC ampliado (alta multifecha, 7 días por línea, dedup por fecha, edición con división) y E2E (dos fechas → dos entradas separadas).

### Horas · Alcance por posición para TODOS los campos, incluido el admin (2026-07-02) — ⚠️ preparado en local, NO aplicado a prod
Los cuatro campos del registro (**Área, Etapa, Departamento, Descripción**) se filtraban por el alcance del usuario **solo en la UI**, y el **admin quedaba exento** (veía/registraba cualquier valor). El usuario pidió que el admin **también** se limite a su alcance en los cuatro, y que se valide en el motor (no solo UI).
- **UI (`registrar/page.tsx`):** se quitó el bypass del admin en los 4 campos. Ahora todos —incluido el admin— solo ven su alcance: áreas **asignadas** (`user_areas`), y etapas/departamentos/descripciones de **su posición**. Sin asignaciones → lista vacía ("contacta al admin").
- **Motor (`guardar_registro`, migración `0024_horas_registro_campos_por_posicion`):** valida por línea, contra el **dueño** del registro y para **todos los roles**: descripción ∈ posición; en proyecto cliente área ∈ `user_areas` (antes solo operativo) y etapa ∈ posición; en proyecto "Departamento" el departamento ∈ posición. La validación de etapa que vivía en `actions.ts` (y eximía al admin) se **eliminó**: todo el alcance vive ahora en el motor.
- **Bootstrap de áreas (seed en 0024):** los **admin fundadores** existentes reciben **todas** las áreas al aplicar la migración (para no quedar bloqueados por la restricción de área). Los usuarios que el admin cree **después** reciben sus áreas asignadas **por él** desde Usuarios (flujo normal, ya existente). Decisión del usuario: "por defecto a Marcos todas; a partir de ahí, todo lo asigna él".
- **Estado:** ✅ **aplicada a prod** el 2026-07-03 (migración 0024, versión `20260703154320`), con sus dos tests SQL en verde. La validación de **descripción por posición** de esta migración fue **sustituida** poco después por 0025 (descripción por departamento / libre — ver entrada siguiente); las validaciones de área/etapa/departamento siguen vigentes.
- **Datos de prod (2026-07-02, a pedido del usuario, para la demo):** se **vació** el registro de horas — `time_logs`/`time_log_lines`/`time_log_audit`/`horas_alertas` = 0 — y se le asignaron **todas las áreas a Marcos** (7: Automatizaciones, Contenido, CRM, Diseño, Estrategia, Paid Media, SEO). Así Marcos ya no queda bloqueado por la restricción de área, y no quedan registros de prueba con descripciones de texto libre.
- **Calidad:** test SQL `horas_rpc_campos_por_posicion.sql` (admin rechazado por descripción/departamento/área fuera de alcance + caso válido; operativo rechazado por etapa fuera de posición). `horas_rpc_guardar.sql` ya usa descripciones del catálogo.

### Horas · Descripciones por departamento + descripción libre en proyectos normales (2026-07-03) — ✅ aplicado a prod
Cambio de modelo de la **Descripción** al registrar (brainstorming → spec `specs/2026-07-03-descripciones-por-departamento-design.md` → plan `plans/2026-07-03-descripciones-por-departamento.md`):
- **Proyecto normal/cliente:** la descripción es **texto libre** (obligatoria, no vacía). Ya no hay desplegable por posición.
- **Proyecto "Departamento":** la descripción es un **desplegable dinámico** con las descripciones **del departamento elegido**; al cambiar el departamento, cambian las opciones.
- **Modelo:** nueva tabla `departamento_descripciones` (calcada de `departamento_etapas`, migración **0025**). Las descripciones de cada departamento se **escriben como nombres** (crean/enlazan `descripciones`). Se **eliminó `position_descripciones`** (migración **0026**), ya sin uso.
- **Motor (`guardar_registro`, 0025):** en "Departamento" la descripción debe pertenecer a `departamento_descripciones` del departamento de la línea; en cliente solo se exige no-vacía. Se retiró la validación por posición. Área/etapa/departamento sin cambios.
- **Catálogos:** la sección **Departamentos es ahora un acordeón** (como Posiciones); cada departamento agrupa **Etapas** y **Descripciones** (chips "escribe y Enter"). Se quitó la tarjeta Descripciones de Posiciones y la **sección global de Descripciones** (las descripciones viven **solo dentro de cada departamento**).
- **Estado prod:** migraciones 0025 y 0026 **aplicadas** (última `0026`). Test SQL nuevo `horas_rpc_descripcion_departamento` en verde; `guardar`/`campos` desacoplados de `position_descripciones` (hacen SKIP mientras no haya operativo con áreas). **Pendiente del usuario:** cargar las descripciones de cada departamento en Catálogos (la tabla arranca vacía) para que el desplegable de "Departamento" tenga opciones.

### Próximo
- §17.6 (manager ve solo su equipo/área), descarga de movimientos de banco de horas, y la activación del webhook de Slack (lado del usuario). ⏳ Por planificar.

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

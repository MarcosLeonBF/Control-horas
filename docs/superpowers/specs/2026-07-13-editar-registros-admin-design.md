# Diseño — El admin corrige registros ajenos (editar + anular)

**Fecha:** 2026-07-13
**Estado:** aprobado, pendiente de plan de implementación

## Problema

El admin necesita poder **editar registros de horas para corregir errores** (horas
mal cargadas, fecha equivocada, proyecto/área/etapa/descripción incorrectos), y
anular registros erróneos. Hoy solo puede corregir **los suyos** desde
`/mis-registros`; la vista `/equipo → "Registros del equipo"` es de **solo lectura**.

## Hallazgo clave: el backend ya lo soporta

No hace falta migración ni cambios de RPC. Lo verificado:

- `guardar_registro(p_anchor_log_id, p_lines)` (migración 0019) ya edita: cuando llega
  un ancla, reutiliza el log, reemplaza sus líneas, marca `status='editado'`, **conserva
  al dueño original** (`v_owner := v_anchor.user_id`) y escribe auditoría `editar`. El
  admin **salta** el chequeo "registro de otro usuario" y la ventana de 7 días.
- `anular_registro_diario(p_log_id)` (migración 0017) ya anula cualquier registro para el
  admin y **escribe auditoría `anular`** (actor = admin, subject = dueño).
- La RLS de `time_logs` / `time_log_lines` deja a admin/manager **leer** cualquier registro
  (necesario para precargar el formulario de edición).

Por lo tanto **todo el trabajo es de frontend**: exponer las acciones y ajustar de qué
posición sale el catálogo al editar un registro ajeno.

## Decisiones de alcance (acordadas)

1. **Dónde**: en `/equipo → "Registros del equipo"`, agregando acciones + un buscador/filtros.
2. **Catálogo al editar ajeno**: el de la **posición del dueño** del registro (lo que esa
   persona podría haber elegido), no el del admin.
3. **Acciones**: **Editar y Anular** de registros ajenos (solo admin).
4. **Managers**: sin cambios — no pueden editar/anular ajenos (el backend ya los bloquea).

## Cambios

### 1. `app/(horas)/registrar/page.tsx` — modo edición ajena

El `?edit=<logId>` ya precarga el log, pero siempre con el catálogo de la posición **del
admin**. Ajustes:

- Al traer el log a editar, incluir `user_id` y el `full_name` del dueño
  (`profiles!time_logs_user_id_fkey(full_name)`).
- **Autorización de precarga**: precargar `initial` solo si `log.user_id === user.id` **o**
  `me.role === 'admin'`. Si no, no precargar (el manager que abra un `?edit=` ajeno por URL
  ve el formulario en blanco; el RPC igual rechazaría el guardado). Se mantiene el
  chequeo actual `status !== 'anulado'`.
- **Catálogo = posición del dueño**: usar `ownerId = log.user_id` para
  `getMyPositionAreas(ownerId)`, `getMyPositionEtapaIds(ownerId)`,
  `getMyPositionDepartamentoIds(ownerId)`. Editando lo propio, `ownerId === user.id` → el
  comportamiento actual queda idéntico.
- `canBackdate` sigue derivando del rol del **editor** (admin ⇒ `true`).
- **Encabezado**: `Editar registro de {ownerName}` cuando el dueño ≠ editor; `Editar
  registro` cuando es propio; `Registrar horas` en alta.
- **Retorno tras guardar**: nuevo prop `returnTo` en `RegistroForm` (hoy redirige fijo a
  `/mis-registros`). `registrar/page.tsx` pasa `/equipo` cuando se edita un registro ajeno y
  `/mis-registros` en el resto de los casos.

### 2. `components/horas/RegistroForm.tsx`

- Nuevo prop `returnTo: string` (default `'/mis-registros'`). En el `router.push` de éxito
  usar `returnTo` en lugar de la ruta fija.

### 3. `components/horas/EquipoRegistros.tsx` — acciones + buscador/filtros

- Nuevo prop `isAdmin: boolean`.
- **Acciones (solo admin, registro no anulado)**: dentro del **panel desplegado** de cada
  registro (para no anidar un `<button>`/`<a>` dentro del botón-toggle de la fila), una barra
  con **Editar** (link a `/registrar?edit=<log.id>`) y **Anular** (botón con `confirm()`,
  mismo patrón que `MisRegistros`; llama a la server action y hace `router.refresh()`).
- **Toolbar de filtros** (client-side sobre los ≤200 logs ya cargados; mismo patrón que
  `BancosHorasClient`):
  - Buscar por **usuario o proyecto** (texto, sobre `l.user` y `l.lines[].project`).
  - Filtro por **estado**: todos / guardado / editado / anulado.
  - Filtro por **rango de fechas** (desde–hasta, sobre `entry_date`).
  - Estado vacío cuando ninguna fila coincide.
- El componente pasa a ser el contenedor con estado de filtros (ya es client component).

### 4. `app/(horas)/equipo/` — wiring

- `equipo/page.tsx`: pasar `isAdmin={viewer.role === 'admin'}` a `EquipoRegistros`.
- Nuevo `app/(horas)/equipo/actions.ts` → `anularRegistroEquipo(id)`: llama al RPC
  `anular_registro_diario` y hace `revalidatePath('/equipo')`.

## Flujo

1. Admin entra a `/equipo`, filtra/busca el registro a corregir y lo despliega.
2. **Editar** → `/registrar?edit=<id>` precargado con las líneas y el catálogo de la posición
   del dueño; encabezado "Editar registro de {nombre}". Guarda → RPC (audita `editar`,
   `status='editado'`) → vuelve a `/equipo`.
3. **Anular** → `confirm()` → RPC (audita `anular`, `status='anulado'`, devuelve horas al
   banco) → `revalidatePath('/equipo')`.

## Auditoría

Sin cambios: `guardar_registro` y `anular_registro_diario` ya escriben `time_log_audit`
con actor (admin) y subject (dueño). Visible en `/admin/auditoria`.

## Fuera de alcance

- Migraciones / cambios de RPC (no hacen falta).
- Que los managers editen/anulen ajenos.
- Edición masiva o por lote.

## Riesgos / bordes

- **Drift de posición**: si la configuración de la posición del dueño cambió desde que
  registró, algún valor precargado (área/etapa/departamento) podría no aparecer seleccionado
  en su `<select>`. El id original se conserva en el estado del formulario hasta que el admin
  lo toque, así que un guardado sin cambios no lo pierde. Borde poco frecuente; se deja
  anotado, sin manejo especial.
- **Registro dividido en varios días**: al editar, `guardar_registro` puede repartir líneas
  con distintas fechas en varios logs (comportamiento ya existente); el retorno a `/equipo`
  refleja el resultado tras `revalidate`.

## Testing (e2e)

- Admin edita el registro de un operativo sembrado desde `/equipo` (cambia horas) → se
  refleja en la lista; el estado pasa a `editado`.
- Admin anula un registro ajeno desde `/equipo` → pasa a `anulado`.
- El buscador filtra por usuario/proyecto y el filtro de estado/fechas acota la lista.
- Proyecto Playwright `chromium-horas-admin`.

# Diseño — Descripciones por departamento + descripción libre en proyectos normales

**Fecha:** 2026-07-03
**Estado:** Aprobado (pendiente de plan de implementación)

## 1. Motivación

Al registrar horas, hoy la **Descripción** es un desplegable filtrado por la **posición**
del usuario (`position_descripciones`, introducido en la migración 0024). El cliente pidió
un modelo distinto y más natural:

- En proyectos **normales/cliente**, la descripción es **texto libre** (cada quien escribe
  lo que hizo).
- En el proyecto interno **"Departamento"**, la descripción es un **desplegable** cuyas
  opciones dependen del **departamento seleccionado** (cada departamento tiene sus
  descripciones típicas).

Esto sustituye por completo el modelo "descripción por posición".

**No-objetivo:** NO hay proyectos de escritura libre. El campo de proyecto queda igual
(lista del Excel + "Departamento"). El cambio es exclusivamente sobre la Descripción.

## 2. Comportamiento de la Descripción al registrar

| Proyecto | Control | Reglas |
|---|---|---|
| **Departamento** | Desplegable dinámico | Opciones = descripciones del **departamento elegido**. Obligatorio elegir una. Al cambiar el departamento, cambian las opciones (igual que hoy con la etapa derivada). |
| **Cualquier otro** (cliente/normal) | Input de texto libre | **Obligatorio** (no vacío). Sin catálogo, sin validación de pertenencia. |

Transiciones en el formulario:
- Al pasar una línea a "Departamento": la descripción se limpia si no pertenece al
  departamento; se comporta como desplegable.
- Al salir de "Departamento": la descripción vuelve a input de texto libre (se puede
  conservar el texto actual o limpiarse; se conserva por simplicidad).

## 3. Modelo de datos

**Nueva tabla `departamento_descripciones`** (calcada de `departamento_etapas`):
```
departamento_descripciones(
  id uuid pk,
  departamento_id uuid not null references departamentos(id) on delete cascade,
  descripcion_id  uuid not null references descripciones(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (departamento_id, descripcion_id)
)
```
- RLS: `select` a autenticados; `all` solo admin (`is_admin()`), como el resto de catálogos.
- Índices por `departamento_id` y por `descripcion_id`.

**Se conserva** la tabla global `descripciones` como almacén: las descripciones de un
departamento se **escriben como nombres** y crean/enlazan entradas de `descripciones`
(mismo mecanismo que `setDepartamentoEtapasNombres`).

**Se elimina la tabla `position_descripciones`** (y su índice/políticas). La descripción
ya no depende de la posición. Es limpio revertir esta parte porque se introdujo en 0024.

## 4. Motor — nueva migración `0025_horas_descripcion_por_departamento`

`create or replace function public.guardar_registro(...)` idéntica a 0024 salvo la
validación de descripción, dentro del bucle por línea:

- **Se quita** el bloque "descripción ∈ `position_descripciones` del dueño".
- **Se agrega**, según el proyecto:
  - `project = 'Departamento'` → la descripción debe existir en
    `departamento_descripciones` para el departamento de la línea (match por nombre:
    `departamentos.name = department` y `descripciones.name = description`). Si no →
    `raise exception 'descripción no permitida para el departamento'`.
  - En otro caso (cliente) → solo se exige **no vacía** (ya validado antes en el bucle:
    `line sin descripción`). Sin comprobación de catálogo.
- **Sin cambios** en las validaciones de área / etapa / departamento de 0024.

Nota de despliegue: producción tiene hoy 0024 (descripción por posición). 0025 la
sustituye. La tabla `position_descripciones` se elimina en 0025 (o en su propia sección
DDL dentro de la misma migración), tras dejar de usarla el motor.

## 5. Catálogos (UI) — se aplicará `/frontend-design` en la implementación

- **Sección "Departamentos" → acordeón** (mismo lenguaje visual que "Posiciones"): cada
  departamento se expande con un chevron y muestra dos paneles agrupados:
  - **Etapas** (ya existe; se mueve dentro del acordeón).
  - **Descripciones** (nuevo): lista de chips con "escribe y Enter", igual que las etapas
    de departamento. Guarda vía nueva acción `setDepartamentoDescripcionesNombres`.
- **Sección "Posiciones"**: se **quita la tarjeta "Descripciones"** (ya no aplica). Quedan
  Áreas / Etapas / Departamentos. Se elimina `setPosicionDescripciones` y el estado
  asociado.
- **Se elimina la sección global "Descripciones"** del panel. Las descripciones se
  gestionan **solo** dentro de cada departamento (ese pasa a ser su único objetivo). La
  tabla `descripciones` sigue existiendo como almacén, pero sin card global de alta/edición
  suelta; el alta ocurre al teclear nombres en el departamento.

## 6. Registro (page + form)

- `getCatalogos` (o el read-model equivalente) devuelve, por departamento, sus
  descripciones (`descripcionIds` + nombres) además de sus etapas.
- `registrar/page.tsx`: se elimina `getMyPositionDescripcionIds` / `allowedDescripciones`
  (por posición). Se pasan al formulario las descripciones **por departamento**.
- `RegistroForm`:
  - Línea con proyecto "Departamento": el control de descripción es un `<select>` con las
    descripciones del departamento elegido de esa línea; si el departamento no tiene
    descripciones → estado vacío ("— Sin descripciones (contacta al admin) —").
  - Línea con cualquier otro proyecto: el control de descripción es un `<input>` de texto
    libre (obligatorio).
  - Se elimina el prop `descripciones` (global por posición) y su fallback `__cur_`.

## 7. Pruebas

- **Motor (SQL):**
  - Departamento con descripción del departamento → aceptado.
  - Departamento con descripción de otro departamento (o inexistente) → rechazado.
  - Proyecto cliente con texto libre cualquiera → aceptado.
  - Cualquier proyecto con descripción vacía → rechazado.
- **Ajuste de tests 0024:** `horas_rpc_campos_por_posicion.sql` y `horas_rpc_guardar.sql`
  dejan de asumir descripción por posición; para Departamento usan una descripción real del
  departamento; para cliente usan texto libre.
- **E2E (si aplica):** registrar en Departamento (elige descripción del depto) y en cliente
  (escribe descripción libre).

## 8. Resumen de archivos afectados

- **Migración nueva:** `0025_horas_descripcion_por_departamento.sql` (tabla
  `departamento_descripciones`, drop `position_descripciones`, `guardar_registro`
  actualizado).
- **`lib/horas/queries.ts`:** read-model de descripciones por departamento; quitar
  `getMyPositionDescripcionIds`.
- **`app/(horas)/registrar/page.tsx`** y **`components/horas/RegistroForm.tsx`:** control de
  descripción condicional (select por depto / input libre).
- **`app/(horas)/admin/catalogos/actions.ts`:** `setDepartamentoDescripcionesNombres`
  (nueva; crea/enlaza `descripciones` por nombre, como `setDepartamentoEtapasNombres`).
  Quitar `setPosicionDescripciones`. Quitar las acciones globales de descripción
  (`crearDescripcion`/`renombrarDescripcion`/`toggleDescripcion`/`eliminarDescripcion`) al
  desaparecer la sección global; la creación de descripciones ocurre al teclear nombres en
  el departamento. Renombrar/limpiar globalmente no es un requisito (si hace falta, se
  desenlaza y se vuelve a teclear); las filas de `descripciones` sin enlazar quedan
  inertes, igual que las etapas sin uso.
- **`components/horas/CatalogosPanel.tsx`:** acordeón de departamentos con Etapas +
  Descripciones; quitar card Descripciones de Posiciones; quitar sección global
  Descripciones.
- **Tests SQL** correspondientes.

## 9. Riesgos / notas

- Producción quedará con 0025 tras aplicarlo; hoy tiene 0024. Los registros están en blanco,
  así que no hay descripciones de texto libre viejas que migrar.
- El `descripciones.name` es único (constraint de 0022): dos departamentos pueden **compartir**
  la misma descripción por nombre (se enlaza la misma fila). Es el comportamiento deseado
  (como las etapas compartidas).

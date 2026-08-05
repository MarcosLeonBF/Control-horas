# Auditoría: filtros, agrupación y detalle del cambio — diseño

**Fecha:** 2026-08-05
**Pieza:** `/admin/auditoria` (tabla `time_log_audit` + RPCs `guardar_registro` y
`anular_registro_diario`)

## Contexto y pedido

El pedido fue "mejorar la auditoría: filtros, poder agrupar para ver
específicamente ciertos datos", con dos concretos —**filtrar por fecha** y
**agrupar por usuario**— y libertad para proponer el resto.

Estado actual (`app/(horas)/admin/auditoria/page.tsx`, 75 líneas, todo servidor):

- Una tabla plana de los últimos 200 asientos, sin un solo control.
- Columnas: Cuándo · Acción · Registro (fecha) · De · Por · Total.
- La tabla `time_log_audit` (migración `0017`) guarda **que** algo pasó, no
  **qué** cambió: `action`, `actor_name`, `subject_name`, `entry_date`,
  `total_hours`, `at`. Tras una edición no hay forma de saber qué línea se tocó.

Volumen real medido en producción el 2026-08-05:

| Métrica | Valor |
|---|---|
| Asientos totales | 661 |
| crear / editar / anular | 514 / 141 / 6 |
| Rango | 2026-07-06 → 2026-08-04 |
| Actores distintos | 18 |

Es decir: **~660 asientos al mes, y el `limit(200)` actual ya oculta dos tercios
del último mes**. Cualquier filtro que se aplique en cliente sobre esas 200 filas
mentiría. El rango de fechas tiene que acotarse en el servidor.

## Decisiones tomadas

| Pregunta | Decisión |
|---|---|
| ¿Qué fecha se filtra? | Las dos, con **`at` (cuándo se hizo)** por defecto y un selector para conmutar a `entry_date` (día de trabajo afectado) |
| ¿Agrupar por qué usuario? | Ambas dimensiones seleccionables: **quien edita** (actor) y **usuario afectado** (subject) |
| ¿Se guarda qué cambió? | Sí: **snapshot antes/después** de las líneas, con diff en pantalla |
| Alcance | Solo registros de horas. Usuarios, ampliaciones y proyectos quedan fuera |
| Forma de la pantalla | Lista cronológica con **cabeceras de grupo plegables** (no ranking, no panel lateral) |

Sobre la forma: se descartó clonar el ranking de `/reportes` porque agrupar
destruiría la cronología, que es lo que se viene a leer en una auditoría; y se
descartó el panel de agregados como filtro porque parte la pantalla en dos zonas
que hay que leer a la vez. Las cabeceras plegables responden "¿quién está
tocando de más?" (la cabecera) y "¿en qué orden pasó?" (las filas de dentro) sin
cambiar de vista.

## 1. Datos — migración `0041`

### Esquema

```sql
alter table public.time_log_audit
  add column lines_before jsonb,
  add column lines_after  jsonb;

create index time_log_audit_entry_date_idx on public.time_log_audit(entry_date);
create index time_log_audit_actor_idx      on public.time_log_audit(actor_id, at desc);
```

Forma de cada snapshot — un array de objetos con los **nombres ya resueltos**,
no ids:

```json
[{ "project": "…", "area": "…", "department": "…", "etapa": "…",
   "hours": 3.5, "description": "…" }]
```

Los nombres, y no las claves foráneas, por la misma razón por la que la tabla ya
guarda `actor_name`: el asiento debe seguir leyéndose igual dentro de un año,
aunque se renombre un área o se borre una etapa. Coste asumido: si un área se
renombra, los asientos viejos muestran el nombre viejo — que es justamente lo
correcto en una auditoría.

Orden dentro del array: por proyecto y después por descripción, para que dos
snapshots del mismo contenido se comparen sin ruido de ordenación.

### Escritura del snapshot

Se rellena dentro de los RPC, en la misma transacción que el cambio (como ya se
hace con el asiento).

**`guardar_registro(p_anchor_log_id, p_lines)`** — definición viva en `0039`:

- La función borra las líneas del ancla (`delete from time_log_lines where
  log_id = v_anchor.id`, línea 143) **antes** de reinsertar. El snapshot del
  *antes* se toma inmediatamente antes de ese `delete`, con el join a `areas` y
  `etapas` para resolver nombres.
- El *después* se toma tras el `update ... set total_hours` de cada log.
- En un guardado **multi-fecha**, solo el log ancla es `editar` y lleva
  `lines_before`; las demás fechas son `crear` y van con `lines_before = null`.

**`anular_registro_diario(p_log_id)`** — definición viva en `0017`:

- `lines_before` = las líneas vivas del log antes de marcarlo anulado.
- `lines_after` = `null`.

Resumen por acción:

| Acción | `lines_before` | `lines_after` |
|---|---|---|
| `crear` | `null` | líneas nuevas |
| `editar` | líneas previas | líneas nuevas |
| `anular` | líneas vivas | `null` |

### Datos históricos

Los 661 asientos ya grabados no tienen snapshot y **no se puede reconstruir**:
las líneas viejas se borraron al editar. Al desplegar uno de esos asientos la
pantalla lo dice explícitamente ("Sin detalle: anterior a la trazabilidad de
cambios") en vez de pintar un diff vacío que se leería como "no cambió nada".

Regla para distinguirlos: un asiento es "sin detalle" cuando `lines_before` y
`lines_after` son ambos `null`. Un `crear` nuevo siempre tiene `lines_after`, y
un `anular` nuevo siempre tiene `lines_before`, así que la regla no produce
falsos positivos.

## 2. Servidor — `app/(horas)/admin/auditoria/page.tsx`

Sigue siendo un Server Component que solo consulta y delega el render. Cambios:

- **Rango por `searchParams`** (`from`, `to`, `base`), con el mismo formulario
  Desde/Hasta que `app/(horas)/reportes/page.tsx:30-42`, para que el control se
  comporte igual en las dos pantallas.
- **Base de fecha** (`base`): `at` (por defecto) o `entry_date`. Determina sobre
  qué columna se aplica el rango. Con `base=at` el filtro es sobre timestamp, así
  que el `to` se aplica inclusive hasta el final del día (`to` + 1 día,
  exclusivo); con `base=entry_date` es comparación de fechas directa.
- **Rango por defecto:** últimos 30 días (`hoy − 30` → hoy).
- **Muere el `limit(200)`.** Dentro del rango se traen todos los asientos, con
  tope duro de **5000** y un aviso en pantalla si se alcanza ("Mostrando los
  5000 movimientos más recientes del rango; acota las fechas"). A ~660/mes son
  ~7 meses de holgura en una sola carga.
- Se seleccionan además `lines_before` y `lines_after`.
- **Acceso: solo admin**, como hoy.

> Inconsistencia preexistente, anotada y **no** tocada aquí: la política RLS
> `time_log_audit_select` permite leer a `manager` y `admin`, pero la página
> redirige a todo el que no sea admin. Abrir la pantalla a managers (acotada por
> área, según §17.6) es trabajo aparte.

## 3. Cliente — `components/horas/AuditoriaView.tsx`

Recibe los asientos del rango y hace en cliente todo lo demás: filtrar, agrupar,
plegar y desplegar. Es el mismo reparto que `ReportesView`, y a ~660 filas por
mes no hay motivo para ir al servidor en cada clic.

La lógica pura (tipos, agrupación, diff) vive en `lib/horas/auditoria-types.ts`,
sin imports de servidor, para poder testearla sin montar la página — igual que
`lib/horas/reportes-types.ts`.

### Fila de resumen

Cuatro `Stat` con el mismo tratamiento visual que `/reportes`:

Movimientos · Ediciones · Anulaciones · Personas que editaron.

Se calculan sobre lo filtrado, no sobre lo traído: mueven con los filtros.

### Filtros (cliente, sobre el rango ya acotado)

- **Acción:** tres chips alternables (crear / editar / anular). Ninguno activo =
  todas. Son tres valores fijos; un desplegable sería más clics para lo mismo.
- **Quien edita** (actor): desplegable, opciones derivadas de los datos del
  rango.
- **Usuario afectado** (subject): ídem.
- **Limpiar**, visible solo si hay algún filtro puesto.

### Agrupar por

Píldoras al estilo `/reportes`:

`Ninguno · Quien edita · Usuario afectado · Acción · Día · Mes`

- `Ninguno` (por defecto) = lista plana cronológica descendente, como hoy.
- El resto inserta **cabeceras de grupo plegables**. Cada cabecera muestra:
  etiqueta del grupo, nº de movimientos, desglose por acción y total de horas
  afectadas.
- Dentro de cada grupo el orden sigue siendo cronológico descendente.
- Los grupos van **colapsados** por defecto (con 18 actores, abrirlos todos es
  ruido), con un botón "Desplegar todo" / "Plegar todo".
- Orden de los grupos: por nº de movimientos descendente; en `Día` y `Mes`,
  cronológico descendente — el mismo criterio que `aggregate()` en
  `reportes-types.ts`.
- La identidad del grupo es el **id** en las dimensiones de persona
  (`actor_id` / el nombre del sujeto cuando no hay id), no el nombre, para que
  dos homónimos no se fundan.

> Nota: `time_log_audit` guarda `subject_name` pero no `subject_id`. Para
> "Usuario afectado" la clave de agrupación es el nombre, con el riesgo conocido
> de fundir homónimos. Añadir `subject_id` es una mejora barata y se deja
> anotada como siguiente paso, no se hace aquí.

### Detalle del cambio (diff)

Cada fila se despliega **en línea**, no en un modal: en una lista cronológica
larga el modal te saca del sitio y obliga a reencontrar dónde estabas.

Al desplegar:

- Cabecera del despliegue con el cambio de total: `8,00 h → 6,50 h`.
- Las líneas, comparando `lines_before` con `lines_after` por la clave
  proyecto + área + departamento + etapa + descripción:
  - `+` añadida (verde)
  - `−` eliminada (rojo)
  - `~` cambiada — misma clave, distintas horas (ámbar), con `3,00 h → 4,50 h`
  - sin marca las que no cambiaron (atenuadas)

  Como la descripción forma parte de la clave, reescribir el motivo de una línea
  aparece como par eliminada + añadida, no como `~`. Es lo correcto: en una
  auditoría un motivo reescrito es un cambio que debe verse entero, no un
  matiz.
- En `crear` solo hay "después"; en `anular` solo "antes".
- Asiento sin snapshot → "Sin detalle: anterior a la trazabilidad de cambios".

La marca no es solo color: el signo `+ − ~` distingue por forma, para no depender
de distinguir verde de rojo.

### Descarga

Excel y CSV de lo filtrado, reutilizando `downloadXlsx` / `downloadCsv` de
`lib/export`, con las columnas de la tabla más una columna de resumen del cambio.
Nombre: `auditoria_{from}_{to}`.

## 4. Verificación

**SQL** (`supabase/tests/`, junto a los tests de RPC existentes):

- Editar un registro por RPC → el asiento `editar` trae `lines_before` con el
  contenido viejo y `lines_after` con el nuevo.
- Crear → `lines_before is null`, `lines_after` con las líneas.
- Anular → `lines_after is null`, `lines_before` con las líneas.
- Guardado multi-fecha → solo el ancla lleva `lines_before`.

**De función pura** — el repo usa Playwright también como runner de tests
unitarios: el proyecto `node-horas` de `playwright.config.ts` ejecuta specs sin
navegador (así se prueban `aggregate` y `ordenarFilas` en
`e2e/horas-reportes-mes.spec.ts`). La lógica de `auditoria-types.ts` se cubre
ahí, en un spec nuevo: agrupación (incluidos los homónimos) y el diff en todos
sus casos — línea añadida, eliminada, con horas cambiadas, sin cambios, motivo
reescrito y snapshot ausente.

> El spec nuevo debe darse de alta en **dos** sitios de `playwright.config.ts`:
> el `testMatch` de `node-horas` y el `testIgnore` de `chromium-horas` — este
> último captura `**/horas-*.spec.ts`, así que sin la exclusión el test correría
> además en navegador. Es el mismo doble alta que ya tiene
> `horas-reportes-mes.spec.ts`.

**E2E** (`e2e/horas-auditoria.spec.ts`, ampliando el test actual): filtrar por
acción, agrupar por actor y comprobar las cabeceras, desplegar un asiento y ver
su diff, y desplegar un asiento viejo para ver el aviso de "sin detalle".

**Gate:** `tsc` + `build`. El `npm run lint` sigue roto repo-wide desde Next 16.

## Fuera de alcance

- Auditar otras entidades (alta/edición de usuarios, ampliaciones de banco,
  archivado de proyectos).
- Abrir la pantalla a managers acotada por área.
- Añadir `subject_id` a `time_log_audit`.
- Retención o archivado de asientos viejos.

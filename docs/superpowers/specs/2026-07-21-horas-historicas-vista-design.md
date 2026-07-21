# Horas históricas (D): vista /historico con matriz mes × dimensión

**Fecha:** 2026-07-21
**Estado:** aprobado
**Depende de:** A (tabla cargada), B (banco) y C (reportes), las tres en producción.

## Objetivo

Una pantalla dedicada al histórico mensual que muestre **la evolución de los 20
meses de un vistazo** (nov-2024 → jun-2026). Es lo que `/reportes` no puede dar:
esa pantalla trabaja sobre un **rango único**, así que para comparar meses habría
que ir cambiándolo mes a mes.

Se replanteó si D seguía teniendo sentido una vez hecho C. La conclusión: sí,
pero **no** como listado de solo lectura (eso ya lo cubre `/reportes` con el
interruptor), sino como **matriz de evolución**.

## Decisiones cerradas

- **Matriz mes × dimensión**: columnas = los meses con actividad; filas = los
  valores de una dimensión elegible.
- **Conmutador de dimensión** con las mismas pastillas que `/reportes`
  (Proyecto, Usuario, Área, Departamento, Etapa, Posición). Se excluye "Fecha":
  aquí el tiempo son las columnas. Reutiliza `GROUP_LABELS` y la lógica de
  identidad de grupo ya existente.
- **Solo histórico**: no mezcla nada de la plataforma. La naturaleza mensual del
  dato queda explícita, que es justo lo que `/reportes` no transmite bien.
- **Acceso**: manager/admin, mismo guard que `/reportes`. La RLS corregida en
  `0038` acota al manager a su equipo automáticamente.

## Cambios

- **`lib/horas/historico.ts`** (nuevo): `getHistoricoLines(from?, to?)` consulta
  `horas_historicas`, resuelve nombre y posición desde el perfil, normaliza la
  etapa contra el catálogo (case-insensitive) y devuelve `ReporteLine[]` fechadas
  al último día de su mes. Sin rango, devuelve todo.
  Esta lógica **se extrae de `reportes.ts`**, que pasa a llamarla: así vive en un
  solo sitio y las dos pantallas no pueden desincronizarse.
- **`lib/horas/reportes-types.ts`**: se expone `groupOf(line, groupBy)` (clave +
  etiqueta), del que `groupKeyOf` pasa a ser un envoltorio. Evita duplicar en la
  matriz la lógica de etiquetas por dimensión.
- **`app/(horas)/historico/page.tsx`** (nuevo): guard + carga.
- **`components/horas/HistoricoMatriz.tsx`** (nuevo): pastillas de dimensión,
  matriz y descargas.
- **`components/AppShell.tsx`**: entrada "Histórico" en el menú, visible para
  managers, junto a Reportes.

## La matriz

- Primera columna **fija** (`sticky left-0`) y scroll horizontal, calcando el
  patrón ya usado en `BancoDetalleView` para la matriz posición × mes.
- Cabeceras de mes con `mesCorto` ("Nov 2024").
- **Total por fila** (columna final) y **total por mes** (fila final).
- Filas ordenadas por total descendente.
- Celda sin actividad: "—" tenue, para que se lea de un vistazo el patrón de
  actividad de cada persona o proyecto.
- **Descarga** Excel y CSV de la matriz tal como se ve, con `downloadXlsx` /
  `downloadCsv`.

## Verificación

- `npx tsc --noEmit` (gate del repo; lint roto repo-wide desde Next 16).
- Cuadrar el total general de la matriz contra el dato conocido: **12.087,90 h**
  en 1.967 filas, 17 personas, 20 meses.
- Testing funcional a cargo del usuario.

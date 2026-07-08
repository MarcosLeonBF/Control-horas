# Horas Provisionales — Diseño

**Fecha:** 2026-07-08
**Estado:** aprobado (pendiente de plan de implementación)
**Depende de:** la vista mensual del banco de horas ([2026-07-08-banco-horas-mensual-design.md](2026-07-08-banco-horas-mensual-design.md), ya implementada).

## 1. Problema

El banco de horas mensual por posición tiene **delay**: al empezar cada mes, las
filas del mes nuevo todavía no están cargadas en la hoja `BancoHoras` del Excel,
así que los meses recientes (desde el último registro global) se ven vacíos hasta
que alguien los carga. Dos consecuencias hoy:

- **Proyectos nuevos invisibles en el banco.** Un proyecto recién ingresado tiene
  consumo registrado pero no fila en `BancoHoras`, y `getBancosHoras` recorre solo
  los proyectos de `BancoHoras` → el proyecto ni aparece y su consumo queda
  huérfano. Medido el 2026-07-08: 9 proyectos con ~19,5h registradas invisibles.
- **Meses recientes en cero.** Aun para proyectos existentes, los meses posteriores
  al último registro global se ven sin asignación.

Las **horas provisionales** rellenan esos meses vacíos con un estimado (por tipo de
contrato y posición), marcado como provisional, que **cede solo** cuando llega el
dato real.

## 2. Fuentes de datos (todas ya existen en el Excel)

| Hoja | Rol | Se lee hoy |
|---|---|---|
| `BancoHoras` | Horas reales (proyecto × mes × posición). Tiene delay. | Sí |
| `Clientes_Proyectos` | **Registro maestro** de proyectos + metadatos. | Parcial |
| `Horas_Provisionales` | Tarifa provisional (tipo de contrato × posición → horas/mes). | **No (nuevo)** |

Las 12 posiciones de `BancoHoras` y `Horas_Provisionales` coinciden exactamente, y la
BD ya quedó alineada (migración 0034 renombró "Growth Strategists" → "Growth
Strategist"). Así, una hora provisional de "FLECHA / Copywriter" entra directo en el
banco "Copywriter" del proyecto.

### 2.1 Columnas nuevas a leer de `Clientes_Proyectos`

`readClientesProyectosSheet` ([lib/graph/client.ts](../../../lib/graph/client.ts))
hoy lee Proyecto, Estado, Manager del proyecto, Fecha Auditoría. Se amplía
`ProyectoEstado` para leer también (todas opcionales, `norm`-insensible a
mayúsculas/acentos):

- **`Tipo de Contrato`** → `tipoContrato: string`
- **`Fecha Inicio Contable`** → `inicioContable: string` (ISO `YYYY-MM-DD`, vía el
  `excelDateToISO` existente; `''` si vacía)
- **`Fecha Fin Contable`** → `finContable: string` (ISO; `''` si vacía)

No se filtra por `Cuenta como Proyecto` (decisión §7).

### 2.2 Lector nuevo de `Horas_Provisionales`

Función nueva `readHorasProvisionalesSheet` (misma mecánica que `readBancoHorasTable`:
`usedRange`, primera columna = tipo de contrato, columnas siguientes = posiciones).
Cacheada con `unstable_cache` + tag `banco-horas` (mismo refresco manual que el resto).

```ts
// Tarifa provisional: tipoContrato → { posición → horas/mes }.
export type HorasProvisionales = Map<string, Map<string, number>>
export const getCachedHorasProvisionales: () => Promise<HorasProvisionales>
```

## 3. La regla

La **ventana** de meses a rellenar es `[mes siguiente al último registro global … mes
actual]`. "Último registro global" = el mes más nuevo con filas reales en `BancoHoras`
(el `max` de los `months` que ya devuelve el lector). Es seguro tomar el máximo global
porque **la carga del Excel es en lote** (todos los proyectos del mes juntos), así que
el piso de la ventana no se mueve por un proyecto suelto. Hoy: `[2026-06, 2026-07]`.

Para cada **(proyecto P, posición Pos, mes M)** se asigna
`horasProvisionales[tipoContrato(P)][Pos]` como **asignado provisional del mes** cuando
se cumple **todo**:

1. **M está en la ventana** (`ultimoGlobal < M ≤ mesActual`).
2. **P no tiene fila real en `BancoHoras` para M** (mes vacío; granularidad
   proyecto-mes, porque cada fila de `BancoHoras` es un proyecto-mes con todas las
   posiciones en columnas).
3. **`Estado ≠ Pausa`.** Activo cuenta; **Garantía cuenta** (se trata como activo).
4. **`inicioContable(P) ≤ M`** (el proyecto ya arrancó ese mes). Si `inicioContable`
   está vacía, no se puede ubicar el arranque → no se asigna provisional (defensivo).
5. **`finContable(P)` vacía o `≥ M`** (sigue vigente ese mes).
6. **Existe fila para `tipoContrato(P)` en `Horas_Provisionales`** y el valor de esa
   posición es `> 0`. Si el tipo de contrato no tiene fila → se **omite y se loguea**
   (`console.warn` con proyecto + tipo de contrato).

Comparaciones de fecha-vs-mes: a nivel mes (`YYYY-MM`). "`finContable ≥ M`" = el mes de
la fecha de fin es `≥` M (el mes que contiene la fecha de fin todavía cuenta).

El **consumo** de un mes provisional sigue siendo real (de `time_log_lines`), así que la
fila muestra *asignado provisional vs consumido real*.

## 4. Recálculo: derivado al leer (sin estado guardado)

Todo se calcula al leer del Excel cacheado; **no se persiste nada** ni hay jobs de
limpieza. El recálculo es una consecuencia de re-evaluar la regla:

- Aparece la fila real del mes M en `BancoHoras` → M deja de estar vacío (criterio 2
  falla) → mandan los datos reales, la provisional desaparece.
- Aparece un `finContable` anterior a M (proyecto finalizado) → criterio 5 falla → cero
  provisionales para ese proyecto desde M.
- Avanza el mes / se carga el lote nuevo → `ultimoGlobal` sube y la ventana se corre.

## 5. La lista del banco se alimenta de `Clientes_Proyectos`

Cambio en `getBancosHoras` ([lib/horas/bancos.ts](../../../lib/horas/bancos.ts)): el
conjunto de proyectos deja de venir de `BancoHoras` y pasa a `Clientes_Proyectos`
(registro maestro). Las filas `(proyecto, posición)` se construyen como la **unión** de:

- posiciones con asignado real (columnas de `BancoHoras`),
- posiciones con asignado **provisional** (regla §3),
- posiciones con consumo (`time_log_lines`, atribuido por la posición del usuario).

Se mantiene el filtro actual: una fila `(proyecto, posición)` se lista solo si tiene
**asignado real, o provisional, o consumo** (`> 0`); si todo es 0, no se lista (evita
inundar con finalizados inactivos). `getBancoHorasDetalle` ya hace esta unión para las
posiciones; se alinea la lista con el mismo criterio y se le suman las provisionales.

Efecto: los 9 proyectos nuevos con consumo dejan de estar huérfanos, y los proyectos
elegibles muestran su banco provisional del mes.

## 6. Semántica de totales

Las horas provisionales **no suman al total confirmado** del proyecto. Se muestran
**aparte y marcadas** como provisionales. El "asignado" y el "total" que hoy ve el
usuario siguen siendo solo lo confirmado (Excel real + ampliaciones), sin inflarse en
silencio con estimados.

> **Futuro (fuera de este spec):** habrá un mecanismo de **arrastre de saldo** entre
> meses; las horas arrastradas *sí* sumarán al total. Se diseña aparte. Provisional y
> arrastre son cosas distintas: provisional rellena asignación de meses sin cargar;
> arrastre mueve saldo entre meses.

## 7. Alcance de proyectos: `Cuenta como Proyecto`

**Decisión:** el banco y las provisionales usan **todos** los proyectos de
`Clientes_Proyectos`, sin filtrar por `Cuenta como Proyecto` (consistente con el
selector de registrar). Consecuencia aceptada: un interno tipo "Sin Proyecto" podría
mostrar banco provisional si está activo y su tipo de contrato tiene tarifa; en la
práctica el filtro "sin asignado ni consumo → no se lista" y los criterios de
elegibilidad acotan casi todo. Si más adelante molesta, se filtra `Cuenta=SI` en un
punto (un `if`).

## 8. UI (identidad visual existente)

- **Meses provisionales marcados como provisionales**: en la vista Mensual del banco
  (lista y detalle), un mes cuyo asignado es provisional lleva un distintivo (badge
  "Provisional" / estilo tenue), para no confundir estimado con confirmado. Se
  construye con los tokens actuales (`--muted-surface`, badges como los de estado).
- **El semáforo** de un mes provisional se calcula igual (`computeHorasStatus` sobre
  provisional-asignado vs consumido), pero el badge de estado va acompañado del marcador
  "provisional".
- **Vista Total**: sin provisionales en las cifras (§6). El conjunto de filas es el
  mismo en Total y Mensual; un proyecto cuyo único asignado es provisional **sí aparece
  en la lista** (para no ocultarlo), con confirmado 0 en Total, y su provisional visible
  al cambiar a Mensual. Así no desaparece al alternar de vista.
- **Garantía**: opcionalmente, distintivo visual para proyectos en ese estado (se
  tratan como activos). Nice-to-have, no bloquea.

## 9. Errores y casos borde

| Caso | Comportamiento |
|---|---|
| Tipo de contrato sin fila en `Horas_Provisionales` | Se omite + `console.warn` (criterio 6). |
| `inicioContable` vacía | No se asigna provisional (no se puede ubicar el arranque). |
| Consumo en un mes provisional que supera el estimado | Estado "excedido" del mes (consistente), marcado provisional. |
| Proyecto con consumo pero sin fila en `BancoHoras` ni provisional elegible | Aparece por el consumo (§5), asignado 0. |
| Excel caído (Graph falla) | Igual que hoy: banco muestra lo que haya; sin provisionales. |
| `Horas_Provisionales` no existe / vacía | Sin provisionales; el resto del banco funciona. |

## 10. Testing

e2e de Playwright contra datos vivos (como el resto de la suite; sin unit framework).
Tolerante a que el Excel cambie (si no hay meses provisionales, el marcador no aparece):

- La lista del banco muestra un proyecto nuevo (con consumo, sin `BancoHoras`) que antes
  no aparecía.
- En la vista Mensual, un mes provisional muestra el marcador y cifras; al "aparecer" el
  mes real (no testeable en vivo sin tocar el Excel) manda lo real — se cubre a nivel
  unidad de la regla si se agrega, o se documenta como verificación manual.
- Los totales confirmados no incluyen provisionales (§6).

## 11. Fuera de alcance

- **Arrastre de saldo entre meses** (fase futura; ver §6).
- Cambios en HUCHA.
- Framework de unit tests.
- Filtro por `Cuenta como Proyecto` (§7).

## 12. Decisiones cerradas (registro)

- Ventana global, carga en lote → `ultimoGlobal` = max mes real.
- Criterios: en ventana + mes vacío + `Estado≠Pausa` + `inicio≤M` + (`fin` vacía o `≥M`)
  + hay tarifa.
- Garantía = se trata como activo.
- Recálculo derivado al leer (sin persistencia).
- Banco se alimenta de `Clientes_Proyectos`.
- Provisionales aparte/marcadas, no suman al total.
- Todos los proyectos (sin filtro `Cuenta`).

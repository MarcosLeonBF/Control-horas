# Reportes: agrupar por Mes

**Fecha:** 2026-07-24
**Estado:** aprobado
**Pedido por:** los managers, para leer la actividad del equipo mes a mes.

## Objetivo

Añadir **Mes** a las dimensiones de "Agrupar por" en `/reportes`. Con el rango
01/06 → 31/08 la tabla debe mostrar una fila por mes —junio, julio y agosto— con
sus horas, su reparto y su porcentaje.

De paso, corregir dos cosas que la vista por tiempo ya arrastra: la etiqueta de la
dimensión `date` y el ordinal de ranking sobre listas cronológicas.

## Decisiones cerradas

- **Meses vacíos: fila a 0h.** Si el rango cubre un mes sin ningún registro, ese
  mes **sale igual**, con 0,00 h y la barra sin relleno. Un mes sin horas es
  información —el manager ve el hueco—, no ausencia de datos. Se aparta a
  propósito del comportamiento del resto de dimensiones, donde un grupo sin horas
  simplemente no existe.
- **Solo Mes rellena huecos, Día no.** Rellenar días vacíos metería cada fin de
  semana y cada festivo como fila: ruido, no información.
- **Sin ninguna línea, no se rellena nada.** Si el rango (ya filtrado) no tiene ni
  una línea, se mantiene el estado vacío que ya existe —*"No hay horas registradas
  con estos filtros en el rango seleccionado."*— en vez de una pared de meses a
  0 h. Un rango de tres años sin datos daría 36 filas huecas que no dicen nada.
- **La fila de 0h no se puede pinchar.** Abrir el modal de desglose sobre un mes
  sin líneas daría un panel vacío. Se renderiza atenuada (`text-muted-foreground`),
  sin `hover` ni cursor, con el carril de la barra visible pero sin relleno.
- **`GROUP_LABELS.date`: "Fecha" → "Día".** Con Mes en la lista, "Fecha" es
  ambiguo: un mes también es una fecha. Cambia **solo la etiqueta**; la clave
  interna sigue siendo `date`, así que no toca datos, ni nombres de descarga
  (`reporte-horas-por-date`), ni URLs.
- **Sin ordinal en las dimensiones de tiempo.** La tabla es un ranking: `#` = puesto,
  orden por horas descendente. Al agrupar por tiempo el orden pasa a ser
  cronológico y el `#` afirma algo falso ("Julio es el nº 1" cuando julio solo es
  el más reciente). En Mes y en Día la columna va vacía, cabecera incluida. **La
  columna no se colapsa**: `ROW_GRID` la comparten la tabla principal y el nivel 1
  del modal, y estrecharla desalinearía el modal.
- **Orden cronológico descendente**, el mes más reciente arriba, igual que Día.
- **Aviso de rango de un solo mes.** Agrupando por Mes con `from` y `to` dentro del
  mismo mes sale una única fila al 100%, que se lee como un fallo. Bajo las
  pastillas aparece entonces: *"Solo hay un mes en el rango. Amplía las fechas para
  comparar mes a mes."* **No se tocan las fechas**: son del manager.
- **Nada de identidad visual nueva.** La pastilla "Mes" es idéntica a sus hermanas
  y se coloca entre Posición y Día (de escala gruesa a fina). Sin paleta, tipografías
  ni componentes nuevos.

## Cambios

- **`lib/horas/format.ts`**: `mesesEnRango(from, to): string[]` — los `'YYYY-MM'`
  que toca un rango ISO, **ambos extremos incluidos** ('2026-06-15' → '2026-08-03'
  da `['2026-06', '2026-07', '2026-08']`). Se apoya en `addMonths`, que ya existe ahí.
- **`lib/horas/reportes-types.ts`**:
  - `GroupBy` gana `'month'`; `GROUP_LABELS.month = 'Mes'`; `GROUP_ORDER` la inserta
    entre `'position'` y `'date'`.
  - `KEY.month`: clave `l.date.slice(0, 7)` (ISO, ordena cronológicamente sola),
    etiqueta `formatMes()` → "Julio 2026". `formatMes` ya existe.
  - `aggregate`: el orden cronológico descendente pasa a aplicarse a `'date'`
    **y** `'month'`.
  - `conMesesVacios(rows, from, to): AggRow[]` — completa los meses del rango que la
    agregación no produjo, a 0 h, y reordena. Con `rows` vacío devuelve vacío, para
    no tapar el estado vacío de la tabla. Vive aquí, junto a `aggregate`, no en el
    componente: es lógica de agregación y así queda testeable aparte.
  - `GROUP_LABELS.date` pasa a `'Día'`.
- **`components/horas/ReportesView.tsx`**:
  - `rows` aplica `conMesesVacios` cuando `groupBy === 'month'`.
  - `RankRow` gana `muted?: boolean` para la fila de mes vacío.
  - La tabla principal pasa `leading` vacío y cabecera `#` vacía cuando la dimensión
    es de tiempo; `onClick` solo si `r.hours > 0`.
  - El aviso de rango de un solo mes, bajo las pastillas.
- **`components/horas/HistoricoMatriz.tsx`**: `DIMENSIONES` filtra también `'month'`.
  Esa matriz ya tiene los meses como columnas; ofrecerlo además como dimensión de
  fila daría una matriz de meses contra meses.
- **`e2e/horas-reportes.spec.ts`**: el test de agrupación busca el botón por
  `name: 'Fecha'` y hay que pasarlo a `'Día'`. La aserción del nombre de descarga
  (`reporte-horas-por-date`) sigue valiendo: la clave no cambia.

## Lo que NO entra

- **El área del histórico sigue en "—".** Decidido el 2026-07-24, fuera de alcance.
- **El rango por defecto de `/reportes` no cambia** (mes en curso → hoy). Quien
  quiera comparar meses amplía las fechas; para eso está el aviso.

## Riesgo conocido: histórico y meses solapados

Agrupar por mes junta en la misma fila los registros de la plataforma y el cierre
del histórico de ese mes, que va fechado a fin de mes (`finDeMes`). Junio 2026 suma
las 350 filas históricas más lo registrado en la plataforma en junio. **Si esas
horas se solapan, junio saldrá inflado.**

No se corrige aquí: el interruptor "Incluir histórico" que ya existe permite verlo
sin el histórico, y determinar si hay duplicidad real es un trabajo aparte sobre los
datos. Queda anotado para no confundirlo con un error de la agrupación.

## Verificación

- `npx tsc --noEmit` y `npm run build` (gate del repo; lint roto repo-wide desde
  Next 16).
- Contrastar por SQL el total de un mes contra la fila que muestre la pantalla, con
  el interruptor de histórico encendido y apagado.
- Un rango con un mes intermedio sin registros debe producir su fila a 0 h.
- Testing funcional a cargo del usuario.

# Registrar el tiempo en minutos — diseño

**Fecha:** 2026-08-05
**Pieza:** `components/horas/RegistroForm.tsx` (campo de tiempo de cada línea)

## Contexto y pedido

Se reportó que hay gente que trabaja ratos de 10 minutos y le cuesta cargarlos:
el campo pide horas, y 10 minutos son 0,1666…h. La cuenta mental es la fricción.

Estado actual del campo (`RegistroForm.tsx:199-202`):

```tsx
<Input aria-label="Horas" type="number" step="0.5" min="0" value={l.hours || ''}
  onChange={(e) => update(i, { hours: Number(e.target.value) })} />
```

Un único `<input type="number">` por línea, en una fila que ya lleva proyecto,
área, departamento, etapa, tiempo y descripción.

## Decisión de precisión (tomada con su coste a la vista)

`time_log_lines.hours` es `numeric(5,2)` y `time_logs.total_hours` es
`numeric(6,2)`: **centésimas de hora**. Los únicos minutos que caben exactos son
los múltiplos de 3 (3min = 0,05h; 15min = 0,25h). **10 minutos no cabe.**

Se evaluaron tres caminos —ampliar a 4 decimales, guardar minutos como fuente de
verdad, o redondear— y **se eligió redondear a centésimas, sin migración**:

- 10 min se guarda como **0,17 h**.
- La desviación es de +0,0033 h (12 segundos) por registro, siempre en la misma
  dirección: hacia arriba.
- Alimenta el banco de horas. Cargando 10 minutos a diario, la desviación anual
  ronda las 0,8 h de más contra el banco del cliente.

Queda escrito aquí porque es una decisión de negocio, no un detalle técnico: si
los registros en minutos dejan de ser algo ocasional y pasan a ser el grueso,
merece la pena revisitar la ampliación a 4 decimales, que resolvería la deriva
sin cambiar nada de lo que se ve en pantalla.

## El control

Lectura de la pantalla: UI de producto denso, para gente que rellena varias
líneas seguidas y con prisa, dentro del lenguaje visual que la app ya tiene.
No es sitio para inventar estética.

> Nota de proceso: la skill `taste-skill` declara fuera de alcance el "dense
> product UI" y los formularios (§13). De ella se aplican solo las reglas que
> sí gobiernan aquí: patrones de formulario (§4.6), contraste AA en campos
> (§4.5), consistencia de radios (§4.4) y la auditoría de textos (§4.9).

El número y la unidad comparten un único borde, separados por una línea fina:

```
TIEMPO
┌──────────┬───────┐        ┌──────────┬───────┐
│    2     │  h ▾  │        │   10     │ min ▾ │
└──────────┴───────┘        └──────────┴───────┘
                                = 0,17h
```

### Por qué un `<select>` y no un segmentado

Un segmentado `h | min` cuesta **dos paradas de tabulador por línea**, y estas
personas rellenan varias líneas seguidas con el teclado. El `<select>` nativo da
una sola parada, navegación con flechas gratis y lectura correcta en lector de
pantalla. Además es el vocabulario que la propia fila ya usa para departamento,
etapa y descripción.

Va **sin borde propio**, dentro del contenedor compartido, con el mismo chevron
que el resto. Para eso `components/ui/native-select.tsx` gana una variante
`bare`: aditiva, sin cambiar el comportamiento de los usos existentes.

### Por qué la conversión se muestra

En modo minutos aparece debajo `= 0,17h`, con el mismo `formatHoras` que usa toda
la app. Es lo único que se añade a una fila ya densa, y se gana el sitio: sin
ella el selector reintroduce el error silencioso que hizo descartar un
interruptor global de unidad (lo pones en minutos, te olvidas, escribes "2"
pensando en horas y registras dos minutos, sin que nada te contradiga).

En modo horas **no aparece nada**: no hay conversión que tranquilizar, y quien no
use minutos ve la fila exactamente igual que hoy. La altura de fila solo crece en
las líneas que estén en minutos.

### Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Interruptor global para todo el formulario | Error silencioso: la unidad deja de estar a la vista de la línea que estás escribiendo |
| Campo que interpreta texto (`10m`, `1h30`) | Rápido para quien conoce la convención, trampa para quien no; y `10` a secas es ambiguo justo en el caso que motivó el pedido |
| Segmentado de dos botones | Dos paradas de tabulador por línea en un formulario de captura rápida |

## Comportamiento

**Conversión.** Dos funciones puras en `lib/horas/format.ts`:

```ts
minutosAHoras(min: number): number   // Math.round((min / 60) * 100) / 100
horasAMinutos(horas: number): number // Math.round(horas * 60)
```

**Cambiar de unidad convierte el valor, no lo borra.** 2h ↔ 120min. El viaje de
ida y vuelta de un caso con resto también cierra: 10min → 0,17h → 10,2 → 10min.

**La unidad no se persiste.** Es estado de UI de esa línea: no viaja al servidor,
no se guarda. Consecuencia asumida: una línea cargada como 10 min se reabre para
editar mostrando 0,17 h. Se podría adivinar la unidad al reabrir, pero sería
inventarse un dato que nunca se registró, y esta app audita cambios.

**Lo que viaja al servidor no cambia en absoluto.** La RPC `guardar_registro`
sigue recibiendo `hours`. No se entera de que existen los minutos. Cero riesgo
para el registro diario de toda la empresa.

**Validación.** En minutos: `min="1"`, `step="1"` (enteros). En horas: `min="0"`,
`step="any"`. Un minuto se guarda como 0,02 h, así que nunca cae en el
`horas deben ser > 0` de la RPC.

> **El `step` no es cosmético, es validación.** En HTML5 los valores válidos son
> `min + n × step`, así que `step="5"` con `min="1"` haría **inválido el 10** —
> justo el valor que motivó esta feature. Por lo mismo hay que **corregir el
> campo de horas**, que hoy es `step="0.5"` (`RegistroForm.tsx:200`): con ese
> paso, 0,17 es un valor inválido para el navegador, de modo que convertir 10 min
> a horas y volver al modo horas dejaría el campo marcado como inválido. Pasa a
> `step="any"`.
>
> Es un defecto que ya existe hoy —quien escriba 0,25 h tiene el campo en estado
> inválido— pero solo se vuelve visible al introducir la conversión, así que se
> arregla aquí. Efecto colateral aceptado: las flechas del campo de horas pasan a
> subir de 1 en 1 en vez de 0,5.

**Accesibilidad.** El `aria-label` del campo cambia entre "Horas" y "Minutos"
según la unidad: si no, un lector de pantalla anuncia "Horas" sobre un 10 que son
minutos. Foco visible con el anillo que ya usa la app. Contraste AA en el campo,
el select y el texto de conversión.

**Sin cambios:** el total diario del formulario se sigue mostrando en horas, y el
resto de la fila queda intacto.

## Verificación

**De función pura** (proyecto `node-horas` de Playwright, el mismo runner que usa
la auditoría): `minutosAHoras` y `horasAMinutos` en sus casos —10 min, 15 min,
1 min, un valor que redondea hacia arriba y otro hacia abajo— y el viaje de ida y
vuelta de 10 min y de 2 h.

**E2E** (`e2e/horas-registrar.spec.ts`, ampliando lo que ya hay): cambiar una
línea a minutos, escribir 10, comprobar que la pantalla muestra `= 0,17h`, que el
total del día suma esa cantidad, y que al guardar el registro queda con 0,17 h.
Además, comprobar que tras convertir a horas el campo **no** queda en estado
inválido (`input:invalid`) — es el fallo de `step` descrito arriba, y sin test
volvería a colarse.

**Gate:** `npx tsc --noEmit` y `npm run build`. `npm run lint` sigue roto
repo-wide desde Next 16.

## Fuera de alcance

- El formulario de ampliar horas y cualquier otra pantalla: solo el registro.
- Recordar la última unidad usada por persona.
- Ampliar la precisión de la base a 4 decimales (ver la decisión de precisión).
- Mostrar minutos en reportes, banco, histórico o auditoría: todo sigue en horas.

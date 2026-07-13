# Horas Provisionales de Setup — Diseño

**Fecha:** 2026-07-13
**Estado:** aprobado (pendiente de plan de implementación)
**Depende de:** las horas provisionales
([2026-07-08-horas-provisionales-design.md](2026-07-08-horas-provisionales-design.md),
ya implementadas).

## 1. Problema

El primer mes de un proyecto es un **mes de setup**: se dedican más horas al arranque
que en régimen normal. Las horas provisionales de hoy rellenan los meses sin cargar con
una tarifa única (`Horas_Provisionales`, por tipo de contrato × posición), sin distinguir
ese primer mes. Resultado: un proyecto recién ingresado se estima con la tarifa de
crucero, que subestima el arranque.

Queremos que, **solo para el primer mes provisional de un proyecto nuevo**, la estimación
use una tarifa de setup (más alta). A partir del segundo mes, si sigue sin datos reales,
se vuelve a la tarifa provisional normal (el mes de setup ya pasó).

## 2. Fuente de datos (ya existe en el Excel)

| Hoja | Rol | Se lee hoy |
|---|---|---|
| `Horas_Provisionales` | Tarifa provisional de crucero (tipo contrato × posición → horas/mes). | Sí |
| `Horas_Provisionales_Setup` | **Tarifa del mes de setup** (misma estructura, valores más altos). | **No (nuevo)** |

`Horas_Provisionales_Setup` tiene **exactamente la misma forma** que `Horas_Provisionales`:
primera columna = tipo de contrato, columnas siguientes = las mismas 12 posiciones. Las
posiciones y tipos de contrato coinciden fila a fila con la hoja normal; solo cambian los
valores. Ejemplos (setup vs normal):

| Tipo de contrato | Posición | Normal | Setup |
|---|---|---|---|
| ARCO (Implementación) | CRM | 5 | 15 |
| ARCO (Implementación) | Growth Strategist | 6.5 | 13.5 |
| CRM | CRM | 0 | 25 |
| FLECHA | CRM | 2.5 | 9 |

Como la estructura es idéntica, el lector se calca del de `Horas_Provisionales`.

## 3. La regla

Sobre la regla provisional existente (ventana `(ultimoGlobal, mesActual]`, criterios de
elegibilidad por mes), se añade **un único cambio**: qué tarifa se aplica al primer mes.

Para un proyecto **P**:

- **Disparador — P es nuevo:** P **no tiene ningún registro** en `BancoHoras`
  (`mesesReales` vacío). Si P tiene aunque sea un registro real, nada cambia: todos sus
  meses provisionales usan la tarifa normal, como hoy.
- **Mes de setup — el mes de arranque del proyecto:** el mes de la **`Fecha Inicio
  Contable`** de P (`inicioContable`, a nivel `YYYY-MM`). Es una fecha **fija** del
  proyecto, no una posición en la ventana.
  - Si ese mes cae en la ventana provisional y P no tiene registros → usa la tarifa de
    **`Horas_Provisionales_Setup`** del tipo de contrato de P.
  - El resto de meses elegibles de la ventana usan la tarifa **normal**
    (`Horas_Provisionales`), como hoy.

El setup queda **anclado** a ese mes: no se mueve. Ejemplo — hoy junio y julio sin
registros, ventana `[junio, julio]`, proyecto nuevo con inicio en junio → **setup en
junio, normal en julio**. Si más adelante se carga el lote y junio sale de la ventana
(queda `[julio]`), el setup **no** salta a julio: julio es provisional normal (nunca fue
el mes de inicio) y junio deja de mostrar estimado. Si `inicioContable` está **antes** de
la ventana (el arranque ya pasó y nunca se cargó) → **sin setup**; sus meses provisionales
son normales.

### 3.1 Marcado y semántica

- El mes de setup se marca `provisional: true` **igual que cualquier mes provisional**
  (sin badge nuevo). La única diferencia frente a un mes provisional normal es el número.
- Suma al `assigned`/total como **transitorio**, exactamente igual que las provisionales
  de hoy (arrastra la semántica del commit que hizo que las provisionales sumen al total).

### 3.2 Casos borde

| Caso | Comportamiento |
|---|---|
| Tipo de contrato sin fila en `Horas_Provisionales_Setup` | El primer mes cae a la tarifa **normal** (fallback defensivo: no se pierde la provisional). |
| El setup indica 0 en una posición (aunque la normal tenga valor) | El mes de setup respeta la tabla de setup **tal cual, por posición** (0 → esa posición no genera celda ese mes). Dato del negocio. |
| P sin registros, inicio contable **fuera** de la ventana | Sin setup; sus meses provisionales son normales (su mes de arranque ya pasó). |
| P sin registros, inicio contable dentro de la ventana | Ese mes = setup; los demás meses de la ventana = normal. |
| P con registros reales | Sin setup; toda su provisional es normal (comportamiento actual). |
| `Horas_Provisionales_Setup` no existe / vacía / Graph falla | Sin setup; el primer mes cae a tarifa normal. El resto del banco funciona igual. |

## 4. Lectura del Excel (`lib/graph/client.ts`)

Nuevo lector `getCachedHorasProvisionalesSetup()`, calcado de
`getCachedHorasProvisionales`:

- `readHorasProvisionalesSetupSheet` (misma mecánica que `readHorasProvisionalesSheet`):
  `usedRange` de la hoja `Horas_Provisionales_Setup` (nombre hardcodeado, como el de la
  hoja normal), primera columna = tipo de contrato, columnas siguientes = posiciones.
- Reutiliza el tipo `HorasProvisionales` (`Map<tipoContrato, Map<posición, horas>>`).
- Mismo truco de serialización: `unstable_cache` pierde los `Map`, así que se cachea la
  forma *entries* (`horas-provisionales-setup-entries`, key nueva) y se reconstruye el
  `Map` al leer. Mismo tag `BANCO_HORAS_TAG` (mismo refresco manual).

Se puede factorizar el cuerpo común de lectura entre la hoja normal y la de setup si
queda natural; no es obligatorio.

## 5. La función pura (`lib/horas/provisionales.ts`)

`provisionalPorPosicion` recibe un parámetro nuevo `tarifaSetup: Map<string, number> |
undefined` y detecta `esNuevo = mesesReales.size === 0`. Se itera la ventana (ya
ascendente); en el **mes de inicio contable** (`M === inicioMes`), si `esNuevo` y hay
`tarifaSetup`, se usa esa tabla; el resto usa la normal. La forma de retorno
(`Map<posición, BancoMensual[]>`) y el marcado `provisional: true` no cambian.

```ts
const esNuevo = mesesReales.size === 0
for (const M of ventana) {
  if (mesesReales.has(M)) continue    // (nunca para un proyecto nuevo)
  if (inicioMes > M) continue         // aún no arrancó
  if (finMes && finMes < M) continue  // ya finalizó
  // Setup solo en el mes de inicio contable de un proyecto sin registros.
  const tabla = (esNuevo && M === inicioMes && tarifaSetup) ? tarifaSetup : tarifa
  for (const [position, hours] of tabla) {
    if (hours <= 0) continue
    const arr = out.get(position) ?? []
    arr.push({ month: M, assigned: hours, consumed: 0, provisional: true })
    out.set(position, arr)
  }
}
```

`M === inicioMes` acota el setup a un único mes. Como el guard `inicioMes > M` garantiza
`M ≥ inicioMes`, solo el propio mes de inicio cumple la igualdad; y si ese mes no está en
la ventana (arranque anterior a la ventana), ninguna iteración lo alcanza → sin setup.

## 6. Ensamblado (`lib/horas/bancos.ts`)

Ambos consumidores, `getBancosHoras` y `getBancoHorasDetalle`:

- Cargan `getCachedHorasProvisionalesSetup()` con el mismo `try/catch` tolerante que la
  hoja normal (fallo → `Map` vacío).
- Resuelven `tarifaSetup = meta ? horasProvSetup.get(meta.tipoContrato) : undefined`.
- Pasan `tarifaSetup` a `provisionalPorPosicion`.

Nada más cambia: `assigned` sigue incluyendo la provisional (setup incluido), y los
totales, el desglose mensual (`BancoDetalleMensual.provisional`) y el semáforo se calculan
igual sobre los nuevos números.

## 7. UI

Sin cambios. El badge sigue siendo "Provisional"; el mes de setup solo trae un número
mayor. No se toca ningún componente (`BancosHorasClient`, `BancoDetalleView`).

## 8. Testing

- La lógica vive en la función pura `provisionalPorPosicion`, que se verifica de forma
  **determinista** (chequeo de nodo, sin framework de unit tests — consistente con el
  repo):
  - Proyecto sin registros, inicio contable dentro de la ventana → el mes de inicio =
    tarifa setup; los demás meses de la ventana = tarifa normal.
  - Proyecto sin registros, inicio contable **antes** de la ventana → sin setup (todos
    normales).
  - Proyecto con registros → todos los meses provisionales = tarifa normal.
  - Sin `tarifaSetup` para el tipo de contrato → el mes de inicio cae a normal.
- El e2e existente (`e2e/horas-bancos.spec.ts`) sigue siendo tolerante a los datos vivos.
- Gate del repo: `tsc` + `build` (lint roto repo-wide).

## 9. Fuera de alcance

- La hoja `Primera Aparicion` (se descartó como fuente; el ancla es `Fecha Inicio
  Contable`).
- Cambios en HUCHA.
- Arrastre de saldo entre meses.
- Distintivo visual propio para el mes de setup.

## 10. Decisiones cerradas (registro)

- Fuente: hoja `Horas_Provisionales_Setup` (misma estructura que `Horas_Provisionales`).
- Disparador: proyecto **sin ningún registro** en `BancoHoras`.
- Mes de setup: **el mes de `Fecha Inicio Contable`** (fecha fija; el setup no se mueve
  con la ventana). Inicio fuera de la ventana → sin setup.
- Marcado: igual que provisional (sin badge nuevo); suma al total como transitorio.
- Fallback sin fila de setup → tarifa normal ese mes.
- El mes de setup respeta la tabla de setup por posición (0 incluido).

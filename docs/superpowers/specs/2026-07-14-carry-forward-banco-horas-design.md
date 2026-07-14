# Diseño — Carry forward del banco de horas (recalculable, por posición)

**Fecha:** 2026-07-14
**Estado:** aprobado, pendiente de plan de implementación
**Origen:** pedido de negocio (Marcos) + hoja Excel de referencia del usuario (enero–julio)

## Problema

Hoy el sobrante de un mes del banco se pierde sin más: un proyecto con abril 8/16h
simplemente muestra 8h sin usar. Negocio quiere un **carry forward**: al cerrar cada mes,
una parte del sobrante se conserva como **horas libres** utilizables después, el resto se
declara **inutilizable**, y el disponible del proyecto refleja esa realidad — siempre
**recalculable ante cualquier cambio del Excel** (sin estado guardado).

## El modelo de cálculo

Función pura sobre el `monthly[]` por posición que ya existe (`BancoMensual`). Para cada
**mes cerrado** (`month < mesActual`) — **sin distinción de origen: real, provisional o
setup, todos sufren el corte**:

```
sobrante_m      = max(asignado_m − consumido_m, 0)     ← nunca negativo
exceso_m        = max(consumido_m − asignado_m, 0)
libres_m        = CARRY_FORWARD_PCT × sobrante_m       ← 25%, constante en código
inutilizables_m = (1 − CARRY_FORWARD_PCT) × sobrante_m ← 75%
```

El **mes en curso nunca sufre el corte**: su restante cuenta entero como disponible
normal. No hay meses futuros (el Excel contabiliza mes a mes).

Totales por posición (el proyecto = suma de sus posiciones):

```
inutilizables    = Σ inutilizables_m
carryBruto       = Σ libres_m
carryNeto        = max(carryBruto − Σ exceso_m, 0)     ← los excesos comen del carry
disponibleReal   = asignado_total − consumido_total − inutilizables
disponibleNormal = disponibleReal − carryNeto          ← restante "del mes" (sin carry)
```

### Tabla de referencia (hoja del usuario — fixture canónica de tests)

| | Ene | Feb | Mar | Abr | May | Jun | Jul (en curso) | Total |
|---|---|---|---|---|---|---|---|---|
| Banco | 5 | 5 | 5 | 5 | 5 | 0 | 5 | 30 |
| Consumo | 2 | 2 | 0 | 1 | 0 | 3 | 0 | 8 |
| Sobrante | 3 | 3 | 5 | 4 | 5 | 0 | 5 | 22 |
| Inutilizables | 2.25 | 2.25 | 3.75 | 3 | 3.75 | 0 | — | **15** |
| Disponibles reales | 0.75 | 0.75 | 1.25 | 1 | 1.25 | 0 | 5 | **7** |

Verificación: carryBruto = 5, excesos = 3 (junio), carryNeto = **2**; disponibleNormal =
**5** (julio); disponibleReal = 30 − 8 − 15 = **7** = 5 + 2. El ejemplo original de abril
(16h asignadas, 8 consumidas → 8 usadas, 6 inútiles, 2 libres) también cierra: 8 × 75% = 6,
8 × 25% = 2.

## Decisiones acordadas

1. **Regla del corte**: 25% del sobrante del mes cerrado arrastra (libre), 75% se
   inutiliza. `CARRY_FORWARD_PCT = 0.25` **fijo en código** (como los umbrales de status);
   cambiarlo = deploy.
2. **Destino**: las libres **suman al disponible real** del proyecto — un proyecto deja de
   verse "excedido" si el carry cubre el exceso. El status y las alertas usan cifras
   efectivas.
3. **Nivel**: **por posición** (coherente con el modelo del banco); el proyecto agrega.
4. **Distinción obligatoria** entre disponibles **normales** (restante del mes en curso) y
   disponibles **carry forward** (libres netas de meses cerrados) en la visualización.
5. **Meses provisionales/setup sufren el corte igual que los reales.** Decidido
   explícitamente: excluirlos daría mejor trato al proyecto con Excel atrasado (100% del
   sobrante vivo vs 25%), y el recálculo total al llegar el dato real ya es la naturaleza
   del modelo. Si al recalcular el mes quedó excedido, su sobrante es 0 → no aporta libres
   y su exceso descuenta del pool (sin caso especial: sale de `max(…, 0)`).
6. **Ampliaciones fuera del corte**: son horas otorgadas explícitamente a nivel proyecto;
   suman al disponible como hoy y no generan inutilizables.
7. **Proyectos excedidos sin carry**: emergente de la fórmula (los excesos consumen las
   libres; total excedido → disponibleReal < 0 → status Excedido, como hoy).
8. **Expiración a los 9 meses sin registros: NO se implementa** (decidido 2026-07-14;
   posible extensión futura — ver "Fuera de alcance").

## Arquitectura

Todo derivado on-read (patrón de la app: provisionales, setup, estados). **Sin
migraciones, sin estado guardado.**

- **Nuevo `lib/horas/carry-forward.ts`** — puro, SIN imports de servidor (lo consumen
  página servidor y componentes cliente):
  - `CARRY_FORWARD_PCT = 0.25`
  - `carrySplit(monthly: BancoMensual[], mesActual: string)` → devuelve el desglose
    por mes `{ month, libres, inutilizables, exceso }` (solo meses cerrados) y los
    totales `{ inutilizables, carryBruto, carryNeto }`.
- **Tipos** (`lib/horas/bancos-status.ts`):
  - `BancoMensual` gana opcionales `libres?: number` e `inutilizables?: number`
    (poblados solo en meses cerrados).
  - `BancoHorasRow` gana `inutilizables: number` y `carryNeto: number`.
  - `BancoHorasDetalle` gana `inutilizables: number` y `carryNeto: number`
    (`disponibleReal`/`disponibleNormal` se derivan donde se muestran).
  - `groupBancosByProject` suma `inutilizables`/`carryNeto` de las posiciones y propaga
    `libres`/`inutilizables` en el monthly agregado.
- **`computeHorasStatus` con cifras efectivas**: en filas y detalle el status pasa a
  calcularse como `computeHorasStatus(asignado − inutilizables, consumido)`. El umbral
  "bajo" (20%) queda relativo al asignado efectivo. El aviso de "excedido" al registrar
  (`registrar/page.tsx`, que sí consume `getBancosHoras`) refleja el carry solo.
  **Nota**: las alertas Slack 80/100/exceso (`lib/horas/alertas.ts`) calculan su propio
  asignado (Excel total + ampliaciones, sin desglose mensual) → siguen con cifras crudas;
  adaptarlas queda fuera de alcance.
- **Cálculo en servidor** (`lib/horas/bancos.ts`): `getBancosHoras` y
  `getBancoHorasDetalle` llaman a `carrySplit` por posición y pueblan los campos; el
  cliente solo agrupa/suma (como hoy).
- El **ledger de Movimientos** no cambia (sigue partiendo del Excel real).

## UI (estética existente: tokens carmín/status, shadcn)

### Detalle del proyecto — sección nueva "Cierre de mes por posición" (elemento firma)

Charts de **shadcn** (`npx shadcn add chart` → `components/ui/chart.tsx` + dependencia
`recharts`). Un **stacked bar chart por posición** (small multiples: grid `md:grid-cols-2`
si hay varias posiciones; ancho completo si hay una), meses en el eje X (`mesCorto`).
La barra de cada mes = su asignado completo, segmentada:

- **Consumido** → carmín `--brand`
- **Inutilizables** → rojo `--status-excedido`
- **Libres (carry)** → verde `--status-disponible`
- **Restante del mes en curso** → gris `--muted-foreground`/muted (sin corte todavía)

Un mes cerrado se ve "lleno" (el 16/16 del ejemplo: todo contabilizado). `ChartTooltip`
con el desglose en horas y la marca "estimado" si el mes es provisional; `ChartLegend`
con las cuatro series. La sección respeta el alcance (solo posiciones visibles para el
manager) y no se renderiza si no hay datos mensuales.

### KPIs del detalle

La card "Restante" pasa a **"Disponible real"**: cifra grande `disponibleReal`, subtítulo
con el desglose `Xh del mes · Yh carry forward · Zh inutilizables` (omitiendo términos en
cero). La distinción normales vs carry queda siempre visible.

### Lista /bancos

- Status y restante ya reflejan el carry vía cifras efectivas (sin trabajo extra).
- Marca **«CF»** en la fila (patrón de la marca «Prov.»): en vista Total si
  `carryNeto > 0`; en Mensual si algún mes seleccionado tiene `libres > 0`.
- **CSV**: columnas nuevas `Inutilizables` y `Libres (carry)`.

## Fuera de alcance

- **Expiración del carry a los 9 meses sin registros** (pedido original, pospuesto hoy).
  Si se retoma, ojo con la sutileza de la resurrección: al ser todo recalculable, un
  registro nuevo tras la inactividad restauraría las libres viejas salvo que se caduquen
  por antigüedad del mes generador.
- Configurar el % desde el Excel (hoy constante en código).
- Cambios en el ledger de Movimientos.
- Adaptar las alertas Slack 80/100/exceso al asignado efectivo (hoy usan Excel total +
  ampliaciones, sin desglose mensual).

## Riesgos / bordes

- **Inutilizables "estimados"**: meses provisionales cerrados generan inutilizables que
  pueden moverse cuando el Excel real llegue (recalculo total, aceptado por diseño). El
  tooltip del chart los marca como estimados (el `monthly[]` ya trae `provisional`).
- **Fracciones**: 25% de sobrantes no múltiplos de 4 da cuartos de hora (2.25, 3.75…);
  `formatHoras` ya los muestra. Sin redondeo especial.
- **Mes con consumo y sin asignación** (mes cerrado, asignado 0, consumido N): sobrante
  0, exceso N → come del carry. Coherente con junio de la tabla.
- **Mes en curso sobre-consumido**: `disponibleNormal` puede dar negativo (el carry está
  cubriendo el exceso del mes). En el desglose del KPI se muestra con piso en 0
  (`max(disponibleNormal, 0)`) y el carry mostrado se reduce en consecuencia
  (`disponibleReal − normalMostrado`); la cifra grande `disponibleReal` es la verdad.

## Testing

- **Node (unit-style, proyecto `node-horas`)**: `carrySplit` contra la tabla de
  referencia completa (enero–julio) → inutilizables 15, carryBruto 5, carryNeto 2; y el
  ejemplo de abril (16/8 → 6/2). Casos borde: mes excedido (sobrante 0), mes en curso
  intacto, lista vacía.
- **e2e UI (`chromium-horas-admin`)**: el detalle muestra la sección "Cierre de mes por
  posición" y el KPI "Disponible real" con desglose; la lista marca «CF» (tolerante si el
  seed no produce carry).
- Gate: `npx tsc --noEmit` + build en Vercel.

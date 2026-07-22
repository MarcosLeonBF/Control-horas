# Libertad de registro en julio — diseño

**Fecha:** 2026-07-22
**Pieza:** ventana de fechas al registrar horas (RPC `guardar_registro` + `RegistroForm`)

## Contexto y pedido

El cliente (Marcos) pidió "dar libertad este mes nada más": durante julio, que
los usuarios puedan registrar horas en **cualquier día de julio** (del 1 al día
de hoy), y que **cuando pase julio se vuelva a una ventana corta**.

Estado actual del sistema:

- **No-admin:** puede registrar desde `hoy − 14 días` hasta hoy (nunca futura).
  La restricción real se valida en el servidor, en la RPC `guardar_registro`
  (migración `0033`, línea `v_date < current_date - 14`). El frontend
  (`RegistroForm`) replica el límite como pista de UI con `min={daysAgo(14)}` y
  el texto "Hasta 14 días atrás".
- **Admin:** sin límite de antigüedad (`canBackdate` / `v_role = 'admin'`).
- La ventana fue 7 días originalmente y se subió a 14 en `0030`→`0033`. Los
  tests SQL (`horas_rpc_guardar.sql`) nunca se actualizaron y todavía asumen 7
  días ("FECHA > 7 DÍAS", "ventana de 7 días").

Marcos dijo "7 días"; se confirmó que **la ventana normal pasa a 7 días** (baja
de 14 → 7), con julio como excepción temporal.

> Nota reversible: si el "7" fue un desliz y se prefiere mantener 14, es cambiar
> un único número (`current_date - 7` → `current_date - 14`) en la migración y el
> cálculo espejo del frontend.

## Comportamiento (fuente de verdad = servidor)

Para un usuario **no-admin**, la fecha mínima registrable (`piso`) es:

```
piso := current_date - 7                       -- regla normal
si current_date <= DATE '2026-07-31':
    piso := LEAST(piso, DATE '2026-07-01')     -- excepción julio (más permisiva)
rechazar la línea si entry_date < piso
```

- Se usa `LEAST` a propósito: la excepción **nunca reduce** la libertad. En los
  primeros días de julio, `current_date − 7` cae en junio y sigue permitido; a
  partir de mediados de julio manda el piso `2026-07-01`.
- La fecha futura se sigue rechazando aparte (`entry_date > current_date`), sin
  cambios.
- **Admin:** sin cambios; sigue sin límite.
- **Auto-vencimiento:** desde el 2026-08-01, `current_date <= '2026-07-31'` es
  falso, la rama de julio deja de aplicar sola y rige solo `current_date − 7`.
  No hay que revertir nada a mano; la rama queda inerte (se puede limpiar en un
  mantenimiento posterior).

El chequeo es **por línea**: una sola línea fuera de rango aborta todo el envío
(comportamiento actual, se conserva).

### Mensaje de error

El mensaje debe reflejar el piso real:

- Durante julio: `fecha fuera de rango: en julio se registra desde el 01/07`.
- Fuera de julio: `fecha fuera de rango: máximo 7 días atrás`.

(Un `if current_date <= '2026-07-31'` elige el texto; alternativamente un único
mensaje dinámico que interpole el `piso`. Cualquiera de las dos sirve.)

## Servidor

Nueva migración **`0039_horas_registro_julio_libertad.sql`** que hace
`create or replace function public.guardar_registro(...)` a partir de la
definición viva (`0033`), con un **único cambio funcional**: reemplazar

```sql
if v_role <> 'admin' and v_date < current_date - 14 then
  raise exception 'fecha fuera de rango: máximo 14 días atrás';
end if;
```

por el piso dinámico descrito arriba (calculado una vez antes del loop de
líneas, o inline por línea; el piso no depende de la línea, así que conviene
calcularlo una vez en una variable `v_min_date`).

Todo lo demás de `0033` (validaciones de área/etapa/departamento, dedup, split
por fecha, auditoría) se copia sin cambios.

Fuera de alcance: la RPC de **anulación** (`anular_registro`) mantiene su propia
ventana de 7 días; el pedido es sobre *registrar*, no sobre anular. La **edición**
de un registro pasa por `guardar_registro`, así que hereda el piso nuevo
automáticamente.

## Frontend (solo pista de UI)

`components/horas/RegistroForm.tsx`:

- Helper que calcule el `min` con la misma lógica del servidor:
  `piso = (hoy <= '2026-07-31') ? min(daysAgo(7), '2026-07-01') : daysAgo(7)`.
  En la práctica, durante julio el `min` de los date inputs es `2026-07-01`.
- Aplicarlo en los dos `<Input type="date">` (fecha por defecto ~línea 225 y
  fecha por línea ~línea 164), respetando `canBackdate` (admin → sin `min`).
- Texto de ayuda dinámico (hoy fijo "Hasta 14 días atrás", línea 228):
  - julio → "En julio podés registrar desde el 1".
  - resto → "Hasta 7 días atrás".

El frontend es solo una comodidad; aunque quedara desalineado, el servidor es
quien realmente valida.

## Tests

- **`supabase/tests/horas_rpc_guardar.sql`:** el caso "fuera de rango" usa
  `current_date - 10`, que **durante julio cae dentro de la excepción** (≥ 1-jul)
  y ya no sería rechazado. Cambiar ese caso a una fecha robusta a ambos regímenes
  (p. ej. `current_date - 40`: en julio es < 1-jul → rechazada; fuera de julio es
  > 7 días → rechazada). Los comentarios del test ya asumen 7 días, así que el
  resto queda coherente al bajar la ventana.
- **`e2e/horas-registrar.spec.ts`:** usa "hace 3 días" (dentro de 7) → sigue
  válido. Revisar si algún otro e2e prueba el borde de la ventana y ajustarlo.
- Añadir (idealmente) un caso que verifique que **durante julio** una fecha como
  `2026-07-02` (que sin excepción estaría fuera de 7 días) se acepta. Nota: este
  caso depende de la fecha del reloj; si complica el test SQL determinista, dejar
  la verificación como manual/round-trip.

## Despliegue

1. Aplicar la migración `0039` en Supabase (remoto).
2. Deploy del frontend a Vercel.
3. Gate del repo: `tsc` + `build` (el lint está roto repo-wide desde Next 16).
4. Round-trip manual: como no-admin en producción durante julio, registrar una
   fecha de principios de julio (fuera de la ventana de 7) y confirmar que
   guarda; confirmar también que una fecha de junio es rechazada.

# Horas históricas (B): consumo en el banco de horas y carry forward

**Fecha:** 2026-07-21
**Estado:** aprobado
**Depende de:** pieza A (`2026-07-21-horas-historicas-carga-design.md`), ya cargada.

## Objetivo

Que las 1.967 filas de `horas_historicas` (12.087,90 h, nov-2024 → jun-2026)
cuenten como **consumo real** en el banco de horas, y por tanto en el cálculo de
carry forward.

## El solape y su regla

`time_logs` contenía un único registro anterior a julio-2026: **Arturo
Rodríguez, 30/06/2026, 37 h** (17 líneas, creadas el 10/07, descripciones del
tipo "…del 25 al 30 de junio"). El histórico imputa **167,5 h** a ese mismo
junio-2026.

Comparación proyecto a proyecto: de los 14 proyectos del registro de plataforma,
**13 están también en la hoja y siempre con más horas** (Opospills 25 vs 6,5;
Departamento 38 vs 13; Bloques With 11,5 vs 7,5…). Solo `Bastida Dental` (0,5 h)
existe únicamente en la plataforma. Conclusión: **el registro de la plataforma es
un subconjunto del cierre mensual del histórico** (una semana de un mes entero),
no un dato adicional. Sumarlos contaría doble.

**Regla elegida — mes de corte:**

```ts
export const MES_CORTE_HISTORICO = '2026-06'
```

- `time_log_lines` cuenta solo si `entry_date` cae en un mes **> corte**.
- `horas_historicas` cuenta siempre (ninguna fila supera el corte).

Se descartó la alternativa "la plataforma manda siempre": habría dejado junio de
Arturo en 37 h en vez de 167,5 h, perdiendo **130,5 h** de trabajo real. La regla
elegida pierde solo las **0,5 h** de `Bastida Dental`, y es general: no tiene
casos especiales por usuario y sigue valiendo si aparecen más registros antiguos.

Esto afecta **solo al consumo del banco**. El registro de 37 h sigue existiendo y
visible en los registros del usuario y en `/reportes`.

## Cambios

Todo en `lib/horas/bancos.ts`. Las reglas vigentes se aplican igual al histórico:
se **omite `project = 'Departamento'`** (horas internas no consumen banco; son
137 filas) y la posición se resuelve con `userPosition.get(user_id)`, es decir,
la **posición actual del perfil** — igual que con los registros normales, y
coincide con la de la hoja en las 17 personas.

1. **`getBancosHoras()`** — a los mapas `consumed`, `consumedMes` y
   `posConsumoPorProyecto` se suma el histórico, y las líneas de plataforma se
   filtran por el mes de corte.
2. **`getBancoHorasDetalle()`** — idéntico para `consumedByPos` y
   `consumedByPosMes`, acotado al proyecto.
3. **`buildMovimientos()`** — el histórico no tiene día, solo mes. Se agrega
   **una línea por mes**, fechada al último día de ese mes, con actor
   `Histórico` y detalle `Cierre mensual`. Si se dejara fuera, el saldo del
   historial dejaría de cuadrar con los totales del proyecto.

`carrySplit` **no se toca**: recibe `monthly` ya con el consumo histórico dentro
y recalcula el corte 75/25 y los excesos por sí solo. El carry es derivado, no
se persiste.

## Consecuencias asumidas

- **La lista de `/bancos` crece:** hay 153 proyectos en el histórico; los que no
  estén en el Excel aparecerán ahora como proyectos con consumo.
- **El carry se mueve mucho:** los meses históricos pasan a tener consumo y por
  tanto entran en el corte 75/25 y en el cálculo de excesos. Donde el Excel no
  asigne horas a un mes con consumo histórico, ese consumo se vuelve `exceso` y
  descuenta del `carryNeto`. Decisión tomada por el usuario con el riesgo
  expuesto ("tratarlo igual que el resto").
- **Reversible:** no se escribe ningún dato; todo es derivado. `git revert`
  deshace el efecto por completo.

## Verificación

- `npx tsc --noEmit` (gate del repo; lint roto repo-wide desde Next 16).
- Medir el delta de consumo por proyecto vía SQL sobre `horas_historicas` y
  contrastarlo con lo que muestre `/bancos`.
- El impacto en carry e inutilizables depende de las horas asignadas del Excel
  (que solo lee la app vía Graph), así que se comprueba en la UI.
- Testing funcional a cargo del usuario.

# Horas históricas (C): el histórico en /reportes

**Fecha:** 2026-07-21
**Estado:** aprobado
**Depende de:** pieza A (tabla cargada) y B (banco), ambas en producción.

## Objetivo

Que las 1.967 filas de `horas_historicas` (12.087,90 h, nov-2024 → jun-2026)
aparezcan en `/reportes`. Hoy esa pantalla solo lee `time_log_lines`, así que un
rango antiguo sale vacío.

## Decisiones cerradas

- **Interruptor "Incluir histórico"**, no mezcla silenciosa. Afecta a todo:
  resumen, las 7 agrupaciones, la tabla, el modal de desglose y las tres
  descargas. **Activado por defecto**: el rango por defecto es el mes en curso,
  donde no hay histórico, así que no cambia lo que se ve hoy al entrar.
- **Fecha = cierre de mes.** Cada fila histórica se traduce a una `ReporteLine`
  con `date` = último día de su mes. Reutiliza todo lo existente sin tocarlo
  (filtro de rango, agrupaciones, modal, exports) y es la misma convención que ya
  usan los movimientos del banco (pieza B, validada).
- **Normalización de etapa:** si el nombre coincide con el catálogo ignorando
  mayúsculas, se usa el del catálogo. Sin esto, "Servicios mensuales" (1.331
  filas del histórico) saldría como una etapa distinta de "Servicios Mensuales"
  (la que usan los registros actuales). `Otros` y `Otros (sin G/G)` se quedan
  tal cual: no están en catálogo a propósito.
- **Área y descripción vacías** (`'—'` y `''`), sin relleno inventado: el origen
  no los trae. Al agrupar por Área el histórico cae en "—".
- **Horas internas:** `isInternal = project === 'Departamento'`, igual que hoy,
  así el KPI "Horas internas" recoge bien las 137 filas internas del histórico.

## Corrección de seguridad (obligatoria)

La policy de `horas_historicas` creada en la pieza A es **más permisiva** que la
de la plataforma:

| Tabla | SELECT |
|---|---|
| `time_logs` | `user_id = auth.uid() OR is_admin() OR (manager AND manager_sees_user(user_id))` |
| `horas_historicas` (A) | cualquier `manager` o `admin` ve **todo** |

No ha expuesto nada hasta ahora porque el banco lee con service role (que salta
RLS), pero `/reportes` lee con el cliente del usuario: en cuanto C exponga la
tabla, **un manager vería el histórico de gente fuera de su equipo**.

Migración `0038_horas_historicas_rls_scope.sql`: se reemplaza la policy por la
misma expresión que `time_logs`, reutilizando los helpers `is_admin()`,
`current_role_app()` y `manager_sees_user()` para que siga automáticamente
cualquier cambio futuro de alcance.

## Cambios

- **`lib/horas/format.ts`**: `finDeMes(month)` compartido ('YYYY-MM' → ISO del
  último día). Hoy vive duplicado y privado en `bancos.ts`; se extrae y `bancos.ts`
  pasa a usarlo.
- **`lib/horas/reportes-types.ts`**: `ReporteLine` gana `historico: boolean`.
- **`lib/horas/reportes.ts`**: `getReporteLines(from, to)` consulta también
  `horas_historicas` (meses que solapan el rango), resuelve nombre y posición
  desde el perfil, normaliza la etapa contra el catálogo, fecha a cierre de mes
  y filtra al rango exacto.
- **`components/horas/ReportesView.tsx`**: interruptor "Incluir histórico" junto
  a los filtros; las líneas históricas se descartan cuando está apagado, antes de
  cualquier cálculo.

## Verificación

- `npx tsc --noEmit` (gate del repo; lint roto repo-wide desde Next 16).
- Contrastar por SQL el total histórico de un rango contra lo que muestre la
  pantalla con el interruptor encendido y apagado.
- Testing funcional a cargo del usuario.

## Pendiente (pieza D)

Vista propia de "Histórico", solo lectura, para consultar los cierres mensuales
sin mezclarlos con lo actual.

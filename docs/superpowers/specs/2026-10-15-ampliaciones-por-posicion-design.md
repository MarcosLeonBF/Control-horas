# Ampliaciones de horas por posición (y managers que amplían)

Fecha: 2026-10-15 · Pedido de Roberto · Estado: aprobado en conversación, en implementación

## Problema

Al ampliar horas de un banco no se elige la posición: la ampliación (`horas_ampliaciones`,
migración 0014) es del proyecto y solo existe en el detalle de `/bancos/[project]`, sumada
al total. La lista de `/bancos`, el estado de cada posición y los avisos por posición no la
ven. Además solo un admin puede ampliar; se quiere que el manager del proyecto también pueda.

## Decisiones (cerradas con Roberto)

1. **Toda ampliación es de una posición.** El formulario pide la posición (obligatoria).
2. **Fuera del carry forward.** Las horas ampliadas no entran en el corte 75/25: no se
   recortan al cerrar el mes ni caducan; siguen disponibles hasta que se consumen. El
   consumo sale primero del Excel/provisional del mes.
   Ejemplo: septiembre CRM con 16 h Excel, 10 h ampliadas y 12 h consumidas → sobran 4 del
   Excel (1 libre, 3 inutilizables) y las 10 ampliadas siguen disponibles.
3. **Quién amplía.** Admin: cualquier proyecto y posición. Manager: solo en los proyectos
   donde figura como «Manager del proyecto» en el Excel (Clientes_Proyectos) y solo en las
   posiciones de sus áreas (las que ya ve en `/bancos`).
4. **Quién anula.** Admin: cualquiera. Manager: solo las que creó él.
5. **Dónde se comprueba (opción A).** El manager del proyecto vive solo en el Excel, que la
   base no conoce. La acción del servidor comprueba todo y escribe con service role;
   `ampliar_horas` deja de ser ejecutable por `authenticated`. Anular sí lo decide la base
   (la regla «admin o la creó él» es comprobable allí).

## Diseño

### Datos — migración 0062

- `horas_ampliaciones.position text not null` (la tabla está vacía en producción a
  2026-10-15: no hay filas que rellenar). Índice `(project, position) where active`.
- `ampliar_horas(p_actor uuid, p_project text, p_position text, p_hours numeric,
  p_reason text, p_entry_date date) returns uuid`, SECURITY DEFINER, ejecutable solo por
  `service_role` (revoke explícito a `public`, `anon`, `authenticated`). Revalida: actor
  activo con rol admin/manager, la posición existe en `positions`, horas > 0, motivo no
  vacío, fecha no futura. Se borra la firma antigua (sin posición ni actor).
- `anular_ampliacion_horas(p_id)`: sigue siendo del usuario (`authenticated`); admin anula
  cualquiera, manager solo si `created_by = auth.uid()`; el resto, «no autorizado».

### Cálculo — `lib/horas/bancos.ts` y `lib/horas/carry-forward.ts`

- `BancoMensual.ampliado?` (parte de `assigned`) y `BancoHorasRow.ampliado` (Σ de la fila).
- Posiciones de un proyecto = Excel ∪ consumo ∪ provisional ∪ **ampliaciones activas**.
- La ampliación se suma al `assigned` de la posición y al del mes de su `entry_date`.
- `carrySplit` corta solo la base: `base = assigned − ampliado`; sobrante y exceso del mes se
  miden contra la base. Disponible real y estado: mismas fórmulas de siempre.
- Lista (`getBancosHoras`) y detalle (`getBancoHorasDetalle`) leen las ampliaciones activas;
  los avisos usan la lista, así que ya las incluyen por posición.
- Detalle: el manager solo ve las ampliaciones de las posiciones visibles. El total del
  proyecto y los meses salen de las posiciones (ya no se suman aparte).

### Permisos — `app/(horas)/bancos/[project]/actions.ts` y `lib/horas/ampliar-permisos.ts`

- `ampliarHoras(project, { position, hours, reason, entry_date })`:
  admin → sigue; manager → el nombre del Excel casa (`casarPorNombre`, contra managers y
  admins activos, la regla del filtro Manager de `/bancos`) con él **y** la posición es de
  sus áreas; si el Excel no responde, el manager no puede ampliar («No se pudo comprobar el
  manager del proyecto»). Inserta con `createAdminClient().rpc('ampliar_horas', { p_actor })`.
- `anularAmpliacionHoras`: llama al RPC con la sesión del usuario (decide la base).

### Pantalla — detalle del banco

- «Ampliar horas»: visible para admin y para el manager del proyecto.
- Diálogo: campo **Posición** obligatorio (las del proyecto primero; luego «Otras
  posiciones» del alcance de quien amplía). Texto: las horas se suman a la posición y no
  entran en el corte 75/25.
- Tabla Ampliaciones: columna Posición; «Anular» en las filas que esa persona puede anular.
- Cierre de mes: lo ampliado sin usar de un mes cerrado se ve como disponible (no
  inutilizable); el desglose añade «Ampliadas».

### Avisos — contrato v1 (Julián)

- `banco.ampliacion` gana `posicion` (campo nuevo; sigue `version: 1`, como prevé el
  contrato). `horas`/`nivel` siguen siendo del total del proyecto.
- `banco.nivel`/`banco.al_tope` con `alcance: 'posicion'`: `horas.ampliadas` deja de ser
  siempre 0 y la ampliación mejora el nivel de su posición.
- Entrada nueva en el historial del contrato; avisar a Julián antes de desplegar.

## Despliegue

Rama `feat/ampliaciones-por-posicion` desde `origin/main` (en `master` hay trabajo sin
subir que espera a la 0061). Orden: aplicar 0062 → push a `main` → verificar en vivo →
fusionar la rama en `master`. La 0062 quita la firma vieja de `ampliar_horas`: entre aplicar
y desplegar, ampliar falla (ventana corta; ampliar es raro).

## Pruebas

- Node: `carrySplit` con ampliado (ejemplo 16/10/12), `nivelesDeBancos` con ampliado por
  posición, `datosAmpliacionHoras` con `posicion`, regla de permiso (pura).
- SQL: `authenticated` no ejecuta `ampliar_horas`; manager anula las suyas y no las ajenas.
- E2E (siembra en producción): ampliar con posición como admin.

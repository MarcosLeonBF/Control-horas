# Distinguir proyectos "pausados" en la lista de bancos

**Fecha:** 2026-07-03
**Estado:** Aprobado — implementado
**Pedido:** En la lista de proyectos hay proyectos pausados; hay que distinguirlos
visualmente de los finalizados y los activos.

## Alcance

- **Incluye:** la insignia de estado del proyecto en la lista de bancos de horas
  (`components/horas/BancosHorasClient.tsx`, función `estadoProyectoClass`).
- **No incluye:** el selector al registrar, la vista de detalle `/bancos/[project]`
  (no muestra estado), filtros ni orden de la tabla. Decisión del usuario: solo
  la lista `/bancos`.

## Contexto

El estado del proyecto viene de la hoja Excel `Clientes_Proyectos` (columna
`Estado`), como **texto libre**, y llega a cada fila como `r.projectEstado`. Hoy
`estadoProyectoClass` colorea la insignia así:

- `finalizado` → gris (`bg-foreground/[0.07] text-muted-foreground`)
- `activo` → verde (`bg-(--status-disponible)/12 text-(--status-disponible)`)
- cualquier otro (incluido **pausado**) → muted genérico (indistinguible)

## Cambio

1. **Nuevo token** en `app/globals.css`, junto a los estados:
   `--status-pausado: #2F5FA6;` (azul acero). Se agregó un color nuevo porque la
   paleta no tenía ninguno azul/violeta y el ámbar (`--status-bajo`) ya significa
   "banco bajo" en esa misma tabla; un color propio evita ambigüedad.

2. **Rama nueva** en `estadoProyectoClass`:
   `if (e.includes('paus')) return 'bg-(--status-pausado)/12 text-(--status-pausado)'`
   - Match por `includes('paus')` (case-insensitive) para tolerar "Pausado",
     "En pausa", etc.
   - El **texto** de la insignia sigue siendo el valor crudo del Excel
     (`{r.projectEstado}`); solo se mapea el color.

Resultado: activo (verde) · pausado (azul) · finalizado (gris) · otros (muted).

## Qué NO cambia

- Filtros y orden de la tabla (siguen por estado del *banco*, no del proyecto).
- Flujo de datos (`getCachedProyectosEstado` → `projectEstado`).
- Descarga Excel/CSV (ya incluye la columna "Estado proyecto" con el texto crudo).

## Testing

- Verificación visual en `/bancos`: un proyecto pausado muestra insignia azul,
  distinta de activo (verde) y finalizado (gris).
- Ningún e2e verifica el color de estas insignias, así que no se tocan tests.

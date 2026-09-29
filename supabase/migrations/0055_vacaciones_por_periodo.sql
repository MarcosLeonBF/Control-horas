-- ============================================================
-- 0055 VACACIONES: una fila por persona y día de inicio
-- ------------------------------------------------------------
-- El flujo de Julián manda ya las fechas de cada ausencia ("Fecha inicio", "Fecha fin") en
-- sus pulsos. Con ellas, cada pulso apunta a un periodo concreto: el activar y el desactivar
-- de una misma ausencia son la MISMA fila (persona + día de inicio), lleguen en el orden que
-- lleguen, repetidos o a la vez. Este índice lo garantiza en la base: dos envíos simultáneos
-- no pueden crear dos filas del mismo periodo; el segundo falla, el flujo reintenta y ya ve
-- la fila.
--
-- Sigue el de una sola ausencia abierta (sin fecha de fin) por persona, que solo usan los
-- pulsos que llegan sin fechas.
-- ============================================================

create unique index if not exists vacaciones_persona_desde on public.vacaciones (slack_id, desde);

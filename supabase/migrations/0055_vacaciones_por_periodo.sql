-- ============================================================
-- 0055 VACACIONES: una fila por persona y día de inicio
-- ------------------------------------------------------------
-- Cada ausencia empieza el día de su activar, y una persona no puede tener dos que empiecen
-- el mismo día. Este índice lo garantiza en la base: si dos envíos a la vez de la misma
-- persona intentan dar de alta una ausencia, el segundo falla; la ruta vuelve a leer y a
-- planificar una vez, y ya ve la fila del primero.
--
-- (Se escribió para un modelo en que mandaban las fechas; se quedó con el interruptor de
-- activar/desactivar porque sigue siendo cierto y protege de las carreras.) Sigue el de una
-- sola ausencia encendida por persona.
-- ============================================================

create unique index if not exists vacaciones_persona_desde on public.vacaciones (slack_id, desde);

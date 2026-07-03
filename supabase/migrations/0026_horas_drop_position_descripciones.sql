-- 0026_horas_drop_position_descripciones.sql
-- La descripción ya no depende de la posición (0025 la movió a: texto libre en proyectos
-- cliente y por departamento en "Departamento"). Se elimina la tabla de vínculos
-- posición↔descripción, ya sin uso en el motor. El código que aún la leía
-- (getMyPositionDescripcionIds) ignora el error y devuelve [], así que no rompe la carga.
drop table if exists public.position_descripciones;

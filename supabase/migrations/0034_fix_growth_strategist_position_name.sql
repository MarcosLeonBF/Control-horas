-- ============================================================
-- 0034 HORAS: nombre canónico de la posición = "Growth Strategist" (sin s)
-- ------------------------------------------------------------
-- Bug: la semilla 0019 insertó la posición como "Growth Strategists" (plural),
-- pero el Excel (hojas BancoHoras y Horas_Provisionales) usa "Growth Strategist"
-- (singular). El banco de horas atribuye el consumo casando el nombre de la
-- posición del usuario (public.positions.name) contra la columna del Excel; con
-- la "s" de más NO casaban, así que las horas de los usuarios Growth Strategist
-- quedaban huérfanas (banco con asignado y 0 consumido; en el detalle salían
-- como dos posiciones distintas) y un manager de esa área ni veía su banco.
-- Fix: renombrar la posición a la forma canónica del Excel. Los perfiles
-- referencian la posición por id (FK), así que el rename los arrastra a todos.
-- ============================================================

update public.positions set name = 'Growth Strategist' where name = 'Growth Strategists';

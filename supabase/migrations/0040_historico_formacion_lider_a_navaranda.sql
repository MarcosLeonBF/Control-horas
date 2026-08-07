-- ============================================================
-- 0040 HISTÓRICO: "Formación Lider" pasa a "Oposiciones Navaranda"
-- ------------------------------------------------------------
-- Petición de negocio (Marcos, 2026-08-04): eran dos nombres para el mismo
-- proyecto y el histórico debe consolidarse bajo "Oposiciones Navaranda".
--
-- Afecta a 11 filas / 36,00 h, de 5 personas, meses 2026-04 a 2026-06, todas
-- de departamento "Clientes". En los registros vivos (time_log_lines) no hay
-- ninguna fila con ese proyecto, así que el cambio es solo del histórico.
--
-- CAVEAT CONOCIDO Y ACEPTADO: las 11 filas colisionan con una fila ya existente
-- de "Oposiciones Navaranda" (misma persona, mes y etapa) y en 8 de ellas las
-- horas coinciden al céntimo, lo que apunta a que el mismo trabajo se anotó bajo
-- los dos nombres. Se mueven igualmente, sin deduplicar: el consumo histórico de
-- Oposiciones Navaranda pasa de 125,50 h a 161,50 h. Decisión explícita a la
-- espera de que Marcos confirme si hay que descontar los duplicados.
--
-- OJO si se recarga el histórico: scripts/import-horas-historicas.mjs borra por
-- source y reinserta desde el origen. Si ese origen sigue diciendo "Formación
-- Lider", una recarga con --apply deshace esta migración.
-- ============================================================

update public.horas_historicas
   set project = 'Oposiciones Navaranda'
 where project = 'Formación Lider';

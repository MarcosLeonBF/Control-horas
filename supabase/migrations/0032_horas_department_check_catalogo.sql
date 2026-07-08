-- ============================================================
-- 0032 HORAS: el CHECK de department quedó obsoleto frente al catálogo
-- ------------------------------------------------------------
-- Bug (producción): guardar_registro fallaba con
-- "violates check constraint time_log_lines_department_check" para cualquier
-- línea cuyo department no fuera uno de los 4 nombres originales.
--
-- Causa raíz: 0007 creó time_log_lines.department con un CHECK fijo
-- ('Clientes','Ventas','Marketing','Todos'). En 0019 departamentos pasó a ser
-- catálogo editable y el admin añadió nuevos (Administración, RRHH, …), pero el
-- CHECK nunca se actualizó. Además el formulario rellena department en TODAS
-- las líneas (también las de proyecto cliente) con el primer departamento del
-- catálogo por orden alfabético, hoy "Administración" → todo guardado fallaba.
--
-- Fix: la validación real contra el catálogo ya la hace guardar_registro para
-- las líneas del proyecto "Departamento" (única vía de escritura: RPC security
-- definer, sin policies de insert). El CHECK fijo se reemplaza por no-vacío.
-- ============================================================

alter table public.time_log_lines drop constraint time_log_lines_department_check;
alter table public.time_log_lines add constraint time_log_lines_department_check
  check (length(btrim(department)) > 0);

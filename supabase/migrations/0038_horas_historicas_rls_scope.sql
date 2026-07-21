-- ============================================================
-- 0038 HORAS: alinear el alcance de horas_historicas con time_logs
-- ------------------------------------------------------------
-- La policy creada en 0037 dejaba ver TODA la tabla a cualquier manager, mientras
-- que time_logs acota al manager a su equipo (manager_sees_user). Hasta ahora no
-- expuso nada porque el banco lee con service role (que salta RLS), pero /reportes
-- lee con el cliente del usuario: al mostrar el histórico allí, un manager vería
-- registros de gente fuera de su alcance.
--
-- Se reutilizan los mismos helpers que time_logs para que horas_historicas siga
-- automáticamente cualquier cambio futuro de la regla de alcance.
-- ============================================================

drop policy horas_historicas_select on public.horas_historicas;

create policy horas_historicas_select on public.horas_historicas for select to authenticated using (
  user_id = auth.uid()
  or public.is_admin()
  or (public.current_role_app() = 'manager' and public.manager_sees_user(user_id))
);

-- 0018_horas_manager_scope.sql
-- Alcance del manager (PDF §15 "ver bancos/registros de su equipo o área", §17.6).
--
-- DEFINICIÓN (acordada con negocio):
--   El manager gestiona las ÁREAS que tiene asignadas en `user_areas` — las mismas
--   que administración le asigna desde el panel de usuarios. Su "equipo" son los
--   usuarios que comparten al menos un área con él. Para ampliar su visión a otras
--   áreas, administración simplemente le asigna más áreas en el panel.
--
-- Antes: manager veía TODO (role in manager/admin). Ahora: manager ve solo su equipo.
-- admin sigue viendo todo; el operativo sigue viendo solo lo suyo.

-- ¿El usuario actual gestiona al usuario objetivo?
-- (comparten al menos un área en user_areas). SECURITY DEFINER para no quedar
-- atado al RLS de user_areas dentro de las políticas y evitar recursión.
create or replace function public.manager_sees_user(p_target uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.user_areas ma
    join public.user_areas ta on ta.area_id = ma.area_id
    where ma.user_id = auth.uid()
      and ta.user_id = p_target
  );
$$;

-- time_logs: propios, admin (todo), o manager que gestiona al dueño del registro.
drop policy if exists time_logs_select on public.time_logs;
create policy time_logs_select on public.time_logs for select to authenticated using (
  user_id = auth.uid()
  or public.is_admin()
  or (public.current_role_app() = 'manager' and public.manager_sees_user(user_id))
);

-- time_log_lines: visibles si su registro padre es visible (mismas reglas).
drop policy if exists time_log_lines_select on public.time_log_lines;
create policy time_log_lines_select on public.time_log_lines for select to authenticated using (
  exists (
    select 1 from public.time_logs t
    where t.id = time_log_lines.log_id
      and (
        t.user_id = auth.uid()
        or public.is_admin()
        or (public.current_role_app() = 'manager' and public.manager_sees_user(t.user_id))
      )
  )
);

-- profiles: el manager necesita leer el nombre de los usuarios de su equipo
-- (vistas de equipo y reportes). Antes solo propio o admin.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or public.is_admin()
  or (public.current_role_app() = 'manager' and public.manager_sees_user(id))
);

-- 0036_manager_sees_user_por_posicion.sql
-- El equipo del manager sale de las POSICIONES (modelo 0028).
--
-- 0018 definía "mi equipo" como usuarios que comparten área en user_areas. Desde 0028
-- los operativos ya no tienen user_areas (pertenecen a áreas vía position_areas, por su
-- posición), así que el manager veía el equipo y sus registros vacíos.
--
-- Ahora: el manager ve al usuario objetivo si alguna de sus áreas de visibilidad
-- (user_areas, las que administración le asigna en el panel de usuarios) está entre
-- las áreas de la POSICIÓN del objetivo. Sin posición no hay pertenencia (el propio
-- registro y el admin ya están cubiertos en las políticas).
create or replace function public.manager_sees_user(p_target uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.user_areas ma
    join public.profiles tp on tp.id = p_target
    join public.position_areas ta
      on ta.position_id = tp.position_id
     and ta.area_id = ma.area_id
    where ma.user_id = auth.uid()
  );
$$;

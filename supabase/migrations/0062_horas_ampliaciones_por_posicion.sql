-- 0062_horas_ampliaciones_por_posicion.sql
-- Ampliaciones de horas POR POSICIÓN y managers que amplían
-- (spec docs/superpowers/specs/2026-10-15-ampliaciones-por-posicion-design.md).
--
-- 1. Toda ampliación es de una posición del banco (columna `position`, el nombre, como
--    `project`). La tabla está vacía en producción a 2026-10-15: no hay filas que rellenar,
--    así que la columna nace obligatoria.
-- 2. Ampliar lo puede el admin o el manager del proyecto. El manager del proyecto solo está
--    en el Excel (Clientes_Proyectos), que la base no conoce: lo comprueba la acción del
--    servidor, que después llama a ampliar_horas con service role diciendo quién amplía.
--    Por eso ampliar_horas deja de ser ejecutable por usuarios (ni authenticated, ni anon,
--    ni public, que Supabase concede por defecto). Aquí se revalida lo que la base sí sabe.
-- 3. Anular lo decide la base: el admin, cualquiera; el manager, solo las que creó él.

alter table public.horas_ampliaciones add column position text not null;
create index horas_ampliaciones_project_position_idx on public.horas_ampliaciones(project, position) where active;

drop function public.ampliar_horas(text, numeric, text, date);

create function public.ampliar_horas(
  p_actor      uuid,
  p_project    text,
  p_position   text,
  p_hours      numeric,
  p_reason     text,
  p_entry_date date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role   text;
  v_status text;
  v_name   text;
  v_id     uuid;
begin
  select role, status, full_name into v_role, v_status, v_name from public.profiles where id = p_actor;
  if v_role is null then raise exception 'no autorizado: usuario sin perfil'; end if;
  if v_status <> 'activo' then raise exception 'no autorizado: usuario inactivo'; end if;
  if v_role not in ('admin', 'manager') then raise exception 'no autorizado: solo admin o manager amplían horas'; end if;
  if coalesce(btrim(p_project), '') = '' then raise exception 'proyecto requerido'; end if;
  if not exists (select 1 from public.positions where name = btrim(coalesce(p_position, '')) and active) then
    raise exception 'posición inválida: %', p_position;
  end if;
  if coalesce(p_hours, 0) <= 0 then raise exception 'las horas deben ser > 0'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'el motivo es obligatorio'; end if;
  if coalesce(p_entry_date, current_date) > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;

  insert into public.horas_ampliaciones(project, position, hours, reason, entry_date, actor_name, created_by)
  values (btrim(p_project), btrim(p_position), p_hours, btrim(p_reason), coalesce(p_entry_date, current_date),
          coalesce(v_name, 'Admin'), p_actor)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.ampliar_horas(uuid, text, text, numeric, text, date) from public, anon, authenticated;
grant execute on function public.ampliar_horas(uuid, text, text, numeric, text, date) to service_role;

create or replace function public.anular_ampliacion_horas(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role   text;
  v_status text;
  v_autor  uuid;
begin
  select role, status into v_role, v_status from public.profiles where id = auth.uid();
  if v_role is null or v_status <> 'activo' then raise exception 'no autorizado'; end if;
  select created_by into v_autor from public.horas_ampliaciones where id = p_id;
  if v_role = 'admin' then
    null; -- el admin anula cualquiera
  elsif v_role = 'manager' and v_autor = auth.uid() then
    null; -- el manager, las suyas
  else
    raise exception 'no autorizado: solo un admin o quien la hizo puede anular';
  end if;
  update public.horas_ampliaciones
     set active = false, voided_at = now(), voided_by = auth.uid()
   where id = p_id and active;
end $$;

revoke execute on function public.anular_ampliacion_horas(uuid) from public, anon;
grant execute on function public.anular_ampliacion_horas(uuid) to authenticated;

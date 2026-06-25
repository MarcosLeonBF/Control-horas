-- 0010_horas_rpc_guardar_area_scope.sql
-- Adds per-line area-ownership validation, null-hours guard, removes dead v_count variable.
create or replace function public.guardar_registro_diario(
  p_log_id     uuid,
  p_entry_date date,
  p_lines      jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid          uuid := auth.uid();
  v_role         text;
  v_status       text;
  v_log          public.time_logs;
  v_total        numeric(6,2) := 0;
  v_line         jsonb;
  v_internal_area_id uuid;
begin
  select role, status into v_role, v_status from public.profiles where id = v_uid;
  if v_role is null then raise exception 'no autorizado: usuario sin perfil'; end if;
  if v_status <> 'activo' then raise exception 'no autorizado: usuario inactivo'; end if;

  -- Fecha: nunca futura; no-admin limitado a 7 días atrás.
  if p_entry_date > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;
  if v_role <> 'admin' and p_entry_date < current_date - 7 then
    raise exception 'fecha fuera de rango: máximo 7 días atrás';
  end if;

  -- Debe haber al menos una línea.
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'el registro necesita al menos una línea';
  end if;

  -- Sin líneas duplicadas (misma combinación proyecto+área+departamento+etapa).
  if exists (
    select 1 from (
      select e->>'project' p, e->>'area_id' a, e->>'department' d, e->>'etapa_id' et
      from jsonb_array_elements(p_lines) e
      group by 1,2,3,4 having count(*) > 1
    ) dup
  ) then raise exception 'hay líneas duplicadas'; end if;

  -- Resolver el área interna una vez (reutilizada en el loop).
  select id into v_internal_area_id from public.areas where is_internal = true;

  -- Crear o localizar el registro padre (solo propio salvo admin).
  if p_log_id is null then
    insert into public.time_logs(user_id, entry_date, status, created_by, updated_by)
      values (v_uid, p_entry_date, 'guardado', v_uid, v_uid) returning * into v_log;
  else
    select * into v_log from public.time_logs where id = p_log_id for update;
    if v_log.id is null then raise exception 'registro no encontrado'; end if;
    if v_log.user_id <> v_uid and v_role <> 'admin' then
      raise exception 'no autorizado: registro de otro usuario';
    end if;
    if v_log.status = 'anulado' then raise exception 'el registro está anulado'; end if;
    update public.time_logs set entry_date = p_entry_date, status = 'editado', updated_by = v_uid, updated_at = now()
      where id = v_log.id;
    delete from public.time_log_lines where log_id = v_log.id;
  end if;

  -- Insertar líneas validando cada una.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(btrim(v_line->>'project'),'') = '' then raise exception 'línea sin proyecto'; end if;
    if coalesce(btrim(v_line->>'description'),'') = '' then raise exception 'línea sin descripción'; end if;
    -- Null-guard: missing or null hours treated as 0.
    if coalesce((v_line->>'hours')::numeric, 0) <= 0 then raise exception 'horas deben ser > 0'; end if;

    -- Area-ownership validation.
    if btrim(v_line->>'project') = 'Departamento' then
      -- Departamento lines must use the internal area.
      if (v_line->>'area_id')::uuid <> v_internal_area_id then
        raise exception 'el proyecto Departamento debe usar el área interna';
      end if;
    else
      -- Client-project lines: area must be assigned to the log OWNER (not the actor).
      if not exists (
        select 1 from public.user_areas
        where user_id = v_log.user_id
          and area_id = (v_line->>'area_id')::uuid
      ) then
        raise exception 'área no asignada al usuario';
      end if;
    end if;

    insert into public.time_log_lines(log_id, project, area_id, department, etapa_id, hours, description, created_by, updated_by)
      values (
        v_log.id,
        btrim(v_line->>'project'),
        (v_line->>'area_id')::uuid,
        v_line->>'department',
        (v_line->>'etapa_id')::uuid,
        (v_line->>'hours')::numeric,
        btrim(v_line->>'description'),
        v_uid, v_uid
      );
    v_total := v_total + (v_line->>'hours')::numeric;
  end loop;

  update public.time_logs set total_hours = v_total where id = v_log.id;
  return v_log.id;
end $$;

grant execute on function public.guardar_registro_diario(uuid, date, jsonb) to authenticated;

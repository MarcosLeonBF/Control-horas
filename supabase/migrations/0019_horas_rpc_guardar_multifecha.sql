-- 0019_horas_rpc_guardar_multifecha.sql
-- Fecha por línea en el registro diario.
--
-- Antes (0017): un envío = una sola fecha (p_entry_date) = un time_log.
-- Ahora: cada línea lleva su propia 'entry_date'. El modelo NO cambia
-- (time_logs sigue siendo "uno por (usuario, día)"); el RPC agrupa las líneas
-- por fecha y las reparte en sus logs diarios.
--   · Alta: un time_log nuevo por cada fecha.
--   · Edición: el log "ancla" se reutiliza para el grupo de su fecha (o la más
--     antigua si esa fecha ya no está) y los demás grupos crean logs nuevos
--     (el registro se "divide" en varios días). Nunca quedan logs huérfanos.
-- La ventana de 7 días (no-admin) se valida POR LÍNEA. La auditoría (§7) escribe
-- un asiento por log afectado (crear/editar).

create or replace function public.guardar_registro(
  p_anchor_log_id uuid,
  p_lines         jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid              uuid := auth.uid();
  v_role             text;
  v_status           text;
  v_owner            uuid;            -- dueño de los registros (actor en alta; dueño del ancla en edición)
  v_anchor           public.time_logs;
  v_internal_area_id uuid;
  v_line             jsonb;
  v_date             date;
  v_dates            date[];
  v_anchor_date      date;           -- fecha del grupo que reutiliza el ancla
  v_log_id           uuid;
  v_ret_id           uuid;           -- id a devolver
  v_total            numeric(6,2);
begin
  select role, status into v_role, v_status from public.profiles where id = v_uid;
  if v_role is null then raise exception 'no autorizado: usuario sin perfil'; end if;
  if v_status <> 'activo' then raise exception 'no autorizado: usuario inactivo'; end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'el registro necesita al menos una línea';
  end if;

  select id into v_internal_area_id from public.areas where is_internal = true;
  if v_internal_area_id is null then raise exception 'configuración inválida: no existe un área interna (is_internal)'; end if;

  -- Dueño y, en edición, bloqueo/validación del log ancla.
  if p_anchor_log_id is null then
    v_owner := v_uid;
  else
    select * into v_anchor from public.time_logs where id = p_anchor_log_id for update;
    if v_anchor.id is null then raise exception 'registro no encontrado'; end if;
    if v_anchor.user_id <> v_uid and v_role <> 'admin' then
      raise exception 'no autorizado: registro de otro usuario';
    end if;
    if v_anchor.status = 'anulado' then raise exception 'el registro está anulado'; end if;
    v_owner := v_anchor.user_id;
  end if;

  -- VALIDACIÓN POR LÍNEA (todo antes de escribir; un fallo aborta el envío).
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_date := (v_line->>'entry_date')::date;
    if v_date is null then raise exception 'línea sin fecha'; end if;
    if v_date > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;
    if v_role <> 'admin' and v_date < current_date - 7 then
      raise exception 'fecha fuera de rango: máximo 7 días atrás';
    end if;
    if coalesce(btrim(v_line->>'project'),'') = '' then raise exception 'línea sin proyecto'; end if;
    if coalesce(btrim(v_line->>'description'),'') = '' then raise exception 'línea sin descripción'; end if;
    if coalesce((v_line->>'hours')::numeric, 0) <= 0 then raise exception 'horas deben ser > 0'; end if;

    if btrim(v_line->>'project') = 'Departamento' then
      if (v_line->>'area_id')::uuid <> v_internal_area_id then
        raise exception 'el proyecto Departamento debe usar el área interna';
      end if;
    else
      if (v_line->>'area_id')::uuid = v_internal_area_id then
        raise exception 'el área interna solo aplica al proyecto Departamento';
      end if;
      if v_role = 'operativo' and not exists (
        select 1 from public.user_areas
        where user_id = v_owner and area_id = (v_line->>'area_id')::uuid
      ) then
        raise exception 'área no asignada al usuario';
      end if;
    end if;
  end loop;

  -- Anti-duplicados: misma combinación EN LA MISMA FECHA (otras fechas no son duplicado).
  if exists (
    select 1 from (
      select e->>'entry_date' dt, e->>'project' p, e->>'area_id' a, e->>'department' d, e->>'etapa_id' et
      from jsonb_array_elements(p_lines) e
      group by 1,2,3,4,5 having count(*) > 1
    ) dup
  ) then raise exception 'hay líneas duplicadas'; end if;

  -- Fechas distintas (orden ascendente: la primera es la más antigua).
  select array_agg(d order by d) into v_dates
  from (select distinct (value->>'entry_date')::date d from jsonb_array_elements(p_lines)) s;

  -- En edición, elegir qué grupo reutiliza el ancla y limpiar sus líneas actuales.
  if p_anchor_log_id is not null then
    if v_anchor.entry_date = any(v_dates) then
      v_anchor_date := v_anchor.entry_date;
    else
      v_anchor_date := v_dates[1];  -- la más antigua
    end if;
    delete from public.time_log_lines where log_id = v_anchor.id;
  end if;

  -- Procesar cada grupo de fecha.
  foreach v_date in array v_dates loop
    if p_anchor_log_id is not null and v_date = v_anchor_date then
      -- Reutilizar el log ancla para este grupo.
      v_log_id := v_anchor.id;
      update public.time_logs
        set entry_date = v_date, status = 'editado', updated_by = v_uid, updated_at = now()
        where id = v_log_id;
    else
      -- Crear un log nuevo para este grupo de fecha.
      insert into public.time_logs(user_id, entry_date, status, created_by, updated_by)
        values (v_owner, v_date, 'guardado', v_uid, v_uid)
        returning id into v_log_id;
    end if;

    -- Insertar las líneas de esta fecha y recalcular su total.
    v_total := 0;
    for v_line in
      select value from jsonb_array_elements(p_lines)
      where (value->>'entry_date')::date = v_date
    loop
      insert into public.time_log_lines(log_id, project, area_id, department, etapa_id, hours, description, created_by, updated_by)
        values (
          v_log_id,
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

    update public.time_logs set total_hours = v_total where id = v_log_id;

    -- AUDITORÍA (§7): un asiento por log (editar el reutilizado, crear los nuevos).
    insert into public.time_log_audit(log_id, action, actor_id, actor_name, subject_name, entry_date, total_hours)
    values (
      v_log_id,
      case when (p_anchor_log_id is not null and v_log_id = v_anchor.id) then 'editar' else 'crear' end,
      v_uid,
      (select full_name from public.profiles where id = v_uid),
      (select full_name from public.profiles where id = v_owner),
      v_date,
      v_total
    );

    -- id a devolver: el ancla si existe; si no, el primero creado.
    if v_ret_id is null then v_ret_id := v_log_id; end if;
    if p_anchor_log_id is not null and v_log_id = v_anchor.id then v_ret_id := v_log_id; end if;
  end loop;

  return v_ret_id;
end $$;

grant execute on function public.guardar_registro(uuid, jsonb) to authenticated;

-- El antiguo RPC de fecha única queda obsoleto (solo lo llamaba la app).
drop function if exists public.guardar_registro_diario(uuid, date, jsonb);

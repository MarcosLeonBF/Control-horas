-- 0025_horas_descripcion_por_departamento.sql
-- Descripción por departamento + descripción libre en proyectos normales.
--
-- Cambio respecto a 0024:
--   · Antes: la descripción de cada línea debía pertenecer a la POSICIÓN del dueño
--     (position_descripciones), para todos los proyectos.
--   · Ahora: en el proyecto "Departamento", la descripción debe pertenecer al
--     DEPARTAMENTO de la línea (departamento_descripciones). En cualquier otro proyecto
--     la descripción es TEXTO LIBRE (solo se exige no vacía).
--
-- El resto del motor (fechas, duplicados, área, etapa, departamento) es idéntico a 0024.
-- La tabla position_descripciones se elimina en una migración posterior (0026), una vez
-- que el código deja de referenciarla, para no romper la carga del registro desplegado.

create table public.departamento_descripciones (
  id uuid primary key default gen_random_uuid(),
  departamento_id uuid not null references public.departamentos(id) on delete cascade,
  descripcion_id  uuid not null references public.descripciones(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (departamento_id, descripcion_id)
);
create index dep_descr_dep_idx   on public.departamento_descripciones(departamento_id);
create index dep_descr_descr_idx on public.departamento_descripciones(descripcion_id);
alter table public.departamento_descripciones enable row level security;
create policy dep_descr_select on public.departamento_descripciones for select to authenticated using (true);
create policy dep_descr_admin_write on public.departamento_descripciones for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.guardar_registro(
  p_anchor_log_id uuid,
  p_lines         jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid              uuid := auth.uid();
  v_role             text;
  v_status           text;
  v_owner            uuid;
  v_anchor           public.time_logs;
  v_internal_area_id uuid;
  v_line             jsonb;
  v_date             date;
  v_dates            date[];
  v_anchor_date      date;
  v_log_id           uuid;
  v_ret_id           uuid;
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
      -- Departamento ∈ posición del dueño (todos los roles).
      if not exists (
        select 1
        from public.profiles pr
        join public.position_departamentos pd on pd.position_id = pr.position_id
        join public.departamentos dep on dep.id = pd.departamento_id
        where pr.id = v_owner
          and dep.name = btrim(v_line->>'department')
      ) then
        raise exception 'departamento no permitido para la posición del usuario';
      end if;
      -- Descripción ∈ descripciones del departamento de la línea.
      if not exists (
        select 1
        from public.departamentos dep
        join public.departamento_descripciones dd on dd.departamento_id = dep.id
        join public.descripciones d on d.id = dd.descripcion_id
        where dep.name = btrim(v_line->>'department')
          and d.name = btrim(v_line->>'description')
      ) then
        raise exception 'descripción no permitida para el departamento';
      end if;
    else
      if (v_line->>'area_id')::uuid = v_internal_area_id then
        raise exception 'el área interna solo aplica al proyecto Departamento';
      end if;
      -- Área ∈ áreas asignadas al dueño (todos los roles).
      if not exists (
        select 1 from public.user_areas
        where user_id = v_owner and area_id = (v_line->>'area_id')::uuid
      ) then
        raise exception 'área no asignada al usuario';
      end if;
      -- Etapa (si viene) ∈ posición del dueño (todos los roles).
      if coalesce(v_line->>'etapa_id','') <> '' and not exists (
        select 1 from public.position_etapas pe
        join public.profiles pr on pr.position_id = pe.position_id
        where pr.id = v_owner and pe.etapa_id = (v_line->>'etapa_id')::uuid
      ) then
        raise exception 'etapa no permitida para la posición del usuario';
      end if;
      -- Descripción: TEXTO LIBRE en proyecto cliente (solo no vacía, ya validado arriba).
    end if;
  end loop;

  if exists (
    select 1 from (
      select e->>'entry_date' dt, e->>'project' p, e->>'area_id' a, e->>'department' d, e->>'etapa_id' et
      from jsonb_array_elements(p_lines) e
      group by 1,2,3,4,5 having count(*) > 1
    ) dup
  ) then raise exception 'hay líneas duplicadas'; end if;

  select array_agg(d order by d) into v_dates
  from (select distinct (value->>'entry_date')::date d from jsonb_array_elements(p_lines)) s;

  if p_anchor_log_id is not null then
    if v_anchor.entry_date = any(v_dates) then
      v_anchor_date := v_anchor.entry_date;
    else
      v_anchor_date := v_dates[1];
    end if;
    delete from public.time_log_lines where log_id = v_anchor.id;
  end if;

  foreach v_date in array v_dates loop
    if p_anchor_log_id is not null and v_date = v_anchor_date then
      v_log_id := v_anchor.id;
      update public.time_logs
        set entry_date = v_date, status = 'editado', updated_by = v_uid, updated_at = now()
        where id = v_log_id;
    else
      insert into public.time_logs(user_id, entry_date, status, created_by, updated_by)
        values (v_owner, v_date, 'guardado', v_uid, v_uid)
        returning id into v_log_id;
    end if;

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

    if v_ret_id is null then v_ret_id := v_log_id; end if;
    if p_anchor_log_id is not null and v_log_id = v_anchor.id then v_ret_id := v_log_id; end if;
  end loop;

  return v_ret_id;
end $$;

grant execute on function public.guardar_registro(uuid, jsonb) to authenticated;

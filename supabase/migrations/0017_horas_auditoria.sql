-- 0017_horas_auditoria.sql
-- Auditoría de registros (PDF §7: "toda corrección debe quedar registrada en
-- auditoría"). Se puebla DENTRO de los RPC (atómico con el cambio): crear,
-- editar y anular. Self-contained (guarda nombres) para una vista simple.
create table public.time_log_audit (
  id           uuid primary key default gen_random_uuid(),
  log_id       uuid references public.time_logs(id) on delete set null,
  action       text not null check (action in ('crear','editar','anular')),
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text, -- quién hizo el cambio
  subject_name text, -- de quién es el registro
  entry_date   date,
  total_hours  numeric(6,2),
  at           timestamptz not null default now()
);
create index time_log_audit_log_idx on public.time_log_audit(log_id);
create index time_log_audit_at_idx on public.time_log_audit(at desc);

alter table public.time_log_audit enable row level security;
create policy time_log_audit_select on public.time_log_audit for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
);

-- guardar_registro_diario (= 0013) + asiento de auditoría crear/editar.
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

  if p_entry_date > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;
  if v_role <> 'admin' and p_entry_date < current_date - 7 then
    raise exception 'fecha fuera de rango: máximo 7 días atrás';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'el registro necesita al menos una línea';
  end if;

  if exists (
    select 1 from (
      select e->>'project' p, e->>'area_id' a, e->>'department' d, e->>'etapa_id' et
      from jsonb_array_elements(p_lines) e
      group by 1,2,3,4 having count(*) > 1
    ) dup
  ) then raise exception 'hay líneas duplicadas'; end if;

  select id into v_internal_area_id from public.areas where is_internal = true;
  if v_internal_area_id is null then raise exception 'configuración inválida: no existe un área interna (is_internal)'; end if;

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

  for v_line in select * from jsonb_array_elements(p_lines) loop
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

  -- AUDITORÍA (§7)
  insert into public.time_log_audit(log_id, action, actor_id, actor_name, subject_name, entry_date, total_hours)
  values (
    v_log.id,
    case when p_log_id is null then 'crear' else 'editar' end,
    v_uid,
    (select full_name from public.profiles where id = v_uid),
    (select full_name from public.profiles where id = v_log.user_id),
    p_entry_date,
    v_total
  );

  return v_log.id;
end $$;

-- anular_registro_diario (= 0009) + asiento de auditoría anular.
create or replace function public.anular_registro_diario(p_log_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_log  public.time_logs;
begin
  select role into v_role from public.profiles where id = v_uid;
  if v_role is null then raise exception 'no autorizado'; end if;

  select * into v_log from public.time_logs where id = p_log_id for update;
  if v_log.id is null then raise exception 'registro no encontrado'; end if;
  if v_log.user_id <> v_uid and v_role <> 'admin' then raise exception 'no autorizado: registro de otro usuario'; end if;
  if v_role <> 'admin' and v_log.entry_date < current_date - 7 then
    raise exception 'fuera de rango: solo admin puede anular registros de más de 7 días';
  end if;

  update public.time_logs set status = 'anulado', updated_by = v_uid, updated_at = now() where id = p_log_id;

  insert into public.time_log_audit(log_id, action, actor_id, actor_name, subject_name, entry_date, total_hours)
  values (p_log_id, 'anular', v_uid,
    (select full_name from public.profiles where id = v_uid),
    (select full_name from public.profiles where id = v_log.user_id),
    v_log.entry_date, v_log.total_hours);
end $$;

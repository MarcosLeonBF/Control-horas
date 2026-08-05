-- ============================================================
-- 0041 HORAS: detalle del cambio en la auditoría (antes/después)
-- ------------------------------------------------------------
-- time_log_audit decía QUE algo pasó, no QUÉ cambió: tras una edición no había
-- forma de saber qué línea se tocó. Se añaden dos snapshots jsonb que se rellenan
-- dentro de los RPC, en la misma transacción que ya escribe el asiento.
--
-- Los snapshots guardan NOMBRES ya resueltos (área, etapa), no ids, por la misma
-- razón por la que la tabla ya guarda actor_name: el asiento debe leerse igual
-- dentro de un año aunque se renombre un área. Si un área se renombra, los
-- asientos viejos muestran el nombre viejo — que es lo correcto en una auditoría.
--
-- Los asientos anteriores a esta migración se quedan con ambas columnas a NULL:
-- las líneas viejas se borraron al editar y no hay nada que reconstruir. La UI
-- distingue ese caso (before y after ambos null) y lo rotula.
--
-- Cambios sobre la definición viva de guardar_registro (0039):
--   * declaraciones v_before / v_after
--   * snapshot del "antes" justo antes del delete de las líneas del ancla
--   * snapshot del "después" tras fijar total_hours de cada log
--   * el insert de auditoría pasa a llevar lines_before / lines_after
-- El resto (validaciones, dedup, split por fecha, ventana de julio) = 0039 sin tocar.
-- ============================================================

alter table public.time_log_audit
  add column if not exists lines_before jsonb,
  add column if not exists lines_after  jsonb;

comment on column public.time_log_audit.lines_before is
  'Líneas del registro ANTES del cambio (nombres resueltos). NULL en crear y en asientos previos a 0041.';
comment on column public.time_log_audit.lines_after is
  'Líneas del registro DESPUÉS del cambio (nombres resueltos). NULL en anular y en asientos previos a 0041.';

-- Índices para lo que la pantalla nueva sí consulta: rango por fecha del registro
-- y "qué ha tocado esta persona" en orden cronológico.
create index if not exists time_log_audit_entry_date_idx on public.time_log_audit(entry_date);
create index if not exists time_log_audit_actor_idx      on public.time_log_audit(actor_id, at desc);

-- Snapshot de las líneas vivas de un log, con área y etapa resueltas a nombre.
-- Orden estable (proyecto, luego descripción) para que dos snapshots del mismo
-- contenido se comparen sin ruido de ordenación.
--
-- SECURITY INVOKER a propósito: se llama desde dentro de los RPC, que son SECURITY
-- DEFINER, así que ahí ya corre con los privilegios del owner. Dejarla invoker evita
-- crear un atajo para leer líneas de cualquier registro; el revoke de abajo cierra
-- la puerta a llamarla suelta desde PostgREST.
create or replace function public.audit_snapshot_lineas(p_log_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'project',     l.project,
        'area',        coalesce(a.name, '—'),
        'department',  coalesce(l.department, '—'),
        'etapa',       coalesce(e.name, '—'),
        'hours',       l.hours,
        'description', coalesce(l.description, '')
      )
      order by l.project, coalesce(l.description, '')
    ),
    '[]'::jsonb
  )
  from public.time_log_lines l
  left join public.areas  a on a.id = l.area_id
  left join public.etapas e on e.id = l.etapa_id
  where l.log_id = p_log_id;
$$;

revoke all on function public.audit_snapshot_lineas(uuid) from public;

-- guardar_registro (= 0039) + snapshots antes/después (0041).
create or replace function public.guardar_registro(p_anchor_log_id uuid, p_lines jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_min_date         date;           -- piso mínimo de fecha para no-admin (0039)
  v_anchor_date      date;
  v_log_id           uuid;
  v_ret_id           uuid;
  v_total            numeric(6,2);
  v_before           jsonb;          -- snapshot del ancla ANTES de borrar sus líneas (0041)
  v_after            jsonb;          -- snapshot del log recién escrito (0041)
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

  -- Piso mínimo de registro (no-admin): normal 7 días; en julio 2026, desde el 01/07.
  v_min_date := current_date - 7;
  if current_date <= date '2026-07-31' then
    v_min_date := least(v_min_date, date '2026-07-01');
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_date := (v_line->>'entry_date')::date;
    if v_date is null then raise exception 'línea sin fecha'; end if;
    if v_date > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;
    if v_role <> 'admin' and v_date < v_min_date then
      raise exception 'fecha fuera de rango: %',
        case when current_date <= date '2026-07-31'
             then 'en julio se registra desde el 01/07'
             else 'máximo 7 días atrás' end;
    end if;
    if coalesce(btrim(v_line->>'project'),'') = '' then raise exception 'línea sin proyecto'; end if;
    if coalesce(btrim(v_line->>'description'),'') = '' then raise exception 'línea sin descripción'; end if;
    if coalesce((v_line->>'hours')::numeric, 0) <= 0 then raise exception 'horas deben ser > 0'; end if;

    if btrim(v_line->>'project') = 'Departamento' then
      if (v_line->>'area_id')::uuid <> v_internal_area_id then
        raise exception 'el proyecto Departamento debe usar el área interna';
      end if;
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
      if not exists (
        select 1 from public.descripciones d
        where d.active and d.name = btrim(v_line->>'description')
      ) then
        raise exception 'descripción no permitida';
      end if;
    else
      if (v_line->>'area_id')::uuid = v_internal_area_id then
        raise exception 'el área interna solo aplica al proyecto Departamento';
      end if;
      -- Área ∈ áreas de la POSICIÓN del dueño (todos los roles).
      if not exists (
        select 1 from public.position_areas pa
        join public.profiles pr on pr.position_id = pa.position_id
        where pr.id = v_owner and pa.area_id = (v_line->>'area_id')::uuid
      ) then
        raise exception 'área no permitida para la posición del usuario';
      end if;
      if coalesce(v_line->>'etapa_id','') <> '' and not exists (
        select 1 from public.position_etapas pe
        join public.profiles pr on pr.position_id = pe.position_id
        where pr.id = v_owner and pe.etapa_id = (v_line->>'etapa_id')::uuid
      ) then
        raise exception 'etapa no permitida para la posición del usuario';
      end if;
    end if;
  end loop;

  -- Duplicados: dos líneas idénticas en fecha+proyecto+área+departamento+etapa+DESCRIPCIÓN.
  -- El department se normaliza igual que en el insert (líneas de proyecto cliente
  -- cuentan como 'Clientes') para que el relleno del cliente no separe duplicados.
  if exists (
    select 1 from (
      select e->>'entry_date' dt, e->>'project' p, e->>'area_id' a,
             case when btrim(e->>'project') = 'Departamento' then e->>'department' else 'Clientes' end d,
             e->>'etapa_id' et, btrim(e->>'description') ds
      from jsonb_array_elements(p_lines) e
      group by 1,2,3,4,5,6 having count(*) > 1
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
    -- El "antes" se toma AQUÍ: el delete de la línea siguiente es destructivo y
    -- después ya no hay nada que fotografiar.
    v_before := public.audit_snapshot_lineas(v_anchor.id);
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
          case when btrim(v_line->>'project') = 'Departamento' then v_line->>'department' else 'Clientes' end,
          (v_line->>'etapa_id')::uuid,
          (v_line->>'hours')::numeric,
          btrim(v_line->>'description'),
          v_uid, v_uid
        );
      v_total := v_total + (v_line->>'hours')::numeric;
    end loop;

    update public.time_logs set total_hours = v_total where id = v_log_id;

    v_after := public.audit_snapshot_lineas(v_log_id);

    insert into public.time_log_audit(log_id, action, actor_id, actor_name, subject_name, entry_date, total_hours, lines_before, lines_after)
    values (
      v_log_id,
      case when (p_anchor_log_id is not null and v_log_id = v_anchor.id) then 'editar' else 'crear' end,
      v_uid,
      (select full_name from public.profiles where id = v_uid),
      (select full_name from public.profiles where id = v_owner),
      v_date,
      v_total,
      -- En un guardado multi-fecha solo el ancla es una edición: las demás fechas
      -- son logs nuevos y no tienen un "antes".
      case when (p_anchor_log_id is not null and v_log_id = v_anchor.id) then v_before else null end,
      v_after
    );

    if v_ret_id is null then v_ret_id := v_log_id; end if;
    if p_anchor_log_id is not null and v_log_id = v_anchor.id then v_ret_id := v_log_id; end if;
  end loop;

  return v_ret_id;
end $function$;

-- anular_registro_diario (= 0017) + snapshot del "antes" (0041).
create or replace function public.anular_registro_diario(p_log_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_log    public.time_logs;
  v_before jsonb;
begin
  select role into v_role from public.profiles where id = v_uid;
  if v_role is null then raise exception 'no autorizado'; end if;

  select * into v_log from public.time_logs where id = p_log_id for update;
  if v_log.id is null then raise exception 'registro no encontrado'; end if;
  if v_log.user_id <> v_uid and v_role <> 'admin' then raise exception 'no autorizado: registro de otro usuario'; end if;
  if v_role <> 'admin' and v_log.entry_date < current_date - 7 then
    raise exception 'fuera de rango: solo admin puede anular registros de más de 7 días';
  end if;

  -- Las líneas no se borran al anular (el registro queda marcado), pero el snapshot
  -- se toma igualmente: deja constancia de qué se estaba anulando aunque el registro
  -- se edite o se purgue después.
  v_before := public.audit_snapshot_lineas(p_log_id);

  update public.time_logs set status = 'anulado', updated_by = v_uid, updated_at = now() where id = p_log_id;

  insert into public.time_log_audit(log_id, action, actor_id, actor_name, subject_name, entry_date, total_hours, lines_before, lines_after)
  values (p_log_id, 'anular', v_uid,
    (select full_name from public.profiles where id = v_uid),
    (select full_name from public.profiles where id = v_log.user_id),
    v_log.entry_date, v_log.total_hours, v_before, null);
end $$;

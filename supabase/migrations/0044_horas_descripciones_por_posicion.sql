-- ============================================================
-- 0044 HORAS: descripciones específicas por posición
-- ------------------------------------------------------------
-- Las descripciones del proyecto "Departamento" son hoy una lista general que ve
-- todo el mundo (0027). Se añaden descripciones ESPECÍFICAS, visibles solo para las
-- posiciones a las que se asignan; las generales siguen siendo el caso por defecto.
--
-- Esto ya existió y se quitó: la 0022 hizo que la descripción dependiera SIEMPRE de
-- la posición y la 0026 borró la tabla de vínculos. La diferencia ahora es que lo
-- general no desaparece: cada descripción declara su alcance a mano, y sin marcarla
-- nada cambia. Por eso `alcance` tiene default 'general': al aplicar esta migración
-- todas las descripciones existentes siguen viéndose exactamente igual.
--
-- Alcance del cambio: SOLO el proyecto interno "Departamento", que es donde la
-- descripción sale de un catálogo. En los proyectos de cliente sigue siendo texto
-- libre, sin tocar.
--
-- Cambios sobre la definición viva (0043): solo el bloque que valida la descripción
-- del proyecto "Departamento". El resto (fechas y ventana por usuario, áreas, etapas,
-- departamentos, dedup, split por fecha, snapshots de auditoría) = 0043 sin tocar.
-- anular_registro_diario no se redefine: esta migración no lo afecta.
-- ============================================================

alter table public.descripciones
  add column if not exists alcance text not null default 'general';

alter table public.descripciones
  drop constraint if exists descripciones_alcance_check;
alter table public.descripciones
  add constraint descripciones_alcance_check check (alcance in ('general', 'posicion'));

comment on column public.descripciones.alcance is
  'general = la ve cualquiera al registrar en "Departamento". posicion = solo las posiciones de position_descripciones. Se marca a mano desde /admin/catalogos.';

-- Libertad de descripción en "Departamento", por posición. Con el flag puesto, quien
-- tenga esa posición puede escribir una descripción a mano en "Departamento" en vez de
-- elegirla del catálogo; sin él, sigue obligado a la lista. Es un permiso que se
-- enciende y se apaga, como el de los días de registro (0043), y por defecto está
-- apagado: al aplicar esta migración nadie gana libertad que no tuviera.
--
-- Los proyectos de cliente no dependen de esto: ahí la descripción siempre es libre.
alter table public.positions
  add column if not exists descripcion_libre boolean not null default false;

comment on column public.positions.descripcion_libre is
  'true = quien tenga esta posición puede escribir la descripción a mano en el proyecto "Departamento", además de elegirla del catálogo. Lo activa el admin en /admin/catalogos → Posiciones.';

-- posición ↔ descripción (N:N). Misma forma y mismas RLS que position_etapas: la
-- lectura es abierta a autenticados (es catálogo) y la escritura solo admin.
create table if not exists public.position_descripciones (
  id             uuid primary key default gen_random_uuid(),
  position_id    uuid not null references public.positions(id)     on delete cascade,
  descripcion_id uuid not null references public.descripciones(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (position_id, descripcion_id)
);
create index if not exists position_descripciones_position_idx    on public.position_descripciones(position_id);
create index if not exists position_descripciones_descripcion_idx on public.position_descripciones(descripcion_id);

alter table public.position_descripciones enable row level security;
drop policy if exists position_descripciones_select      on public.position_descripciones;
drop policy if exists position_descripciones_admin_write on public.position_descripciones;
create policy position_descripciones_select on public.position_descripciones
  for select to authenticated using (true);
create policy position_descripciones_admin_write on public.position_descripciones
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- guardar_registro (= 0043) + descripción por alcance (0044).
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
  v_dias_atras       integer;        -- permiso ampliado del actor; null = 7 (0043)
  v_desc_libre       boolean;        -- la posición del dueño puede escribir descripción libre (0044)
  v_owner            uuid;
  v_anchor           public.time_logs;
  v_internal_area_id uuid;
  v_line             jsonb;
  v_date             date;
  v_dates            date[];
  v_min_date         date;           -- piso mínimo de fecha para no-admin
  v_anchor_date      date;
  v_log_id           uuid;
  v_ret_id           uuid;
  v_total            numeric(6,2);
  v_before           jsonb;          -- snapshot del ancla ANTES de borrar sus líneas (0041)
  v_after            jsonb;          -- snapshot del log recién escrito (0041)
begin
  select role, status, registro_dias_atras
    into v_role, v_status, v_dias_atras
    from public.profiles where id = v_uid;
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

  -- Piso mínimo de registro (no-admin): 7 días, o los que tenga concedidos el actor.
  v_dias_atras := coalesce(v_dias_atras, 7);
  v_min_date := current_date - v_dias_atras;

  -- Libertad de descripción de la POSICIÓN DEL DUEÑO (0044). Se resuelve una vez, fuera
  -- del bucle: es la misma para todas las líneas del guardado. Sin posición, sin libertad.
  select coalesce(pos.descripcion_libre, false) into v_desc_libre
  from public.profiles pr
  left join public.positions pos on pos.id = pr.position_id
  where pr.id = v_owner;
  v_desc_libre := coalesce(v_desc_libre, false);

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_date := (v_line->>'entry_date')::date;
    if v_date is null then raise exception 'línea sin fecha'; end if;
    if v_date > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;
    if v_role <> 'admin' and v_date < v_min_date then
      raise exception 'fecha fuera de rango: máximo % días atrás', v_dias_atras;
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
      -- Descripción del proyecto "Departamento": del catálogo activo, y o bien general
      -- (la ve cualquiera) o bien específica asignada a la posición del DUEÑO del
      -- registro —el mismo criterio con el que ya se validan área, etapa y
      -- departamento, no el de quien está tecleando (0044).
      --
      -- Si la posición del dueño tiene libertad de descripción, esta comprobación no
      -- corre: basta con que no esté vacía, que ya se exigió más arriba. La libertad
      -- AÑADE, no sustituye: quien la tiene puede seguir eligiendo del catálogo.
      if not v_desc_libre and not exists (
        select 1 from public.descripciones d
        where d.active
          and d.name = btrim(v_line->>'description')
          and (
            d.alcance = 'general'
            or exists (
              select 1
              from public.position_descripciones pd
              join public.profiles pr on pr.position_id = pd.position_id
              where pd.descripcion_id = d.id and pr.id = v_owner
            )
          )
      ) then
        raise exception 'descripción no permitida para la posición del usuario';
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

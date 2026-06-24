-- ============================================================
-- 0003 Motor de ledger HUCHA
-- ============================================================

create or replace function public.registrar_movimiento_hucha(
  p_project_id uuid,
  p_type text,
  p_amount numeric,
  p_description text default null,
  p_reference text default null,
  p_reason text default null,
  p_entry_date date default current_date,
  p_corrects_movement_id uuid default null
) returns public.hucha_movements
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_active text;
  v_name   text;
  v_bank   public.hucha_banks;
  v_signed numeric(14,2);
  v_before numeric(14,2);
  v_after  numeric(14,2);
  v_new_assigned numeric(14,2);
  v_new_consumed numeric(14,2);
  v_orig   public.hucha_movements;
  v_mov    public.hucha_movements;
begin
  -- Usuario y rol
  select role, status, full_name into v_role, v_active, v_name
    from public.profiles where id = v_uid;
  if v_role is null then raise exception 'no autorizado: usuario sin perfil'; end if;
  if v_active <> 'activo' then raise exception 'no autorizado: usuario inactivo'; end if;

  -- Validaciones comunes
  if p_amount is null or p_amount <= 0 then raise exception 'monto inválido: debe ser > 0'; end if;
  if p_entry_date > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;

  -- Bloquear el banco del proyecto
  select * into v_bank from public.hucha_banks
    where project_id = p_project_id for update;
  if v_bank.id is null then raise exception 'el proyecto no tiene banco HUCHA'; end if;

  -- Autorización + cálculo por tipo
  if p_type = 'consumo' then
    if v_role <> 'admin' and not exists (
        select 1 from public.project_assignments
        where project_id = p_project_id and user_id = v_uid)
    then raise exception 'no autorizado: sin asignación al proyecto'; end if;
    if coalesce(btrim(p_description),'') = '' then raise exception 'descripción obligatoria'; end if;
    v_signed := -p_amount;
    v_new_assigned := v_bank.assigned_total;
    v_new_consumed := v_bank.consumed_total + p_amount;

  elsif p_type = 'ampliacion' then
    if v_role <> 'admin' then raise exception 'no autorizado: solo admin amplía'; end if;
    if coalesce(btrim(p_reason),'') = '' then raise exception 'motivo obligatorio'; end if;
    v_signed := p_amount;
    v_new_assigned := v_bank.assigned_total + p_amount;
    v_new_consumed := v_bank.consumed_total;

  elsif p_type = 'anulacion' then
    if v_role <> 'admin' then raise exception 'no autorizado: solo admin anula'; end if;
    if p_corrects_movement_id is null then raise exception 'anulacion requiere movimiento a revertir'; end if;
    select * into v_orig from public.hucha_movements
      where id = p_corrects_movement_id and bank_id = v_bank.id;
    if v_orig.id is null then raise exception 'movimiento a anular no encontrado'; end if;
    -- revertir el efecto del original
    v_signed := -v_orig.amount;   -- si original fue consumo (-X) revierte +X; si ampliacion (+X) revierte -X
    if v_orig.type = 'consumo' then
      v_new_assigned := v_bank.assigned_total;
      v_new_consumed := v_bank.consumed_total + v_orig.amount;  -- amount es negativo → reduce consumido
    else
      v_new_assigned := v_bank.assigned_total - v_orig.amount;  -- amount positivo → reduce asignado
      v_new_consumed := v_bank.consumed_total;
    end if;

  else
    raise exception 'tipo de movimiento no soportado: %', p_type;
  end if;

  v_before := v_bank.remaining;
  v_after  := v_new_assigned - v_new_consumed;

  -- Insertar movimiento inmutable
  insert into public.hucha_movements (
    bank_id, type, amount, balance_before, balance_after,
    description, reference, reason, actor_id, actor_name,
    entry_date, corrects_movement_id)
  values (
    v_bank.id, p_type, v_signed, v_before, v_after,
    p_description, p_reference, p_reason, v_uid, coalesce(v_name,''),
    p_entry_date, p_corrects_movement_id)
  returning * into v_mov;

  -- Actualizar caches del banco
  update public.hucha_banks set
    assigned_total = v_new_assigned,
    consumed_total = v_new_consumed,
    remaining      = v_after,
    status         = public.compute_hucha_status(v_new_assigned, v_new_consumed),
    updated_at     = now()
  where id = v_bank.id;

  return v_mov;
end $$;

-- Permitir que los usuarios autenticados ejecuten la función (la autorización es interna)
grant execute on function public.registrar_movimiento_hucha(uuid,text,numeric,text,text,text,date,uuid) to authenticated;

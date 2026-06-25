-- 0009_horas_rpc_anular.sql
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
end $$;

grant execute on function public.anular_registro_diario(uuid) to authenticated;

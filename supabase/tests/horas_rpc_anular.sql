do $$
declare v_op uuid; v_area uuid; v_etapa uuid; v_log uuid;
begin
  select id into v_op from public.profiles where role='operativo' and status='activo' limit 1;
  if v_op is null then raise notice 'SKIP: no hay operativo'; return; end if;
  select id into v_area from public.areas where name='CRM';
  select id into v_etapa from public.etapas where name='Setup';
  perform set_config('request.jwt.claims', json_build_object('sub', v_op::text,'role','authenticated')::text, true);
  v_log := public.guardar_registro_diario(null, current_date,
    jsonb_build_array(jsonb_build_object('project','C','area_id',v_area,'department','Clientes','etapa_id',v_etapa,'hours',1,'description','d')));
  perform public.anular_registro_diario(v_log);
  if (select status from public.time_logs where id=v_log) <> 'anulado' then raise exception 'no anuló'; end if;
  delete from public.time_logs where id = v_log;
  raise notice 'OK rpc anular';
end $$;

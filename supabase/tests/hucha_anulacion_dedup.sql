do $$
declare v_admin uuid := '1de8f167-ca74-49eb-a2b7-3273b63e8c2b'; v_proj uuid; v_consumo uuid; ok bool;
begin
  insert into public.projects(name) values ('Anular Dedup Test') returning id into v_proj;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);

  perform public.registrar_movimiento_hucha(v_proj, 'ampliacion', 1000, null, null, 'fondeo', current_date, null);
  select id into v_consumo from public.registrar_movimiento_hucha(v_proj, 'consumo', 200, 'gasto', null, null, current_date, null);

  -- primera anulación: OK, restaura el restante
  perform public.registrar_movimiento_hucha(v_proj, 'anulacion', 200, null, null, null, current_date, v_consumo);
  if (select remaining from public.hucha_banks where project_id = v_proj) <> 1000 then
    raise exception 'la anulación no restauró el restante';
  end if;

  -- segunda anulación del mismo consumo: rechazada
  ok := true;
  begin perform public.registrar_movimiento_hucha(v_proj, 'anulacion', 200, null, null, null, current_date, v_consumo); ok := false;
  exception when others then null; end;
  if not ok then raise exception 'la doble anulación no fue rechazada'; end if;

  delete from public.projects where id = v_proj;  -- cascade borra banco + movimientos
  raise notice 'OK anulacion dedup';
end $$;

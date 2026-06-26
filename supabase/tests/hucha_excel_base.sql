do $$
declare v_proj uuid; v_bank uuid;
begin
  insert into public.projects(name) values ('Sync Test 3a') returning id into v_proj;
  select id into v_bank from public.hucha_banks where project_id = v_proj;

  -- base inicial 1000 -> disponible
  perform public.set_hucha_excel_base(v_bank, 1000);
  if (select assigned_total from public.hucha_banks where id=v_bank) <> 1000 then raise exception 'assigned != 1000'; end if;
  if (select remaining from public.hucha_banks where id=v_bank) <> 1000 then raise exception 'remaining != 1000'; end if;
  if (select status from public.hucha_banks where id=v_bank) <> 'disponible' then raise exception 'status != disponible'; end if;

  -- simular consumo previo (cache) y re-sincronizar la base a 1500 -> delta +500
  update public.hucha_banks set consumed_total = 200, remaining = assigned_total - 200,
    status = public.compute_hucha_status(assigned_total, 200) where id = v_bank;
  perform public.set_hucha_excel_base(v_bank, 1500);
  if (select assigned_total from public.hucha_banks where id=v_bank) <> 1500 then raise exception 'assigned != 1500'; end if;
  if (select remaining from public.hucha_banks where id=v_bank) <> 1300 then raise exception 'remaining != 1300'; end if;

  -- re-sync al mismo valor no cambia nada (delta 0)
  perform public.set_hucha_excel_base(v_bank, 1500);
  if (select remaining from public.hucha_banks where id=v_bank) <> 1300 then raise exception 'delta 0 alteró saldo'; end if;

  delete from public.projects where id = v_proj;  -- cascade borra banco
  raise notice 'OK hucha excel base';
end $$;

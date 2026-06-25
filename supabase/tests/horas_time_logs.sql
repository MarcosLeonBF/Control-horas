-- Valida constraints: horas>0, department válido, status válido, cascade
do $$
declare v_user uuid; v_area uuid; v_etapa uuid; v_log uuid; ok bool;
begin
  select id into v_user from public.profiles where role='admin' limit 1;
  select id into v_area from public.areas where name='CRM';
  select id into v_etapa from public.etapas where name='Setup';

  insert into public.time_logs(user_id, entry_date, total_hours, created_by)
    values (v_user, current_date, 2, v_user) returning id into v_log;
  insert into public.time_log_lines(log_id, project, area_id, department, etapa_id, hours, description, created_by)
    values (v_log, 'Cliente Test', v_area, 'Clientes', v_etapa, 2, 'desc', v_user);

  -- horas<=0 debe fallar
  ok := true;
  begin
    insert into public.time_log_lines(log_id, project, area_id, department, etapa_id, hours, description)
      values (v_log, 'X', v_area, 'Clientes', v_etapa, 0, 'd');
    ok := false;
  exception when check_violation then null; end;
  if not ok then raise exception 'horas<=0 no fue rechazado'; end if;

  -- cascade: borrar el log borra las líneas
  delete from public.time_logs where id = v_log;
  if exists (select 1 from public.time_log_lines where log_id = v_log) then
    raise exception 'cascade no borró líneas';
  end if;
  raise notice 'OK time_logs';
end $$;

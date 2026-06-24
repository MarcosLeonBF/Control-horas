begin;

-- compute_hucha_status cubre todos los estados
do $$
begin
  if public.compute_hucha_status(0,0)    <> 'sin_presupuesto' then raise exception 'FALLO: sin_presupuesto'; end if;
  if public.compute_hucha_status(100,0)  <> 'disponible'      then raise exception 'FALLO: disponible'; end if;
  if public.compute_hucha_status(100,90) <> 'bajo'            then raise exception 'FALLO: bajo (90/100)'; end if;
  if public.compute_hucha_status(100,100)<> 'consumido'       then raise exception 'FALLO: consumido'; end if;
  if public.compute_hucha_status(100,110)<> 'excedido'        then raise exception 'FALLO: excedido'; end if;
  if public.compute_hucha_status(0,50)   <> 'excedido'        then raise exception 'FALLO: excedido sobre banco 0'; end if;
  raise notice 'OK: compute_hucha_status';
end $$;

-- crear un proyecto crea su banco en 0
do $$
declare v_pid uuid;
begin
  insert into public.projects (name) values ('Proyecto Test') returning id into v_pid;
  if not exists (select 1 from public.hucha_banks
      where project_id=v_pid and assigned_total=0 and consumed_total=0
        and remaining=0 and status='sin_presupuesto' and currency='EUR')
  then raise exception 'FALLO: no se creó el banco en 0 al crear el proyecto'; end if;
  raise notice 'OK: trigger crea banco en 0';
end $$;

rollback;

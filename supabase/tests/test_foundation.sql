-- Verifica estructura y trigger de la fundación
begin;

-- Las tablas existen con columnas clave
do $$
begin
  if (select count(*) from information_schema.columns
      where table_name='profiles' and column_name in ('id','email','role','status')) <> 4
  then raise exception 'FALLO: profiles no tiene las columnas esperadas'; end if;

  if not exists (select 1 from information_schema.columns
      where table_name='projects' and column_name='client')
  then raise exception 'FALLO: projects.client no existe'; end if;

  if not exists (select 1 from pg_constraint where conname like '%project_assignments%'
      and contype='u')
  then raise exception 'FALLO: project_assignments sin UNIQUE'; end if;

  raise notice 'OK: estructura de fundación';
end $$;

-- El trigger crea un profile al insertar en auth.users
do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, 'trigger-test@x.com', '{"full_name":"Trigger Test"}');

  if not exists (select 1 from public.profiles
      where id=v_id and role='operativo' and status='activo' and full_name='Trigger Test')
  then raise exception 'FALLO: el trigger no creó el profile correcto'; end if;

  raise notice 'OK: trigger de auth crea profile';
end $$;

rollback;

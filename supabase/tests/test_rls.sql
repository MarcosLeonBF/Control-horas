begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_mgr   uuid := gen_random_uuid();
  v_pid_a uuid;  -- asignado al manager
  v_pid_b uuid;  -- NO asignado
  v_count int;
begin
  -- profiles has FK to auth.users: insert there first, trigger auto-creates profiles
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_admin, 'admin@x.com', '{"full_name":"Admin"}'),
    (v_mgr,   'mgr@x.com',   '{"full_name":"Manager"}');
  -- adjust roles (trigger creates role='operativo')
  update public.profiles set role='admin',   status='activo' where id=v_admin;
  update public.profiles set role='manager', status='activo' where id=v_mgr;

  insert into public.projects (name) values ('Proy A') returning id into v_pid_a;
  insert into public.projects (name) values ('Proy B') returning id into v_pid_b;
  insert into public.project_assignments (project_id,user_id) values (v_pid_a, v_mgr);

  -- MANAGER solo ve su proyecto asignado
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_mgr,'email','mgr@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select count(*) into v_count from public.projects;
  if v_count <> 1 then raise exception 'FALLO: manager ve % proyectos (esperaba 1)', v_count; end if;

  -- MANAGER no puede crear proyectos (RLS write admin-only)
  begin
    insert into public.projects (name) values ('Hack');
    perform set_config('role','postgres', true);
    raise exception 'FALLO: manager pudo crear proyecto';
  exception when insufficient_privilege or sqlstate '42501' then
    perform set_config('role','postgres', true);
    raise notice 'OK: manager no puede crear proyecto';
  end;

  -- ADMIN ve los dos
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_admin,'email','admin@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select count(*) into v_count from public.projects;
  perform set_config('role','postgres', true);
  if v_count <> 2 then raise exception 'FALLO: admin ve % proyectos (esperaba 2)', v_count; end if;

  raise notice 'OK: RLS de visibilidad de proyectos';
  raise notice 'TODOS OK';
end $$;

rollback;

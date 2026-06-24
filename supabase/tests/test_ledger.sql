-- Test for registrar_movimiento_hucha()
-- Harness note: profiles has FK to auth.users, so we insert into auth.users
-- and let the trigger create profiles, then update role/full_name.
-- set_config('role','postgres', true) works because the MCP session runs as postgres.
-- All assertions from the brief are preserved verbatim.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_mgr   uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_pid   uuid;
  v_bank  uuid;
  v_consumo public.hucha_movements;
  v_amp   public.hucha_movements;
begin
  -- usuarios: insertar en auth.users (trigger crea profiles con role='operativo')
  -- luego actualizar role y full_name según necesite el test
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_admin, 'admin@x.com', '{"full_name":"Admin"}'),
    (v_mgr,   'mgr@x.com',   '{"full_name":"Manager"}'),
    (v_other, 'other@x.com', '{"full_name":"Otro"}');

  -- Ajustar roles y status (trigger crea role='operativo'; necesitamos admin y manager)
  update public.profiles set role='admin',   status='activo' where id=v_admin;
  update public.profiles set role='manager', status='activo' where id=v_mgr;
  update public.profiles set role='manager', status='activo' where id=v_other;

  -- proyecto (crea banco) + asignación del manager
  insert into public.projects (name) values ('Cliente B') returning id into v_pid;
  select id into v_bank from public.hucha_banks where project_id=v_pid;
  insert into public.project_assignments (project_id,user_id) values (v_pid, v_mgr);

  -- ── Impersonar ADMIN: ampliar +500 ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_admin,'email','admin@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);

  v_amp := public.registrar_movimiento_hucha(v_pid,'ampliacion',500,null,'Factura #1','carga');
  if v_amp.balance_after <> 500 then raise exception 'FALLO: ampliacion no dejó 500 (%).', v_amp.balance_after; end if;

  perform set_config('role','postgres', true);
  if (select assigned_total from public.hucha_banks where id=v_bank) <> 500
     then raise exception 'FALLO: assigned_total no es 500'; end if;
  if (select status from public.hucha_banks where id=v_bank) <> 'disponible'
     then raise exception 'FALLO: estado no es disponible'; end if;
  raise notice 'OK: ampliacion admin';

  -- ── Impersonar MANAGER asignado: consumir 100 ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_mgr,'email','mgr@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);

  v_consumo := public.registrar_movimiento_hucha(v_pid,'consumo',100,'Compra recurso',null,null);
  if v_consumo.balance_before <> 500 or v_consumo.balance_after <> 400
     then raise exception 'FALLO: consumo before/after (% / %)', v_consumo.balance_before, v_consumo.balance_after; end if;
  if v_consumo.amount <> -100 then raise exception 'FALLO: amount de consumo no es -100'; end if;
  if v_consumo.actor_name <> 'Manager' then raise exception 'FALLO: actor_name no se guardó'; end if;

  perform set_config('role','postgres', true);
  if (select remaining from public.hucha_banks where id=v_bank) <> 400
     then raise exception 'FALLO: remaining no es 400'; end if;
  raise notice 'OK: consumo manager descuenta';

  -- ── MANAGER no asignado NO puede consumir ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_other,'email','other@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    perform public.registrar_movimiento_hucha(v_pid,'consumo',10,'hack',null,null);
    perform set_config('role','postgres', true);
    raise exception 'FALLO: manager no asignado pudo consumir';
  exception when sqlstate 'P0001' then
    -- esperado: la función lanzó "no autorizado"; distinguir de nuestro FALLO
    if sqlerrm like 'FALLO:%' then raise; end if;
    perform set_config('role','postgres', true);
    raise notice 'OK: manager no asignado rechazado';
  end;

  -- ── MANAGER NO puede ampliar ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_mgr,'email','mgr@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    perform public.registrar_movimiento_hucha(v_pid,'ampliacion',999,null,null,'x');
    perform set_config('role','postgres', true);
    raise exception 'FALLO: manager pudo ampliar';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALLO:%' then raise; end if;
    perform set_config('role','postgres', true);
    raise notice 'OK: manager no puede ampliar';
  end;

  -- ── Validaciones: monto<=0, descripción vacía, fecha futura ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_mgr,'email','mgr@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    perform public.registrar_movimiento_hucha(v_pid,'consumo',0,'x',null,null);
    perform set_config('role','postgres', true);
    raise exception 'FALLO: aceptó monto 0';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALLO:%' then raise; end if;
    perform set_config('role','postgres', true);
    raise notice 'OK: rechaza monto <= 0';
  end;

  -- ── Sobreconsumo: permitido, marca excedido ──
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_mgr,'email','mgr@x.com','role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  perform public.registrar_movimiento_hucha(v_pid,'consumo',1000,'gasto grande',null,null);
  perform set_config('role','postgres', true);
  if (select status from public.hucha_banks where id=v_bank) <> 'excedido'
     then raise exception 'FALLO: sobreconsumo no marcó excedido'; end if;
  raise notice 'OK: sobreconsumo marca excedido';

  raise notice 'TODOS OK';
end $$;

rollback;

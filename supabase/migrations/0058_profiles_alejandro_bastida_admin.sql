-- ============================================================
-- 0058 PROFILES: Alejandro Bastida pasa a admin
-- ------------------------------------------------------------
-- Petición (2026-10-07): Alejandro Bastida (alejandro@bastidafarina.com) es el CEO y tiene
-- que poder ver todas las funciones de la plataforma. Era manager de Dirección, que solo da
-- Bancos, Reportes, Histórico y Presupuestos, y en Bancos y Reportes solo lo de su área.
--
-- Toda la app se gobierna por `profiles.role = 'admin'` (is_admin() en la base, guards de
-- las páginas y el menú de AppShell): no hay pantallas reservadas a una persona concreta,
-- así que con el rol le aparece todo, incluido Administración.
--
-- Se hace lo mismo que el panel al editar a alguien y ponerle admin: `can_create_users`
-- a false y `registro_dias_atras` a null (ya los tenía así). Se le deja el área Dirección,
-- como a Carlos Espada, que también es admin.
--
-- Persona por email con el slack_id de la 0051, para no tocar a otro si el email cambiara.
-- Idempotente: si ya es admin, no hace nada. Sin asiento de auditoría: la edición de
-- perfiles no se audita tampoco desde el panel.
-- ============================================================

do $$
declare
  v_n     int;
  v_id    uuid;
  v_role  text;
  v_slack text;
begin
  select count(*) into v_n from public.profiles where lower(email) = 'alejandro@bastidafarina.com';
  if v_n <> 1 then
    raise exception 'Migración 0058: % perfiles con el email alejandro@bastidafarina.com (se esperaba 1)', v_n;
  end if;

  select id, role, slack_id into v_id, v_role, v_slack
  from public.profiles where lower(email) = 'alejandro@bastidafarina.com';

  if v_slack is distinct from 'U01D4QN8P5W' then
    raise exception 'Migración 0058: el perfil de alejandro@ tiene slack_id % (se esperaba U01D4QN8P5W)', v_slack;
  end if;

  if v_role = 'admin' then
    raise notice 'Migración 0058: Alejandro Bastida ya era admin, nada que hacer';
    return;
  end if;

  update public.profiles
     set role = 'admin', can_create_users = false, registro_dias_atras = null
   where id = v_id;

  raise notice 'Migración 0058: Alejandro Bastida pasa de % a admin', v_role;
end $$;

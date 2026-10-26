-- ============================================================
-- 0065 EQUIPOS: Marketing, y Pilar Ferré pasa a él
-- ------------------------------------------------------------
-- Petición (2026-10-26): un equipo Marketing que no cuente para los avisos, como
-- Dirección y Administración. Eso no lo decide la base: lo decide el nombre del equipo en
-- EQUIPOS_SIN_AVISOS_PROPIOS (lib/avisos/personas.ts), que ya incluye 'marketing'. Aquí
-- solo se crea el equipo y se mueve a Pilar Ferré, que estaba en Clientes.
--
-- Persona por email, como en la 0051. Idempotente: re-ejecutarla no cambia nada.
-- ============================================================

insert into public.equipos (name) values ('Marketing')
  on conflict (name) do nothing;

do $$
declare
  v_n int;
begin
  update public.profiles
     set equipo_id = (select id from public.equipos where name = 'Marketing'), updated_at = now()
   where lower(email) = 'pilar@bastidafarina.com';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Migración 0065: % perfiles con el email pilar@bastidafarina.com (se esperaba 1)', v_n;
  end if;

  raise notice 'Migración 0065: Pilar Ferré en Marketing';
end $$;

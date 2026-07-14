-- ============================================================
-- 0035 Permiso delegado: dar de alta usuarios
-- ============================================================

-- Flag por usuario (lo concede el admin editando al usuario en /admin/usuarios).
-- Permite SOLO crear usuarios nuevos con rol operativo/manager; editar,
-- activar/desactivar y conceder este flag siguen siendo solo-admin.
-- No necesita RLS propia: se lee/escribe vía service role en server actions.
alter table public.profiles
  add column if not exists can_create_users boolean not null default false;

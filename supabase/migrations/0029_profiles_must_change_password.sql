-- ============================================================
-- 0029 Forzar cambio de contraseña en primer login
-- ============================================================

-- Columna para forzar cambio de contraseña en el primer login.
-- DEFAULT true: todo usuario (nuevo o existente) deberá cambiar su contraseña.
alter table public.profiles
  add column if not exists must_change_password boolean not null default true;

-- Política RLS: el usuario puede poner su propio must_change_password a false.
-- (Solo permite UPDATE de esa columna en su propia fila.)
drop policy if exists profiles_self_password_flag on public.profiles;
create policy profiles_self_password_flag on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

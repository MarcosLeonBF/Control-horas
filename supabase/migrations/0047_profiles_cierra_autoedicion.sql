-- ============================================================
-- 0047 PROFILES: cierra la autoedición del propio perfil
-- ------------------------------------------------------------
-- 0029 creó profiles_self_password_flag para que cada usuario pudiera poner su
-- must_change_password a false, con el comentario de que solo dejaba tocar esa
-- columna. No es así: una política RLS filtra filas, no columnas, y Supabase
-- concede UPDATE sobre todas las columnas de public.profiles a anon y
-- authenticated. Con esa política, cualquiera con sesión podía cambiar su fila
-- entera desde el navegador (role = 'admin', status, can_create_users,
-- registro_dias_atras...). Y como is_admin() lee profiles.role, eso abría de paso
-- todas las políticas de escritura reservadas a admin.
--
-- La política no la usa nadie: el flag lo pone el servidor con la clave de
-- servicio (perfil/actions.ts, cambiarContrasena), igual que el resto de
-- escrituras a profiles (admin/usuarios/actions.ts). Revisados los logs del API
-- desde el 2026-07-01 (0029 se aplicó el 07-03): ninguna escritura a profiles con
-- token de usuario.
--
-- Tras esto, solo un admin (profiles_update_admin) o la clave de servicio pueden
-- actualizar perfiles. El revoke a anon es defensa en profundidad: la RLS ya se
-- lo impedía, pero anon no tiene por qué poder escribir en esta tabla.
-- ============================================================

drop policy if exists profiles_self_password_flag on public.profiles;

revoke insert, update, delete on public.profiles from anon;

-- ============================================================
-- MANUAL · Anular las contraseñas de Supabase (paso a Acceso)
-- ------------------------------------------------------------
-- NO es una migración y no va en supabase/migrations: se ejecuta UNA vez, a mano, en el
-- SQL Editor de Supabase, con el usuario delante. Ver docs/acceso.md (corte a producción).
--
-- Para qué: con Acceso, Control de Gestión ya no pide contraseña (se entra por Acceso y la
-- sesión de Supabase se abre sin ella). Pero las contraseñas viejas siguen en auth.users, y
-- con la clave pública de Supabase cualquiera podría seguir entrando con ellas llamando a la
-- API de Supabase directamente, saltándose Acceso (y sus bajas). Esto las cambia todas por
-- una aleatoria, distinta para cada persona, que nadie conoce.
--
-- CUÁNDO, y solo entonces:
--   1. Los usuarios ya están migrados a Acceso (npm run migrar:controlhoras en el repo de
--      Acceso) y se comprobó que entran allí con su contraseña de siempre. Acceso copia los
--      hashes al migrar: después de este paso ya no habría nada que copiar.
--   2. Producción ya corre con ACCESO_ISSUER y el resto de variables, y se probó entrar,
--      salir y el conector (alta, edición y baja desde Acceso).
--   Si hubiera que volver atrás después de esto (quitar ACCESO_ISSUER), cada persona
--   necesitaría una contraseña nueva puesta por un admin: las de antes ya no existen.
--
-- Qué NO hace: no cierra las sesiones abiertas (son legítimas y caducan solas) ni toca a
-- quien no tiene contraseña. Afecta también a los usuarios de los E2E (@*.test), que los
-- E2E borran y vuelven a crear con su contraseña en cada corrida.
--
-- Cómo: ejecutar el archivo entero de una vez. Va en una transacción con una comprobación
-- dentro: si quedara alguna contraseña sin cambiar, aborta y no se guarda nada.
-- ============================================================

begin;

-- Copia de los hashes actuales, solo para comprobar que todos cambian. Temporal: desaparece
-- al terminar la transacción y nunca sale de la base.
create temporary table hashes_antes on commit drop as
  select id, encrypted_password from auth.users
   where encrypted_password is not null and encrypted_password <> '';

-- Cada una por un bcrypt de 32 bytes aleatorios (pgcrypto vive en el esquema `extensions`
-- en Supabase). crypt() y gen_random_bytes() se evalúan por fila: cada persona recibe una
-- distinta. bcrypt con coste 10, el mismo formato ($2a$) que usa Supabase.
update auth.users
   set encrypted_password = extensions.crypt(
         encode(extensions.gen_random_bytes(32), 'base64'),
         extensions.gen_salt('bf', 10)),
       updated_at = now()
 where encrypted_password is not null and encrypted_password <> '';

-- Comprobación: ninguna puede seguir igual. Si alguna sigue, la excepción deshace todo.
do $$
declare
  iguales integer;
begin
  select count(*) into iguales
    from hashes_antes a join auth.users u on u.id = a.id
   where u.encrypted_password = a.encrypted_password;
  if iguales > 0 then
    raise exception 'Quedan % contraseñas sin cambiar: no se guarda nada', iguales;
  end if;
end $$;

-- Resumen (anotarlo): cuántas se anularon.
select count(*) as anuladas from hashes_antes;

commit;

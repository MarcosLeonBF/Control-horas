-- ============================================================
-- Control de Horas — Bastida & Fariña
-- Script completo: tablas, RLS y políticas de acceso
-- Pegar en: Supabase → SQL Editor → New query → Run
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. TABLA DE ADMINS
--    Se gestiona desde el panel de Supabase (no desde el código).
--    Agregá los emails de los administradores en el INSERT de abajo.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_users (
  email text PRIMARY KEY
);

-- ▶ Editá esta lista con los emails reales antes de ejecutar
INSERT INTO admin_users (email) VALUES
  ('admin@tuempresa.com')
ON CONFLICT DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 2. FUNCIÓN HELPER: ¿el usuario actual es admin?
--    La usan las políticas de RLS más abajo.
--    SECURITY DEFINER = corre con privilegios elevados para poder
--    leer admin_users aunque el usuario normal no tenga acceso.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin_users
    WHERE email = (auth.jwt() ->> 'email')
  );
$$;


-- ────────────────────────────────────────────────────────────
-- 3. TABLA PRINCIPAL: time_entries
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS time_entries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  specialist_email text        NOT NULL,
  specialist_name  text        NOT NULL DEFAULT '',
  project          text        NOT NULL,
  stage            text        NOT NULL
                               CHECK (stage IN ('Setup', 'CRM', 'Servicios Mensuales')),
  department       text        NOT NULL DEFAULT 'Clientes'
                               CHECK (department IN ('Clientes', 'Ventas', 'Marketing', 'Todos')),
  entry_date       date        NOT NULL,
  hours            numeric     NOT NULL CHECK (hours > 0),
  description      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Índices para las consultas más frecuentes
CREATE INDEX IF NOT EXISTS idx_time_entries_email
  ON time_entries (specialist_email);

CREATE INDEX IF NOT EXISTS idx_time_entries_project
  ON time_entries (project);

CREATE INDEX IF NOT EXISTS idx_time_entries_date
  ON time_entries (entry_date DESC);


-- ────────────────────────────────────────────────────────────
-- 4. ACTIVAR ROW LEVEL SECURITY
--    Sin esto las políticas no tienen efecto.
-- ────────────────────────────────────────────────────────────

ALTER TABLE time_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users   ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- 5. POLÍTICAS DE ACCESO — time_entries
-- ────────────────────────────────────────────────────────────

-- VER: cada usuario ve solo sus registros;
--      los admins ven todos.
CREATE POLICY "Ver propios registros o todos si es admin"
  ON time_entries FOR SELECT
  USING (
    specialist_email = (auth.jwt() ->> 'email')
    OR is_admin()
  );

-- INSERTAR: el usuario solo puede insertar registros con su propio email.
--           Evita que alguien inserte horas "a nombre de otro".
CREATE POLICY "Insertar solo registros propios"
  ON time_entries FOR INSERT
  WITH CHECK (
    specialist_email = (auth.jwt() ->> 'email')
  );

-- EDITAR: cada usuario edita sus propios registros;
--         los admins pueden editar cualquiera.
CREATE POLICY "Editar propios registros o todos si es admin"
  ON time_entries FOR UPDATE
  USING (
    specialist_email = (auth.jwt() ->> 'email')
    OR is_admin()
  );

-- ELIMINAR: solo admins pueden borrar registros.
CREATE POLICY "Solo admins pueden eliminar"
  ON time_entries FOR DELETE
  USING (is_admin());


-- ────────────────────────────────────────────────────────────
-- 6. POLÍTICAS DE ACCESO — admin_users
--    Solo los admins pueden leer esta tabla.
--    Nadie puede modificarla desde la app (solo desde el panel).
-- ────────────────────────────────────────────────────────────

CREATE POLICY "Solo admins leen la lista de admins"
  ON admin_users FOR SELECT
  USING (is_admin());


-- ────────────────────────────────────────────────────────────
-- FIN DEL SCRIPT
-- ────────────────────────────────────────────────────────────

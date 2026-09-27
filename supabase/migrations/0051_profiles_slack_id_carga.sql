-- ============================================================
-- 0051 PROFILES: carga inicial de los IDs de Slack (0050)
-- ------------------------------------------------------------
-- Petición (2026-09-27): cargar de una vez el ID de miembro de Slack de todo el que esté
-- en la plataforma, a partir de la lista que pasó el equipo (IDslack_ByF.csv, 51 personas).
-- Hasta ahora el admin lo rellenaba a mano en /admin/usuarios.
--
-- Se empareja por EMAIL y no por nombre: la lista trae el nombre completo de Slack
-- ("Pilar Ferré Rodríguez") y el perfil el corto ("Pilar Ferré"), y el email es único y no
-- cambia. El cruce nombre→email se hizo a mano contra producción al escribir esto; cada fila
-- lleva al lado el nombre tal como venía en la lista.
--
-- Caso a mirar: "Álex Bastida" de la lista se asigna a Alejandro Bastida
-- (alejandro@bastidafarina.com). Es el único emparejado por diminutivo; confirmado por
-- negocio el 2026-09-27.
--
-- Perfiles que se quedan sin ID (no están en la lista, o no son la misma persona):
--   - Alberto Sánchez Rivera (inactivo).
--   - Antonela Guadalupe Machado (inactiva): la lista trae a "Guadalupe Giménez Sanz", que
--     por apellidos es otra persona.
--   - Prueba Marcos (cuenta de prueba de Marcos León): el índice único no deja repetir su ID.
-- Las otras 30 personas de la lista no tienen perfil en la plataforma; se cargan desde el
-- panel cuando se les dé de alta.
--
-- No pisa nada: si un perfil ya tiene un ID distinto (lo cargó el admin a mano), aborta en
-- vez de sobrescribirlo. Si ya tiene el mismo, lo cuenta y sigue: re-ejecutarla no hace nada.
-- Cada email tiene que corresponder a exactamente un perfil; si no, aborta todo.
--
-- Sin asiento de auditoría: la edición de perfiles no se audita tampoco desde el panel.
-- ============================================================

do $$
declare
  r          record;
  v_n        int;
  v_id       uuid;
  v_actual   text;
  v_nombre   text;
  v_puestos  int := 0;
  v_ya       int := 0;
  v_total    int := 0;
begin
  for r in
    select * from (values
      ('alejandro@bastidafarina.com',        'U01D4QN8P5W'),  -- Álex Bastida
      ('anna.paula@bastidafarina.com',       'U0APJJT2811'),  -- Anna Paula Reboredo
      ('antonio@bastidafarina.com',          'U09495VN2JG'),  -- Antonio Parrilla Murcia
      ('araceli@bastidafarina.com',          'U0BE7H8891Q'),  -- Araceli Polanco
      ('arturo.it@bastidafarina.com',        'U07CSUCR02Y'),  -- Arturo Rodriguez Gil
      ('carlos@bastidafarina.com',           'U05A228FDUP'),  -- Carlos Espada Gutiérrez
      ('cecilia@bastidafarina.com',          'U09BXSAGJGK'),  -- Cecilia Valentina Dulcich
      ('emmanuelruiz@bastidafarina.com',     'U07G7HZFJRY'),  -- Emmanuel Ruiz Estrada
      ('estefania@bastidafarina.com',        'U07QC4VMKNH'),  -- Estefania Domene
      ('garcia.estefania@bastidafarina.com', 'U096AGWQJN4'),  -- Estefanía García Jiménez
      ('illorente@bastidafarina.com',        'U07TUQRL4TT'),  -- Irene Llorente
      ('isabel@bastidafarina.com',           'U0B999D77AN'),  -- Isabel María Cañizares Pedroso
      ('jen@bastidafarina.com',              'U0A21CB9RPH'),  -- Jennifer Arias Gutiérrez
      ('josemarcano@bastidafarina.com',      'U0B44AX9W73'),  -- José Luis Marcano Nuñez
      ('juanfran@bastidafarina.com',         'U080BNZGTK5'),  -- Juanfran Marchante
      ('luis.rico@bastidafarina.com',        'U0A3P1A0FQB'),  -- Luis Ignacio deLes
      ('dpo@bastidafarina.com',              'U07MF8E7R62'),  -- Marcos Arturo León Alvarado
      ('maria.ruiz@bastidafarina.com',       'U09L2RSD2S1'),  -- Maria Ruiz Ruiz
      ('pilar@bastidafarina.com',            'U0949609WDS'),  -- Pilar Ferré Rodríguez
      ('tanilunar4@gmail.com',               'U09UBKWUER3'),  -- Tania Aso Lunar
      ('ysneylopez@gmail.com',               'U07EJ8Q1CEQ')   -- Ysney Lopez
    ) as t(email, slack_id)
  loop
    v_total := v_total + 1;

    -- En profiles hay emails con mayúsculas ("Anna.paula@…"): se compara en minúsculas.
    select count(*) into v_n from public.profiles where lower(email) = r.email;
    if v_n <> 1 then
      raise exception 'Migración 0051: % perfiles con el email % (se esperaba 1)', v_n, r.email;
    end if;

    select id, slack_id, full_name into v_id, v_actual, v_nombre
      from public.profiles where lower(email) = r.email;

    if v_actual is null then
      -- El CHECK de formato y el índice único de la 0050 abortan aquí si algo no cuadra.
      update public.profiles set slack_id = r.slack_id where id = v_id;
      v_puestos := v_puestos + 1;
    elsif v_actual = r.slack_id then
      v_ya := v_ya + 1;
    else
      raise exception 'Migración 0051: % ya tiene el ID de Slack % y la lista trae %; no se pisa',
        v_nombre, v_actual, r.slack_id;
    end if;
  end loop;

  if v_puestos + v_ya <> 21 or v_total <> 21 then
    raise exception 'Migración 0051: se esperaban 21 perfiles y salen % (puestos %, ya estaban %)',
      v_total, v_puestos, v_ya;
  end if;

  raise notice 'Migración 0051: % IDs de Slack cargados, % ya estaban', v_puestos, v_ya;
end $$;

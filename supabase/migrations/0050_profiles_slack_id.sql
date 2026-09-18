-- ============================================================
-- 0050 PROFILES: ID de miembro de Slack de cada persona
-- ------------------------------------------------------------
-- Los flujos de Zapier/n8n que reciben los avisos (0046) mandan mensajes por Slack, y
-- para mencionar a alguien (<@U…>) o escribirle por mensaje directo necesitan su ID de
-- MIEMBRO de Slack. Hoy solo tenían su email, que obliga a una búsqueda en Slack por cada
-- mensaje y falla si el email de Slack no es el mismo. Lo rellena el admin a mano.
--
-- Nullable a propósito: al aplicar esto nadie lo tiene y el payload lleva slack_id: null,
-- que los flujos ya tienen que contemplar (como equipo en la 0049).
-- ============================================================

alter table public.profiles
  add column if not exists slack_id text;

-- Solo IDs de miembro: U (o W, Enterprise Grid) + mayúsculas y dígitos. Un handle
-- (@laura), un nombre visible o el ID de un canal (C…) no sirven para mencionar, y si se
-- colaran el mensaje saldría sin mención y sin ningún error. La app valida lo mismo antes
-- (lib/slack-id.ts) para dar un error claro; esto es la red por debajo.
alter table public.profiles
  drop constraint if exists profiles_slack_id_formato;
alter table public.profiles
  add constraint profiles_slack_id_formato check (slack_id is null or slack_id ~ '^[UW][A-Z0-9]{8,}$');

-- Uno por persona: con el mismo ID en dos perfiles, los mensajes directos de una le
-- llegarían a la otra. Parcial: muchas personas sin ID (null) no chocan entre sí.
create unique index if not exists profiles_slack_id_unico
  on public.profiles (slack_id) where slack_id is not null;

comment on column public.profiles.slack_id is
  'ID de miembro de Slack (U… o W…). Viaja en todas las personas del payload de los avisos para que los flujos mencionen o escriban por mensaje directo. Lo rellena el admin en /admin/usuarios. null = sin asignar.';

-- Quién puede escribirla: nadie nuevo. Tras la 0047 la única política de UPDATE sobre
-- profiles es profiles_update_admin: solo un admin o la clave de servicio.

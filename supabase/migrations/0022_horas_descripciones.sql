-- 0022_horas_descripciones.sql
-- Descripciones: catálogo de descripciones predefinidas (como etapas), asignables a
-- posiciones. Al registrar horas, el campo Descripción es un desplegable con las
-- descripciones de la posición del usuario (se guarda el texto en time_log_lines.description).
-- Calcado de etapas + position_etapas (0005 / 0021).

create table public.descripciones (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.descripciones enable row level security;
create policy descripciones_select on public.descripciones
  for select to authenticated using (true);
create policy descripciones_admin_write on public.descripciones
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- posición ↔ descripción (N:N)
create table public.position_descripciones (
  id             uuid primary key default gen_random_uuid(),
  position_id    uuid not null references public.positions(id)     on delete cascade,
  descripcion_id uuid not null references public.descripciones(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (position_id, descripcion_id)
);
create index position_descripciones_position_idx    on public.position_descripciones(position_id);
create index position_descripciones_descripcion_idx on public.position_descripciones(descripcion_id);

alter table public.position_descripciones enable row level security;
create policy position_descripciones_select on public.position_descripciones
  for select to authenticated using (true);
create policy position_descripciones_admin_write on public.position_descripciones
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

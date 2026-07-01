-- 0021_horas_position_etapas.sql
-- Etapas por posición. Al registrar horas en un proyecto CLIENTE, un usuario solo
-- puede elegir entre las etapas de su posición. (Las etapas de "Departamento" siguen
-- gobernadas por departamento_etapas.) Calcado de position_areas (0019).

create table public.position_etapas (
  id          uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  etapa_id    uuid not null references public.etapas(id)    on delete cascade,
  created_at  timestamptz not null default now(),
  unique (position_id, etapa_id)
);
create index position_etapas_position_idx on public.position_etapas(position_id);
create index position_etapas_etapa_idx    on public.position_etapas(etapa_id);

alter table public.position_etapas enable row level security;
create policy position_etapas_select on public.position_etapas
  for select to authenticated using (true);
create policy position_etapas_admin_write on public.position_etapas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Semilla de arranque: todas las etapas activas en todas las posiciones, para no
-- bloquear el registro en proyecto cliente el día del deploy. El admin restringe
-- cada posición después desde Catálogos.
insert into public.position_etapas (position_id, etapa_id)
  select p.id, e.id from public.positions p cross join public.etapas e
  where e.active
  on conflict do nothing;

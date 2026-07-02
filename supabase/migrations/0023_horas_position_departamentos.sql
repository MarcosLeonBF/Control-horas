-- 0023_horas_position_departamentos.sql
-- Departamentos por posición. Al registrar horas en el proyecto interno
-- "Departamento", el desplegable de departamento se limita a los departamentos
-- de la posición del usuario. Calcado de position_etapas (0021).

create table public.position_departamentos (
  id              uuid primary key default gen_random_uuid(),
  position_id     uuid not null references public.positions(id)     on delete cascade,
  departamento_id uuid not null references public.departamentos(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (position_id, departamento_id)
);
create index position_departamentos_position_idx on public.position_departamentos(position_id);
create index position_departamentos_dep_idx      on public.position_departamentos(departamento_id);

alter table public.position_departamentos enable row level security;
create policy position_departamentos_select on public.position_departamentos
  for select to authenticated using (true);
create policy position_departamentos_admin_write on public.position_departamentos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Semilla de arranque: todos los departamentos activos en todas las posiciones,
-- para no bloquear el registro en "Departamento" el día del deploy. El admin
-- restringe cada posición después desde Catálogos.
insert into public.position_departamentos (position_id, departamento_id)
  select p.id, d.id from public.positions p cross join public.departamentos d
  where d.active
  on conflict do nothing;

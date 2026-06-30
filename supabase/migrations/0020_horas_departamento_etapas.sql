-- 0020_horas_departamento_etapas.sql
create table public.departamento_etapas (
  id uuid primary key default gen_random_uuid(),
  departamento_id uuid not null references public.departamentos(id) on delete cascade,
  etapa_id uuid not null references public.etapas(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (departamento_id, etapa_id)
);
create index dep_etapas_dep_idx on public.departamento_etapas(departamento_id);
create index dep_etapas_etapa_idx on public.departamento_etapas(etapa_id);

alter table public.departamento_etapas enable row level security;
create policy dep_etapas_select on public.departamento_etapas for select to authenticated using (true);
create policy dep_etapas_admin_write on public.departamento_etapas for all to authenticated using (public.is_admin()) with check (public.is_admin());

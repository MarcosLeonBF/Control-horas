-- 0005_horas_catalogos.sql — catálogos de áreas y etapas (Horas v2)
create table public.areas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_internal boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.etapas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Semilla de áreas (editable). "Interno" es el área del proyecto especial "Departamento".
insert into public.areas (name, is_internal) values
  ('CRM', false), ('SEO', false), ('Paid Media', false), ('Diseño', false),
  ('Automatizaciones', false), ('Contenido', false), ('Estrategia', false),
  ('Interno', true);

-- Semilla de etapas (tomadas del código legacy lib/types.ts; editable).
insert into public.etapas (name) values ('Setup'), ('CRM'), ('Servicios Mensuales');

alter table public.areas  enable row level security;
alter table public.etapas enable row level security;

-- Lectura: cualquier usuario autenticado. Escritura: solo admin.
create policy areas_select  on public.areas  for select to authenticated using (true);
create policy etapas_select on public.etapas for select to authenticated using (true);

create policy areas_admin_write on public.areas for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy etapas_admin_write on public.etapas for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

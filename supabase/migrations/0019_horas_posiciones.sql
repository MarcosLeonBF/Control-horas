-- 0019_horas_posiciones.sql
-- Banco de horas por POSICIÓN. El Excel trae una columna por posición (CRM, SEO,
-- Growth Strategists…). Una posición se liga a una o más áreas; un manager ve los
-- bancos de las posiciones de sus áreas. Cada usuario tiene una posición, que
-- determina qué banco consume al registrar horas. Departamentos pasan a catálogo.

create table public.positions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- posición ↔ área (N:N)
create table public.position_areas (
  id          uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  area_id     uuid not null references public.areas(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (position_id, area_id)
);
create index position_areas_position_idx on public.position_areas(position_id);
create index position_areas_area_idx on public.position_areas(area_id);

-- departamentos: ahora catálogo editable
create table public.departamentos (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- posición estructurada del usuario (determina el banco que consume)
alter table public.profiles add column if not exists position_id uuid references public.positions(id) on delete set null;

-- Semillas: posiciones = columnas actuales del Excel
insert into public.positions (name) values ('CRM'), ('SEO'), ('Growth Strategists');
-- Vínculos obvios por nombre de área (Growth Strategists lo liga el admin)
insert into public.position_areas (position_id, area_id)
  select p.id, a.id from public.positions p join public.areas a on a.name = p.name
  where p.name in ('CRM', 'SEO');
-- Departamentos fijos existentes
insert into public.departamentos (name) values ('Clientes'), ('Ventas'), ('Marketing'), ('Todos');

alter table public.positions      enable row level security;
alter table public.position_areas enable row level security;
alter table public.departamentos  enable row level security;

create policy positions_select on public.positions for select to authenticated using (true);
create policy positions_admin_write on public.positions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy position_areas_select on public.position_areas for select to authenticated using (true);
create policy position_areas_admin_write on public.position_areas for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy departamentos_select on public.departamentos for select to authenticated using (true);
create policy departamentos_admin_write on public.departamentos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

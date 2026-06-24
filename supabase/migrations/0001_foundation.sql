-- ============================================================
-- 0001 Fundación: profiles, projects, project_assignments
-- ============================================================

-- profiles (extiende auth.users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '',
  position    text,
  role        text not null default 'operativo'
              check (role in ('operativo','manager','admin')),
  status      text not null default 'activo'
              check (status in ('activo','inactivo')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- projects
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  client      text,
  status      text not null default 'activo'
              check (status in ('activo','archivado')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- project_assignments
create table if not exists public.project_assignments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists idx_assign_user on public.project_assignments(user_id);
create index if not exists idx_assign_project on public.project_assignments(project_id);

-- Helper: rol del usuario actual
create or replace function public.current_role_app()
returns text language sql security definer stable set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Redefinir is_admin(): profiles.role='admin' O admin_users (fallback legacy)
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      or exists (select 1 from public.admin_users where email = (auth.jwt() ->> 'email'));
$$;

-- Trigger: crear profile al crear el usuario de auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          'operativo', 'activo')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS habilitado (políticas en 0004)
alter table public.profiles            enable row level security;
alter table public.projects            enable row level security;
alter table public.project_assignments enable row level security;

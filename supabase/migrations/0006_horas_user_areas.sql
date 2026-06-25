-- 0006_horas_user_areas.sql
create table public.user_areas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  area_id    uuid not null references public.areas(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (user_id, area_id)
);
create index user_areas_user_idx on public.user_areas(user_id);

alter table public.user_areas enable row level security;

-- El usuario ve sus propias áreas; manager/admin ven todas; solo admin escribe.
create policy user_areas_select on public.user_areas for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
);
create policy user_areas_admin_write on public.user_areas for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

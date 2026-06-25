-- 0007_horas_time_logs.sql
create table public.time_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete restrict,
  entry_date  date not null,
  total_hours numeric(6,2) not null default 0,
  status      text not null default 'guardado' check (status in ('guardado','editado','anulado')),
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index time_logs_user_date_idx on public.time_logs(user_id, entry_date);

create table public.time_log_lines (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references public.time_logs(id) on delete cascade,
  project     text not null,
  area_id     uuid not null references public.areas(id) on delete restrict,
  department  text not null check (department in ('Clientes','Ventas','Marketing','Todos')),
  etapa_id    uuid not null references public.etapas(id) on delete restrict,
  hours       numeric(5,2) not null check (hours > 0),
  description text not null check (length(btrim(description)) > 0),
  created_by  uuid references public.profiles(id),
  updated_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index time_log_lines_log_idx on public.time_log_lines(log_id);

alter table public.time_logs      enable row level security;
alter table public.time_log_lines enable row level security;

-- Lectura: propios (operativo) o todos (manager/admin). Escritura directa: ninguna (solo vía RPC).
create policy time_logs_select on public.time_logs for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
);
create policy time_log_lines_select on public.time_log_lines for select to authenticated using (
  exists (
    select 1 from public.time_logs tl
    where tl.id = log_id and (
      tl.user_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
    )
  )
);
-- (Sin políticas de insert/update/delete: las escrituras pasan por RPC security definer.)

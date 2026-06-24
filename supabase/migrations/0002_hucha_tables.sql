-- ============================================================
-- 0002 HUCHA: bancos, movimientos, estado y trigger de banco
-- ============================================================

create table if not exists public.hucha_banks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null unique references public.projects(id) on delete cascade,
  currency       text not null default 'EUR',
  assigned_total numeric(14,2) not null default 0,
  consumed_total numeric(14,2) not null default 0,
  remaining      numeric(14,2) not null default 0,
  status         text not null default 'sin_presupuesto',
  updated_at     timestamptz not null default now()
);

create table if not exists public.hucha_movements (
  id                   uuid primary key default gen_random_uuid(),
  bank_id              uuid not null references public.hucha_banks(id) on delete cascade,
  type                 text not null
                       check (type in ('consumo','ampliacion','correccion','anulacion')),
  amount               numeric(14,2) not null,
  balance_before       numeric(14,2) not null,
  balance_after        numeric(14,2) not null,
  description          text,
  reference            text,
  reason               text,
  actor_id             uuid references public.profiles(id),
  actor_name           text not null default '',
  entry_date           date not null default current_date,
  created_at           timestamptz not null default now(),
  corrects_movement_id uuid references public.hucha_movements(id)
);

create index if not exists idx_mov_bank on public.hucha_movements(bank_id);
create index if not exists idx_mov_date on public.hucha_movements(entry_date desc);

-- Estado del banco según saldo (umbral global 20%)
create or replace function public.compute_hucha_status(p_assigned numeric, p_consumed numeric)
returns text language sql immutable as $$
  select case
    when p_assigned = 0 and p_consumed = 0 then 'sin_presupuesto'
    when (p_assigned - p_consumed) < 0      then 'excedido'
    when (p_assigned - p_consumed) = 0      then 'consumido'
    when p_assigned > 0
         and (p_assigned - p_consumed) < 0.20 * p_assigned then 'bajo'
    else 'disponible'
  end;
$$;

-- Crear banco en 0 al crear el proyecto
create or replace function public.handle_new_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.hucha_banks (project_id, assigned_total, consumed_total, remaining, status)
  values (new.id, 0, 0, 0, 'sin_presupuesto')
  on conflict (project_id) do nothing;
  return new;
end $$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

alter table public.hucha_banks     enable row level security;
alter table public.hucha_movements enable row level security;

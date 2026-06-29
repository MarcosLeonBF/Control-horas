-- 0016_horas_alertas.sql
-- Dedupe de alertas de banco de horas: cada umbral (80/100/exceso) se avisa
-- una sola vez por proyecto. La escritura la hace el servidor (service role)
-- tras guardar un registro; la lectura es para manager/admin (historial).
create table public.horas_alertas (
  id         uuid primary key default gen_random_uuid(),
  project    text not null,
  threshold  text not null check (threshold in ('80','100','exceso')),
  consumed   numeric(8,2) not null,
  assigned   numeric(8,2) not null,
  sent_at    timestamptz not null default now(),
  unique (project, threshold)
);

alter table public.horas_alertas enable row level security;

create policy horas_alertas_select on public.horas_alertas for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
);

-- 0014_horas_ampliaciones.sql
-- Ampliaciones de horas POR PROYECTO (banco por proyecto). El Excel da la base
-- (Horas CRM); el admin puede sumar horas extra dentro de la app, igual que las
-- ampliaciones de HUCHA. Clave = nombre de proyecto (texto), como time_log_lines.
-- Asignado(proyecto) = Horas CRM (Excel) + Σ ampliaciones activas.
create table public.horas_ampliaciones (
  id          uuid primary key default gen_random_uuid(),
  project     text not null,
  hours       numeric(7,2) not null check (hours > 0),
  reason      text not null check (length(btrim(reason)) > 0),
  entry_date  date not null default current_date,
  actor_name  text not null,
  active      boolean not null default true,
  voided_at   timestamptz,
  voided_by   uuid references public.profiles(id),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index horas_ampliaciones_project_idx on public.horas_ampliaciones(project) where active;

alter table public.horas_ampliaciones enable row level security;

-- Lectura: manager/admin. Escritura: solo vía RPC (sin políticas insert/update/delete).
create policy horas_ampliaciones_select on public.horas_ampliaciones for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
);

-- Ampliar (solo admin): registra una ampliación de horas para un proyecto.
create or replace function public.ampliar_horas(
  p_project    text,
  p_hours      numeric,
  p_reason     text,
  p_entry_date date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_name text;
  v_id   uuid;
begin
  select role, full_name into v_role, v_name from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'no autorizado: solo admin puede ampliar horas'; end if;
  if coalesce(btrim(p_project),'') = '' then raise exception 'proyecto requerido'; end if;
  if coalesce(p_hours,0) <= 0 then raise exception 'las horas deben ser > 0'; end if;
  if length(btrim(coalesce(p_reason,''))) = 0 then raise exception 'el motivo es obligatorio'; end if;
  if coalesce(p_entry_date, current_date) > current_date then raise exception 'fecha inválida: no puede ser futura'; end if;

  insert into public.horas_ampliaciones(project, hours, reason, entry_date, actor_name, created_by)
  values (btrim(p_project), p_hours, btrim(p_reason), coalesce(p_entry_date, current_date), coalesce(v_name, 'Admin'), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.ampliar_horas(text, numeric, text, date) to authenticated;

-- Anular una ampliación (solo admin): soft-delete; deja de sumar al asignado.
create or replace function public.anular_ampliacion_horas(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'no autorizado: solo admin puede anular'; end if;
  update public.horas_ampliaciones
     set active = false, voided_at = now(), voided_by = auth.uid()
   where id = p_id and active;
end $$;
grant execute on function public.anular_ampliacion_horas(uuid) to authenticated;

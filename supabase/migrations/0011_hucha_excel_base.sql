-- 0011_hucha_excel_base.sql — base del Excel en el banco HUCHA
alter table public.hucha_banks add column if not exists excel_hucha numeric(14,2) not null default 0;

-- Permite upsert de proyectos por nombre. NOTA: `projects` es la tabla compartida
-- de la fundación (Plan 1), pero en la práctica solo HUCHA la puebla (Horas v2 lee
-- sus proyectos del Excel en vivo y guarda el nombre como texto en time_log_lines).
-- El nombre de proyecto es un identificador, así que la unicidad global es aceptable.
create unique index if not exists projects_name_key on public.projects(name);

-- Aplica la base del Excel como delta sobre el asignado (no crea movimiento).
-- Invariante: assigned_total = excel_hucha + ampliaciones ; remaining = assigned_total - consumed_total.
create or replace function public.set_hucha_excel_base(p_bank_id uuid, p_hucha numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_bank         public.hucha_banks;
  v_delta        numeric(14,2);
  v_new_assigned numeric(14,2);
begin
  select * into v_bank from public.hucha_banks where id = p_bank_id for update;
  if v_bank.id is null then raise exception 'banco no encontrado'; end if;
  v_delta := coalesce(p_hucha,0) - v_bank.excel_hucha;
  if v_delta = 0 then return; end if;
  v_new_assigned := v_bank.assigned_total + v_delta;
  update public.hucha_banks set
    excel_hucha    = coalesce(p_hucha,0),
    assigned_total = v_new_assigned,
    remaining      = v_new_assigned - v_bank.consumed_total,
    status         = public.compute_hucha_status(v_new_assigned, v_bank.consumed_total),
    updated_at     = now()
  where id = p_bank_id;
end $$;

grant execute on function public.set_hucha_excel_base(uuid, numeric) to authenticated, service_role;

-- ============================================================
-- 0037 HORAS: histórico mensual previo a la plataforma
-- ------------------------------------------------------------
-- La hoja HorasHistoricas_CONTROLHORAS son CIERRES MENSUALES (las 20 fechas
-- distintas son todas el último día de su mes), no registros diarios. Meterlos
-- en time_logs rompería la semántica de entry_date = día real de trabajo (habría
-- días con 190h). Además la hoja trae Área y Descripción vacías en el 100% de
-- las filas, y time_log_lines las exige NOT NULL.
--
-- Por eso viven en su propia tabla, fiel al origen:
--   * month como 'YYYY-MM': el dato ES un mes, no un día.
--   * etapa/area como TEXTO: 'Otros' y 'Otros (sin G/G)' no están en catálogo y
--     darlos de alta los metería en los desplegables de registro de la app viva.
--   * area/description nulables: vienen vacías; no se fabrica relleno.
--
-- La posición NO se persiste: se resuelve desde el perfil al consultar, igual
-- que hace el banco con los registros normales.
-- ============================================================

create table public.horas_historicas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete restrict,
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  project     text not null check (length(btrim(project)) > 0),
  department  text not null check (length(btrim(department)) > 0),
  etapa       text not null check (length(btrim(etapa)) > 0),
  area        text,
  hours       numeric(6,2) not null check (hours > 0),
  description text,
  source      text not null check (length(btrim(source)) > 0),
  created_at  timestamptz not null default now()
);

-- El banco agrupa el consumo por (proyecto, mes); los reportes filtran por usuario.
create index horas_historicas_project_month_idx on public.horas_historicas(project, month);
create index horas_historicas_user_idx on public.horas_historicas(user_id);
-- La recarga del script borra por source antes de insertar.
create index horas_historicas_source_idx on public.horas_historicas(source);

alter table public.horas_historicas enable row level security;

-- Lectura: manager/admin (mismo criterio que el banco de horas).
-- Sin policies de insert/update/delete: la carga va con service role, que salta RLS.
create policy horas_historicas_select on public.horas_historicas for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager','admin'))
);

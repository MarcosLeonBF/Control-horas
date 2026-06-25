-- Verifica semillas y unicidad
do $$
declare n int;
begin
  select count(*) into n from public.areas where is_internal = true and name = 'Interno';
  if n <> 1 then raise exception 'falta área Interno (n=%)', n; end if;
  select count(*) into n from public.etapas where name in ('Setup','CRM','Servicios Mensuales');
  if n <> 3 then raise exception 'faltan etapas semilla (n=%)', n; end if;
  select count(*) into n from public.areas;
  if n < 8 then raise exception 'faltan áreas semilla (n=%)', n; end if;
  raise notice 'OK catalogos';
end $$;

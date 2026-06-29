-- 0015_horas_ampliaciones_fk_setnull.sql
-- created_by/voided_by no deben BLOQUEAR el borrado de un perfil (el ledger es
-- auditoría, no una dependencia dura). Pasan a ON DELETE SET NULL.
alter table public.horas_ampliaciones drop constraint horas_ampliaciones_created_by_fkey;
alter table public.horas_ampliaciones
  add constraint horas_ampliaciones_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.horas_ampliaciones drop constraint horas_ampliaciones_voided_by_fkey;
alter table public.horas_ampliaciones
  add constraint horas_ampliaciones_voided_by_fkey
  foreign key (voided_by) references public.profiles(id) on delete set null;

-- ============================================================
-- 0004 Políticas RLS (matriz spec §7)
-- ============================================================

-- ── profiles ──
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles for insert
  with check (public.is_admin());

-- ── projects ──
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select
  using (
    public.is_admin()
    or exists (select 1 from public.project_assignments pa
               where pa.project_id = projects.id and pa.user_id = auth.uid())
  );

drop policy if exists projects_write_admin on public.projects;
create policy projects_insert_admin on public.projects for insert with check (public.is_admin());
create policy projects_update_admin on public.projects for update using (public.is_admin()) with check (public.is_admin());

-- ── project_assignments ──
drop policy if exists assign_select on public.project_assignments;
create policy assign_select on public.project_assignments for select
  using (user_id = auth.uid() or public.is_admin());

create policy assign_insert_admin on public.project_assignments for insert with check (public.is_admin());
create policy assign_delete_admin on public.project_assignments for delete using (public.is_admin());

-- ── hucha_banks ── (solo lectura para clientes; escritura solo vía función definer)
drop policy if exists banks_select on public.hucha_banks;
create policy banks_select on public.hucha_banks for select
  using (
    public.is_admin()
    or exists (select 1 from public.project_assignments pa
               where pa.project_id = hucha_banks.project_id and pa.user_id = auth.uid())
  );
-- sin policies de insert/update/delete → nadie escribe directo (la función es SECURITY DEFINER)

-- ── hucha_movements ── (solo lectura; append vía función)
drop policy if exists movs_select on public.hucha_movements;
create policy movs_select on public.hucha_movements for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.hucha_banks b
      join public.project_assignments pa on pa.project_id = b.project_id
      where b.id = hucha_movements.bank_id and pa.user_id = auth.uid())
  );
-- sin insert/update/delete directos

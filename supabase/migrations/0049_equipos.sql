-- ============================================================
-- 0049 EQUIPOS: a qué parte de la empresa pertenece cada persona
-- ------------------------------------------------------------
-- Los avisos salientes (0046) viajan con la persona, pero solo dicen su POSICIÓN
-- (CRM, SEO…), que es una etiqueta de trabajo, no de organigrama. Los flujos que
-- consumen los avisos necesitan enrutar por área de la empresa —a qué canal va el
-- mensaje, quién lo recibe— y eso hoy no se puede deducir del payload.
--
-- Ojo con el nombre: "departamento" YA significa otra cosa en esta app (Clientes,
-- Ventas, Marketing, Todos: lo que se elige al registrar en el proyecto interno
-- "Departamento", tabla `departamentos`). Por eso esto se llama EQUIPO y vive en su
-- propia tabla: son dos listas distintas que no se pisan, aunque algún nombre
-- coincida (p. ej. "Clientes" está en las dos y no significan lo mismo).
--
-- Qué NO hace: el equipo no gobierna nada de lo que se puede registrar. No entra en
-- guardar_registro, no tiene tablas de vínculo con posiciones ni con áreas. Es una
-- etiqueta de la persona, y solo la lee el payload de los avisos.
-- ============================================================

create table if not exists public.equipos (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.equipos is
  'Equipos de la empresa (organigrama): a qué parte de la empresa pertenece una persona. Distinto de `departamentos`, que es el desplegable del proyecto interno "Departamento" al registrar horas. Se gestiona en /admin/catalogos → Equipos.';

-- Nullable a propósito: al aplicar esta migración nadie tiene equipo y nada cambia de
-- comportamiento. El admin los va asignando desde el panel de usuarios, y hasta que lo
-- haga el payload lleva `equipo: null`, que es información honesta y no un error.
--
-- SET NULL y no RESTRICT: borrar un equipo del catálogo no debe bloquearse por tener
-- gente dentro; la gente se queda sin equipo y se reasigna. Es el mismo criterio que
-- `profiles.position_id` (0019) y `profiles.manager_id` (0046).
alter table public.profiles
  add column if not exists equipo_id uuid references public.equipos(id) on delete set null;

comment on column public.profiles.equipo_id is
  'Equipo de la empresa al que pertenece la persona (organigrama). Viaja en el payload de los avisos para que los flujos enruten. null = sin asignar todavía.';

-- Quién puede escribirla: nadie nuevo. Tras la 0047 la única política de UPDATE sobre
-- profiles es profiles_update_admin, así que esta columna, como el resto de la fila,
-- solo la toca un admin o la clave de servicio. Se comprueba aquí a propósito: una
-- columna nueva en profiles es justo el sitio donde volvería a colarse el agujero que
-- cerró la 0047 (una política que filtra filas, no columnas).

create index if not exists profiles_equipo_idx on public.profiles(equipo_id);

-- Semilla mínima para poder empezar a asignar el mismo día. El resto los crea el admin.
insert into public.equipos (name) values ('Clientes'), ('RRHH')
  on conflict (name) do nothing;

-- RLS: idénticas a las de los demás catálogos (areas, etapas, departamentos,
-- positions). Lectura abierta a cualquier autenticado —es un catálogo, y el panel de
-- usuarios necesita resolver el nombre—; escritura solo admin.
alter table public.equipos enable row level security;

drop policy if exists equipos_select      on public.equipos;
drop policy if exists equipos_admin_write on public.equipos;

create policy equipos_select on public.equipos
  for select to authenticated using (true);
create policy equipos_admin_write on public.equipos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

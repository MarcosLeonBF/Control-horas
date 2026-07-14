# Permiso delegado de alta de usuarios

**Fecha:** 2026-07-14
**Estado:** aprobado

## Objetivo

El admin puede marcar usuarios concretos (p. ej. RRHH) para que puedan **dar de alta** usuarios nuevos. Solo alta: no editar, no activar/desactivar, no conceder permisos.

## Decisiones cerradas

- El permiso es un flag booleano por usuario, no un rol nuevo ni una tabla de permisos.
- Un usuario con el flag puede crear usuarios con rol **operativo o manager**, nunca admin.
- Al entrar en `/admin/usuarios` ve la **lista en solo lectura** (sin acciones) más el formulario de alta.
- El flag solo lo concede/retira el admin, editando al usuario. Un alta nueva nunca nace con el flag.

## Modelo de datos

Migración `0035_profiles_can_create_users.sql`:

```sql
alter table public.profiles
  add column can_create_users boolean not null default false;
```

## Backend (`app/(horas)/admin/usuarios/actions.ts`)

- `crearUsuario`:
  - Actor válido: admin, **o** usuario con `can_create_users = true` y `status = 'activo'`.
  - Si el actor no es admin y `input.role === 'admin'` → error («Solo un administrador puede crear admins.»).
  - El insert de perfil no toca `can_create_users` (queda en `false` por defecto).
- `actualizarUsuario`: sigue siendo solo-admin. `EdicionUsuario` gana `canCreateUsers: boolean` y el update lo persiste.
- `cambiarEstadoUsuario`: sin cambios (solo-admin).

## Página `/admin/usuarios`

- Carga `role` y `can_create_users` del actor.
- admin → vista completa (como hoy) + el editor muestra el checkbox del permiso.
- no admin con flag → `UsuariosPanel` en `readOnly` + `UsuarioForm` sin la opción de rol admin.
- resto → `redirect('/registrar')` (como hoy).

## UI

- `UsuariosPanel`:
  - Prop `readOnly?: boolean`: oculta la columna Acciones y el editor inline.
  - `UsuarioRow` gana `canCreateUsers`. Badge discreto junto al rol («Alta de usuarios») para los que tienen el flag.
  - Editor: checkbox «Puede dar de alta usuarios», visible solo si el rol seleccionado no es admin (el admin ya puede por rol).
- `UsuarioForm`:
  - Prop `allowAdminRole?: boolean` (default `true`): en `false` no se ofrece la opción `admin`.
- `AppShell` + layouts `(horas)` y `(hucha)`:
  - Prop nueva `canCreateUsers: boolean`; el ítem «Usuarios» de Administración se muestra si `isAdmin || canCreateUsers`. El resto de ítems de Administración siguen solo-admin.

## Casos borde y seguridad

- Flag + `status: 'inactivo'` → el action rechaza (defensa extra al gate de login).
- El no-admin no puede: editar, cambiar estado, crear admins, ni conceder `can_create_users` (ni por UI ni por action).
- Trazabilidad: `profiles.created_by` ya registra quién dio el alta.
- El límite de rol se valida **en el server action**, la UI solo lo refleja.

## Verificación

- `npx tsc --noEmit` + `npm run build` (gate del repo; lint está roto repo-wide).
- Manual: (1) admin marca el flag a un usuario no-admin; (2) ese usuario ve «Usuarios» en el menú, lista sin acciones, alta funcional de operativo/manager; (3) intento de crear admin rechazado a nivel de action; (4) usuario sin flag sigue sin acceso.

# Control de Gestión con Acceso (login centralizado)

Acceso es el proveedor de identidad (OIDC) de las apps internas de Bastida&Farina. Con él, Control de Gestión deja de pedir contraseña: se entra por Acceso y la app abre la sesión de Supabase de esa misma persona. RLS, RPC y tablas no cambian.

Todo depende de `ACCESO_ISSUER`:

- **Sin `ACCESO_ISSUER`**: la app funciona exactamente como antes (login con contraseña, cambio forzado, cambio en `/perfil`, altas con contraseña inicial). El conector responde 404.
- **Con `ACCESO_ISSUER`**: `/login` manda a Acceso, "Salir" cierra también la sesión de Acceso, las contraseñas y las altas se gestionan en Acceso y el conector `/api/hub/*` queda activo.

## Variables de entorno (Vercel)

| Variable | Valor |
|---|---|
| `ACCESO_ISSUER` | `https://acceso.<DOMINIO_BASE>/oidc` |
| `ACCESO_CLIENT_ID` | `control-horas` |
| `ACCESO_CLIENT_SECRET` | secreto del cliente (Acceso lo muestra una sola vez) |
| `APP_URL` | URL pública de la app, sin barra final (ya la usan los avisos) |
| `ACCESO_CONECTOR_SECRETO` | secreto del conector (Acceso lo muestra una sola vez) |

Cambiar cualquiera exige volver a desplegar. Ninguna es `NEXT_PUBLIC_`: la URL de salida de Acceso llega al navegador como prop desde los layouts.

## Registrar la app en Acceso

Panel de Acceso → Apps → Nueva:

| Campo | Valor |
|---|---|
| Identificador (`client_id`) | `control-horas` |
| Nombre visible | Control de Gestión |
| URL de inicio | `<APP_URL>/` |
| Redirect URI | `<APP_URL>/auth/hub/callback` |
| URL del conector | `<APP_URL>/api/hub` |

## Cómo funciona

- **Entrar.** `/login` → `/auth/hub/entrar` (PKCE S256, `state` y `nonce` en una cookie cifrada de 10 minutos) → Acceso → `/auth/hub/callback`. El callback valida el código con `openid-client`, toma el `sub` (es el id de `auth.users`), comprueba que hay perfil activo y sin baneo, y abre la sesión con `auth.admin.generateLink({ type: 'magiclink' })` + `auth.verifyOtp({ token_hash, type: 'email' })` en el servidor. `generateLink` no envía correos. Los errores acaban en `/auth/hub/error` con un mensaje para la persona; el detalle queda en el log de Vercel con el prefijo `[acceso]`.
- **Salir.** `signOut` de Supabase y después `${ACCESO_ISSUER}/session/end?client_id=control-horas`.
- **Se retiran** el cambio forzado de contraseña, el cambio de contraseña de `/perfil` (enlace a "Mi cuenta" de Acceso) y el alta de `/admin/usuarios` (enlace al alta de Acceso). Las acciones del servidor también se niegan. Editar rol, áreas, etc. sigue en la app.
- **Corte inmediato.** Los layouts de Horas y HUCHA comprueban `profiles.status` en cada petición: tras una baja, la siguiente página ya muestra "acceso desactivado".

## Conector (`/api/hub`)

Contrato en `docs/integrar-una-app.md` del repo de Acceso. Todas las rutas piden `Authorization: Bearer ${ACCESO_CONECTOR_SECRETO}` (401 si no) y dan 404 sin `ACCESO_ISSUER`. Código en `lib/hub/` (reglas puras en `ficha.ts`, base en `conector.ts`).

| Clave | Tipo | Reglas (de dónde salen) |
|---|---|---|
| `role` | selección, obligatoria | operativo / manager / admin, por defecto operativo (CHECK de 0001) |
| `slack_id` | texto, obligatorio al crear | `^[UW][A-Z0-9]{8,}$` y único (0050, `lib/slack-id.ts`); se normaliza a mayúsculas |
| `position_id` | selección | posiciones activas |
| `equipo_id` | selección | equipos activos (0049) |
| `manager_id` | selección | managers y admins activos; nunca la propia persona (0046) |
| `areas` | selección múltiple | áreas activas no internas → `user_areas`; con rol operativo se guardan vacías |
| `registro_dias_atras` | número | entero 1 a 3650 o vacío = ventana normal (0043, 0048) |
| `can_create_users` | sí/no | por defecto no (0035) |

Como en `/admin/usuarios`, el rol admin apaga `can_create_users` y `registro_dias_atras`.

- `PUT` crea la ficha si no existe: usuario de Supabase con `id` = `sub`, correo confirmado y contraseña aleatoria; el trigger crea el perfil y se completa. Una clave que no viene en `datos` conserva su valor (un PUT que solo cambia el nombre no borra nada); con `null` o `""` se vacía. Un valor que ya tenía guardado se acepta aunque ya no esté entre las opciones vivas.
- `activo: false` (en `PUT`) y `baja` dejan el perfil inactivo y banean el usuario de Supabase, que ya no puede renovar su sesión. `activo: true` levanta el baneo. Por eso **las reactivaciones se hacen desde Acceso**: activar a alguien en `/admin/usuarios` no le quita el baneo.

## Paso a producción (con el usuario delante)

1. Registrar la app en Acceso (tabla de arriba) y guardar los dos secretos.
2. En el repo de Acceso, `npm run migrar:controlhoras -- --simular`, revisar, y `npm run migrar:controlhoras`. Comprobar que alguien migrado entra en Acceso con su contraseña de siempre.
3. Poner las variables de entorno en Vercel (Production) y desplegar.
4. Probar: entrar y salir; entrar con un enlace profundo (p. ej. un registro) y volver a él; `/perfil` y `/admin/usuarios` enlazan a Acceso; desde Acceso, alta de una persona de prueba, edición de su ficha y baja (la sesión abierta se corta en la siguiente página).
5. Solo entonces, ejecutar `supabase/manual/anular-contrasenas.sql` en el SQL Editor (lee su cabecera antes).

## Vuelta atrás

Quitar `ACCESO_ISSUER` en Vercel y desplegar: vuelve el login con contraseña. Si ya se ejecutó `anular-contrasenas.sql`, nadie tiene contraseña válida en Supabase y un admin tiene que poner una nueva a cada persona (por ejemplo desde el panel de Supabase), así que ese paso va al final.

## A tener en cuenta

- **Límite de Supabase en `/verify`.** Cada entrada hace un `verifyOtp` desde el servidor, y Supabase limita las verificaciones por IP. Si muchas personas entran a la vez puede saltar; se sube en Supabase → Authentication → Rate Limits.
- **Desarrollo local.** El servidor local y los E2E usan la misma base que producción. Sin `ACCESO_ISSUER` en `.env.local` el login local sigue siendo con contraseña, y tras anular las contraseñas solo entran los usuarios que crean los E2E.
- **Tokens ya emitidos.** Tras una baja, las páginas cortan al momento, pero un access token de Supabase ya emitido sigue valiendo contra la API de Supabase hasta que caduca (1 h por defecto); RLS no mira `status`.

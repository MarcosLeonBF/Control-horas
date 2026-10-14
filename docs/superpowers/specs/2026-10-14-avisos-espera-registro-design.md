# Diseño — Los avisos de un registro esperan 5 minutos

**Fecha:** 2026-10-14
**Estado:** diseño aprobado por el usuario en la conversación; pendiente de revisión del documento y de plan
**Origen:** queja de Julián (Estefania Domene, `registro.llamativo` de 15,5 h el 09/10/2026).
**Relacionado:** [2026-09-10-avisos-webhooks-design.md](2026-09-10-avisos-webhooks-design.md),
contrato [docs/avisos/contrato-avisos-v1.md](../../avisos/contrato-avisos-v1.md).

## Problema

Los avisos de un registro (`registro.enviado`, `registro.llamativo` y los `banco.*` que
dispara un guardado) se arman con lo que se acaba de guardar y salen en el mismo momento.
Si la persona se equivoca y corrige, el aviso ya salió con el error y nada lo corrige.

Caso real (09/10, hora de Argentina): Estefania guardó su 09/10 con 8,5 h a las 13:08. A las
13:25 guardó otro registro con Vagheggi 1 h el 08/10 y tres líneas (7 h) que se quedaron
con la fecha por defecto, hoy (09/10). El 09/10 sumó 15,5 h durante 25 segundos: salió el
pulso y el llamativo. A las 13:26 movió esas 7 h al 08/10.

No es un caso aislado. Entre el 14/09 y el 13/10 hubo 12 cambios de fecha de 7 personas,
casi todos de «hoy» a un día anterior y en 10–65 segundos. Desde que se activaron los
tipos (02/10) llegaron a Julián 7 avisos con la fecha equivocada (6 pulsos y este
llamativo).

## Qué se quiere

Que los avisos de un registro esperen **5 minutos** y se armen con **cómo quedaron** los
registros, para que una corrección en ese rato salga ya corregida. **No** se quieren avisos
de corrección (se descartó un `registro.corregido`).

## Decisiones

1. **Espera: 5 minutos.** Cubre con margen todas las correcciones vistas (la más lenta, 65 s).
2. **Cada corrección reinicia la espera.** Si alguien edita un registro que todavía está
   esperando, la espera vuelve a contar 5 minutos desde esa edición.
3. **Qué espera:** todo lo que hoy dispara un guardado de /registrar: `registro.enviado`,
   `registro.llamativo` y la evaluación de bancos (`banco.nivel`, `banco.al_tope`). El resto
   (HUCHA, ampliaciones de horas, cron diario) sigue saliendo al momento.
4. **Lo que recibe Julián no cambia de forma:** mismos tipos, mismos campos. Solo llega
   entre 5 y 6 minutos más tarde (el reloj mira una vez por minuto) y refleja el estado
   final.
5. **Reloj:** tarea por minuto dentro de Supabase (`pg_cron` + `pg_net`) que llama a la app
   **solo si hay algo vencido**. Descartados: que el n8n de Julián llame cada minuto (los
   pulsos dependerían de su flujo) y esperar dentro del guardado (Vercel Hobby corta las
   funciones a los 300 s, justo la espera).
6. **Clave del reloj:** la misma `CRON_SECRET` de Vercel, copiada en el Vault de Supabase
   por Roberto desde el panel (no pasa por el chat ni por git).
7. Lo que se corrija **después** de que el aviso salió no se corrige.

## Cómo funciona

### Al guardar

`guardarRegistro` (`app/(horas)/registrar/actions.ts`) sigue llamando a `trasResponder`, pero
`alGuardarRegistro` ya no arma avisos: solo **anota una espera**.

1. Averigua los registros de este guardado como hoy: `guardar_registro` devuelve un id y
   los demás se encuentran por su `updated_at` idéntico (todos llevan el mismo `now()`).
   En una edición que parte el registro en otro día, el registro nuevo también sale aquí.
2. Llama a `avisos_esperar_guardado(...)`, que en una sola sentencia:
   - si es una **edición** y el registro editado (el ancla) está en una espera
     **pendiente**, suma los registros de este guardado a esa espera y pone su vencimiento
     a `now() + 5 min`;
   - si no (alta, o edición de algo cuya espera ya se procesó o que nunca la tuvo), crea una
     espera nueva con vencimiento `now() + 5 min` y `es_alta` según el guardado.
3. Solo en producción (`esProduccion()`), igual que hoy. Por eso esto vive en la app y no
   dentro de `guardar_registro`: hay una sola base, y un servidor local no debe anotar
   esperas que luego procese el reloj de producción.

### A los 5 minutos

La app procesa cada espera vencida (`revisarGuardado`):

1. Lee el estado **actual** de sus registros: dueño, fecha, estado y líneas.
2. Descarta los anulados. Si no queda ninguno, la espera se cierra sin avisos.
3. Con lo que queda arma las `lineas` del guardado y el registro de cada día (si dos
   registros del guardado acaban en la misma fecha, el día enlaza el de más horas; a
   igualdad, el que salga primero por id).
4. A partir de ahí hace **lo mismo que hoy** hace `alGuardarRegistro` con esas líneas:
   - `registro.enviado`: uno por fecha, solo si `es_alta`, con `horas_registro` = horas de
     los registros de este guardado en esa fecha y `horas_dia` = total del día.
   - `registro.llamativo`: por fecha, con el total del día en ese momento. La clave
     anti-duplicados no cambia (un estado pasajero ya no la gasta).
   - evaluación de bancos de los proyectos que quedaron, con su origen.
   - Las reglas de persona de prueba, Dirección/Administración y ausencias de hoy se
     aplican igual, evaluadas al procesar.

Con el caso de Estefania: espera creada a las 13:25, la edición de las 13:26 se suma y la
reinicia, a las 13:31 sale **un** pulso del 08/10 con 8 h (Vagheggi 1 h, Abogados
Concursales 2 1 h, Departamento 6 h), nada del 09/10 y ningún llamativo.

### El reloj

Una migración activa `pg_cron` y `pg_net` y programa la tarea `avisos-revisar` cada minuto.
La tarea:

- comprueba en SQL si hay trabajo: esperas pendientes vencidas, esperas reservadas hace más
  de 10 min, o filas de `avisos_salientes` pendientes con `proximo_intento <= now()`;
- **solo si lo hay**, hace `net.http_post` a
  `https://control-horas-theta.vercel.app/api/avisos/revisar` con
  `Authorization: Bearer <secreto>`, leyendo el secreto de `vault.decrypted_secrets`
  (nombre `avisos_cron_secret`) en cada ejecución.

La ruta nueva `POST /api/avisos/revisar` comprueba la clave con `autorizado(req,
process.env.CRON_SECRET)`, procesa las esperas vencidas (`revisarPendientes`) y despacha la
bandeja (`despacharPendientes`).

De paso, los reintentos de la bandeja (5, 30, 120, 720 min), que hoy esperan al siguiente
guardado o al repaso de las 06:00, salen a su hora.

## Datos

Tabla nueva `public.avisos_por_revisar` (migración 0061):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid → profiles | dueño de los registros (para consultar a mano) |
| `log_ids` | uuid[] not null | registros de la espera, sin repetidos |
| `es_alta` | boolean not null | si nació de un alta (solo entonces hay pulso) |
| `vence_at` | timestamptz not null | se reinicia con cada edición que se suma |
| `estado` | text | `pendiente` · `procesando` · `hecha` · `fallida` |
| `intentos` | integer default 0 | |
| `reclamado_at` | timestamptz | |
| `ultimo_error` | text | |
| `created_at` | timestamptz default now() | |

Índice parcial sobre `vence_at` donde `estado = 'pendiente'`. RLS activado; política de
lectura para admin como en `avisos_salientes`; escritura solo por service role.

Funciones (service role, `revoke` a public/anon/authenticated como `avisos_reclamar`):

- `avisos_esperar_guardado(p_user_id uuid, p_log_ids uuid[], p_ancla uuid, p_es_alta boolean, p_espera interval)`:
  sumarse o crear, descrito arriba. Devuelve el id de la espera.
- `avisos_reclamar_revisiones(p_limite integer)`: reserva con `for update skip locked` las
  pendientes vencidas y las `procesando` de hace más de 10 min; suma un intento.

## Si algo falla

- **Falla una espera al procesar:** vuelve a `pendiente` con `ultimo_error` y se reintenta
  al minuto siguiente. Con 3 intentos queda `fallida` (visible por SQL), no se pierde en
  silencio. Cada espera va por separado: una que falla no frena a las demás.
- **La función se corta a mitad:** la espera queda `procesando`; pasados 10 min la tarea
  vuelve a llamar y se rescata, como en la bandeja.
- **El reloj se para** (`pg_cron` o `pg_net` caídos): las esperas se acumulan; el cron diario
  de las 06:00 (`/api/avisos/cron`) también llama a `revisarPendientes` antes de despachar,
  como red.
- **Vercel no responde:** al minuto siguiente la tarea vuelve a llamar, porque sigue habiendo
  trabajo vencido.
- **Falta el secreto en el Vault:** la llamada sale sin clave válida (o no sale) y nada se
  procesa hasta cargarlo. El cron diario de las 06:00 sigue funcionando.
- **Un aviso de la espera falla al encolarse:** se registra en el log como hoy (cada aviso
  por separado) y la espera se cierra igual; el resto de avisos sale.

## Pruebas

Pruebas sin base de datos (Playwright en modo node, como `e2e/avisos-reglas.spec.ts`; las que
siembran escriben en producción, ver memoria «E2E siembran en producción»). La lógica que
arma el guardado a partir del estado actual va en una función pura y se prueba con:

- fecha movida dentro de la espera (el caso de Estefania: un pulso del 08/10 con 8 h);
- un registro anulado (no cuenta; si eran todos, no sale nada);
- dos registros que acaban en la misma fecha (un pulso por fecha, enlaza el de más horas);
- un día que deja de pasar de 10 h (sin llamativo);
- `es_alta` falso (sin pulso, sí llamativo y bancos).

`avisos_esperar_guardado` y `avisos_reclamar_revisiones` se ensayan en producción dentro de
una transacción que acaba en `raise` (no deja rastro), como en la migración 0045.

Comprobación tras desplegar, con los guardados reales siguientes: las esperas pasan a
`hecha`, los avisos salen a los 5–6 minutos del último cambio y `cron.job_run_details` /
`net._http_response` no muestran errores.

## Archivos

- `supabase/migrations/0061_avisos_espera_registro.sql`: extensiones, tabla, funciones y
  tarea `avisos-revisar`.
- `lib/avisos/reglas.ts`: `ESPERA_REGISTRO_MINUTOS = 5` y la función pura que arma el
  guardado desde los registros actuales.
- `lib/avisos/detector-registro.ts`: `alGuardarRegistro` anota la espera;
  `revisarGuardado` arma y emite con el estado actual (reusa lo de hoy).
- `lib/avisos/revisiones.ts` (nuevo): `revisarPendientes()` reserva, procesa y cierra.
- `app/(horas)/registrar/actions.ts`: pasa el ancla (`logId`) a `alGuardarRegistro`.
- `app/api/avisos/revisar/route.ts` (nuevo) y `app/api/avisos/cron/route.ts` (red diaria).
- `e2e/avisos-espera.spec.ts` (nuevo): las pruebas de arriba.
- `docs/avisos/contrato-avisos-v1.md`: entrada en «Cambios de versión» (ver abajo).

## Para Julián

Entrada nueva en «Cambios de versión» del contrato, sin tocar nada de lo que ya mapeó:

> **14/10/2026** · Sin campos nuevos. `registro.enviado`, `registro.llamativo` y los
> `banco.nivel` / `banco.al_tope` que provoca un registro llegan unos **5 minutos después**
> del último cambio de ese registro, y reflejan cómo quedó: si la persona corrige la fecha o
> las horas en ese rato, llega ya corregido; si lo anula, no llega.

## Puesta en marcha

1. Roberto crea en Supabase → Vault el secreto `avisos_cron_secret` con el valor de
   `CRON_SECRET` (la tarea le quita espacios y saltos de línea de los extremos).
2. Se aplica la migración 0061.
3. Push `master:main` con el OK de Roberto (ver memoria «Deploy: siempre a main»).
4. Comprobación:
   - `select jobname, schedule, active from cron.job` → `avisos-revisar` y `avisos-limpieza`.
   - Con el primer guardado real: su espera pasa a `hecha` a los 5–6 minutos y salen sus avisos.
   - `select status_code, error_msg from net._http_response order by created desc limit 5` →
     **202**. Un 401 (clave mal copiada) no cuenta como error para pg_net: `error_msg` sale
     vacío, así que hay que mirar el código.
   - `get_advisors` (security) sin avisos nuevos.

**El orden importa: la migración SIEMPRE antes que el código.** Entre los pasos 2 y 3 el
código viejo sigue armando los avisos al momento y no anota esperas; la tarea solo llamaría
por reintentos de la bandeja, a una ruta que todavía no existe (404), y esos reintentos los
sigue cubriendo el cron diario. Al revés, con el código y sin la migración, la llamada a
`avisos_esperar_guardado` falla en cada guardado (solo queda en el log) y **no sale ningún
aviso de registro**: se pierden, no se acumulan.

**Marcha atrás:** revertir el código no basta; la tarea seguiría llamando cada minuto a una
ruta que ya no existe mientras haya esperas vencidas. Hay que parar el reloj:
`select cron.unschedule('avisos-revisar');`.

## Red si el reloj se para

Si la tarea de cada minuto deja de llamar bien (clave rotada en Vercel y no en Vault, URL
cambiada, `pg_cron` o `pg_net` caídos), las esperas no se pierden:

- **Cada guardado de /registrar** procesa de paso hasta 3 esperas vencidas de cualquiera
  (segundo reloj): en horario de trabajo salen con el siguiente guardado.
- **El cron diario** las procesa lo primero, antes de evaluar bancos y HUCHA, con un solo plazo
  para todo.
- Cuando se procesa una espera vencida hace más de 15 minutos, el log de Vercel lo dice
  (`[avisos] N espera(s) vencida(s) hace más de 15 min`): es la señal de que el reloj se paró.

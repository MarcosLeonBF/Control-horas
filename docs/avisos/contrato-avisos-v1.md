# Avisos de Control de Rentabilidad · Contrato v1

Formato de los avisos que la plataforma envía a los flujos de Zapier o n8n, y de las
consultas que esos flujos pueden hacer a la plataforma.

Versión 1 · 10/09/2026

## Cómo funciona

Hay dos vías:

1. **Avisos (webhook).** Cuando pasa algo, la plataforma hace un `POST` con un JSON a tu
   webhook. Es uno solo para todos los avisos; cada aviso trae su `tipo`.
2. **Consultas.** Para lo que va por calendario, tu flujo hace un `GET` a la plataforma cuando
   quiera (por ejemplo, cada mañana a las 9:00) con una clave, y recibe la lista.

La plataforma solo detecta y manda datos. El canal de Slack, el texto del mensaje y a quién le
llega se deciden en tu flujo.

## Configurar el webhook

1. En Zapier crea un *Catch Raw Hook* (o *Catch Hook*); en n8n, un nodo *Webhook* con método
   `POST`. Copia su URL.
2. En la plataforma, **Administración → Avisos**, pega la URL. Es una sola para todos los
   avisos.
3. Activa los tipos de aviso que quieras recibir. Se pueden activar de uno en uno y pausar
   cualquiera sin tocar los demás.
4. Pulsa **Enviar prueba** en cada tipo. Tu herramienta recibe un ejemplo real de ese tipo y
   ya puedes mapear sus campos. La prueba funciona aunque el tipo todavía no esté activo.

Para separar los avisos en tu flujo, usa el campo `tipo` del cuerpo (o la cabecera
`X-Avisos-Tipo`): en n8n, un nodo *Switch* después del Webhook; en Zapier, *Paths* o un
*Filter* por cada tipo.

## Lo que llega en cada aviso

### Cabeceras

| Cabecera | Contenido |
|---|---|
| `Content-Type` | `application/json` |
| `X-Avisos-Id` | Identificador único del aviso (el mismo que `id` en el cuerpo) |
| `X-Avisos-Tipo` | Tipo de aviso, por ejemplo `registro.enviado` |
| `X-Avisos-Firma` | `t=<segundos unix>,v1=<firma hex>` (ver «Verificar la firma») |

### Cuerpo

Todos los avisos llegan con el mismo sobre:

```json
{
  "id": "3f1c2a9e-7b4d-4e2a-9c1f-5a8b6d0e2f11",
  "tipo": "registro.enviado",
  "version": 1,
  "fecha": "2026-09-14T15:32:10.412Z",
  "prueba": false,
  "datos": { }
}
```

| Campo | Qué es |
|---|---|
| `id` | Identificador único. Si un aviso llega dos veces, trae el mismo `id` |
| `tipo` | Uno de los tipos de la lista de abajo |
| `version` | Versión del contrato (hoy, `1`) |
| `fecha` | Momento en que ocurrió el hecho, en UTC |
| `prueba` | `true` si viene del botón «Enviar prueba» |
| `datos` | Depende del tipo (ver cada aviso) |

## Entrega y reintentos

- Tu flujo tiene que responder con un código **2xx en menos de 5 segundos**. Zapier y n8n
  lo hacen solos al recibir el webhook.
- Si no responde o da error, se reintenta a los 5 min, 30 min, 2 h y 12 h (máximo 5
  intentos). Los reintentos salen cuando hay actividad en la plataforma o en la revisión
  diaria, así que pueden tardar algo más.
- La revisión diaria corre a las 06:00 UTC (las 8:00 en Madrid en verano y las 7:00 en
  invierno) y puede llegar hasta una hora más tarde.
- Por los reintentos, **un aviso puede llegar repetido**. Usa `id` para descartarlo.
- Solo la plataforma en producción envía avisos reales. Los de prueba llevan `"prueba": true`.

## Verificar la firma (recomendado)

Cada envío va firmado con una clave secreta que te pasamos aparte. La firma es un
HMAC-SHA256 de `"<t>.<cuerpo tal cual llegó>"`. Para verificarla necesitas el cuerpo sin
procesar: en n8n activa *Raw Body* en el nodo Webhook; en Zapier usa *Catch Raw Hook*.

Ejemplo en JavaScript (sirve para un nodo *Code* de n8n o *Code by Zapier*):

```js
const crypto = require('crypto')

function firmaValida(cabecera, cuerpoCrudo, secreto) {
  const partes = Object.fromEntries(cabecera.split(',').map((p) => p.split('=')))
  const esperada = crypto.createHmac('sha256', secreto).update(`${partes.t}.${cuerpoCrudo}`).digest('hex')
  const reciente = Math.abs(Date.now() / 1000 - Number(partes.t)) < 300 // 5 minutos
  return reciente && esperada.length === partes.v1.length &&
    crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(partes.v1))
}
```

## Objetos que se repiten

**Persona**

```json
{ "id": "a1b2…", "nombre": "Laura Gómez", "email": "laura.gomez@ejemplo.com", "posicion": "SEO Strategist", "equipo": "Clientes", "rol": "operativo" }
```

**Manager** (`manager_directo`, `manager_proyecto`, cada elemento de `managers`)

```json
{ "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" }
```

- `manager_directo` es `null` si la persona todavía no tiene manager directo asignado.
- En `manager_proyecto`, si el nombre que viene del Excel no coincide con ningún usuario,
  llega `{ "id": null, "nombre": "<nombre del Excel>", "email": null, "equipo": null }`. Si
  el proyecto no tiene manager en el Excel, llega `null`.

**`equipo`: a qué parte de la empresa pertenece esa persona**

Lo llevan **todas** las personas del payload: `persona`, `manager_directo`,
`manager_proyecto`, cada elemento de `managers` y el `actor` de las ampliaciones
(`hucha.ampliacion` y `banco.ampliacion`). Es el campo pensado para enrutar: a qué canal va
el mensaje, quién lo recibe.

- Valores: los que haya dados de alta en la app. Hoy `"Clientes"` y `"RRHH"`; **la lista
  crece**, así que conviene tratarla como abierta y tener una rama por defecto.
- `null` significa *esa persona todavía no tiene equipo asignado* (o, en un manager que
  viene por nombre del Excel, que no se pudo identificar). No es un error: el aviso sale
  igual y hay que contemplarlo.
- Es el equipo de la persona, no el del proyecto. En un aviso de banco, `manager_proyecto.equipo`
  es el equipo del manager, no el del proyecto.
- **No confundir con el `department` de una línea de horas** (`Clientes`, `Ventas`,
  `Marketing`, `Todos`). Son dos listas distintas de la app, y aunque algún nombre coincida
  no significan lo mismo. El `department` no viaja en los avisos.

**Enlaces a un registro** (`enlace_registro`, y `registro.enlace` en los avisos de banco)

Llevan a `https://<dominio>/registros/<id>`: la ficha de solo lectura de un registro
diario, con sus líneas (proyecto, área o departamento, etapa, horas y descripción).

- **Hace falta sesión.** Quien lo abra sin haber entrado pasa por el login y, al entrar,
  vuelve a ese registro.
- **Lo ve quien ya podía verlo en la plataforma:** la persona que lo hizo, su manager y
  Administración. Cualquier otra persona ve «Registro no disponible», igual que si no
  existiera. Tenlo en cuenta al elegir a quién le llega el mensaje con el enlace.
- **Enseña el registro como está ahora.** Si se editó o se anuló después del aviso, se ve
  el cambio (y los anulados lo indican).

**Niveles de un banco o de una HUCHA**

| Nivel | Significa |
|---|---|
| `disponible` | Queda el 20% o más |
| `bajo` | Queda menos del 20% |
| `consumido` | No queda nada (100%) |
| `excedido` | Se ha consumido más de lo asignado |

## Avisos

### `registro.enviado`

Cada vez que alguien da de alta un registro (el pulso): uno por cada alta y día. Si alguien
registra dos veces el mismo día llegan dos, cada uno con sus horas en `horas_registro` y el
total acumulado del día en `horas_dia`. Las ediciones no envían pulso.

| Campo | Qué es |
|---|---|
| `persona` | Quién registra |
| `manager_directo` | Su manager directo o `null` |
| `dia` | Día registrado (`YYYY-MM-DD`) |
| `horas_registro` | Horas de este registro |
| `horas_dia` | Total del día (si ha hecho varios registros ese día, los suma) |
| `proyectos` | Reparto de este registro por proyecto |
| `proyectos_texto` | El mismo reparto en una línea, listo para un mensaje |
| `enlace_registro` | Enlace a este registro en la plataforma (ver «Enlaces a un registro») |

```json
{
  "id": "3f1c2a9e-7b4d-4e2a-9c1f-5a8b6d0e2f11",
  "tipo": "registro.enviado",
  "version": 1,
  "fecha": "2026-09-14T15:32:10.412Z",
  "prueba": false,
  "datos": {
    "persona": { "id": "a1b2…", "nombre": "Laura Gómez", "email": "laura.gomez@ejemplo.com", "posicion": "SEO Strategist", "equipo": "Clientes", "rol": "operativo" },
    "manager_directo": { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" },
    "dia": "2026-09-14",
    "horas_registro": 7.5,
    "horas_dia": 7.5,
    "proyectos": [
      { "proyecto": "Proyecto Ejemplo", "horas": 5 },
      { "proyecto": "Departamento", "horas": 2.5 }
    ],
    "proyectos_texto": "Proyecto Ejemplo (5 h), Departamento (2,5 h)",
    "enlace_registro": "https://<dominio>/registros/7c2e…"
  }
}
```

### `registro.llamativo`

Cuando un día se sale de lo normal. Un aviso por persona, día, regla y proyecto (en
`proyecto_largo`, uno por cada proyecto que llegue al límite). No se repite aunque la
persona vuelva a editar ese día.

| Regla | Cuándo salta |
|---|---|
| `dia_largo` | Más de 10 h registradas en el día |
| `proyecto_largo` | 6 h o más a un mismo proyecto en el día (Departamento no cuenta) |

| Campo | Qué es |
|---|---|
| `persona`, `manager_directo`, `dia` | Como en `registro.enviado` |
| `regla` | `dia_largo` o `proyecto_largo` |
| `valor` / `limite` | Lo registrado y el límite de la regla |
| `proyecto` | El proyecto en `proyecto_largo`; `null` en `dia_largo` |
| `horas_dia` | Total del día |
| `descripcion` | Frase lista para un mensaje |
| `enlace_registro` | Enlace al registro que hizo llamativo el día. El día puede tener otros registros: `horas_dia` los suma todos |

```json
{
  "tipo": "registro.llamativo",
  "datos": {
    "persona": { "id": "a1b2…", "nombre": "Laura Gómez", "email": "laura.gomez@ejemplo.com", "posicion": "SEO Strategist", "equipo": "Clientes", "rol": "operativo" },
    "manager_directo": { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" },
    "dia": "2026-09-14",
    "regla": "dia_largo",
    "valor": 11,
    "limite": 10,
    "proyecto": null,
    "horas_dia": 11,
    "descripcion": "11 h registradas el 14/09 (límite: 10 h)",
    "enlace_registro": "https://<dominio>/registros/7c2e…"
  }
}
```

(En este y los siguientes ejemplos se omite el resto del sobre: `id`, `version`, `fecha` y
`prueba` llegan siempre.)

### `banco.nivel`

Cuando el banco de horas de un proyecto, o de una posición dentro del proyecto, **empeora** de
nivel (pasa a `bajo`, `consumido` o `excedido`). Solo proyectos activos. Si el banco mejora
(por ejemplo, tras una ampliación) no se avisa, pero si vuelve a empeorar se avisa de nuevo.

| Campo | Qué es |
|---|---|
| `proyecto` | Nombre del proyecto |
| `alcance` | `posicion` o `proyecto` (total del proyecto) |
| `posicion` | La posición (`SEO Strategist`, `CRM`…) o `null` si el alcance es `proyecto` |
| `nivel` / `nivel_anterior` | Nivel nuevo y el que tenía |
| `horas.asignadas` | Horas del banco (en el total del proyecto incluye las ampliaciones) |
| `horas.ampliadas` | Horas ampliadas (solo en el total del proyecto; `0` por posición) |
| `horas.consumidas` | Horas registradas |
| `horas.inutilizables` | Horas perdidas en el cierre de meses anteriores (reparto 75/25) |
| `horas.disponibles` | Lo que queda de verdad |
| `porcentaje_consumido` | Sobre la base efectiva, con un decimal |
| `estado_proyecto` | Estado en el Excel (`Activo`) |
| `manager_proyecto` | Manager del proyecto según el Excel |
| `enlace` | Ficha del banco en la plataforma |
| `registro` | El registro que hizo caer el banco: `{ persona, dia, enlace }`, o `null` |

`registro` dice **por el registro de quién** bajó el banco: la `persona` (mismo objeto que
en todos los avisos), el `dia` del registro y el `enlace` para abrirlo. Llega en `null`
cuando la caída no la provocó un registro: la revisión diaria, una sincronización del
Excel o anular una ampliación. Si un mismo guardado tocó el proyecto en varios días, se
enlaza el del día más reciente.

```json
{
  "tipo": "banco.nivel",
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "alcance": "posicion",
    "posicion": "SEO Strategist",
    "nivel": "bajo",
    "nivel_anterior": "disponible",
    "horas": { "asignadas": 40, "ampliadas": 0, "consumidas": 33.5, "inutilizables": 0, "disponibles": 6.5 },
    "porcentaje_consumido": 83.8,
    "estado_proyecto": "Activo",
    "manager_proyecto": { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" },
    "enlace": "https://<dominio>/bancos/Proyecto%20Ejemplo",
    "registro": {
      "persona": { "id": "a1b2…", "nombre": "Laura Gómez", "email": "laura.gomez@ejemplo.com", "posicion": "SEO Strategist", "equipo": "Clientes", "rol": "operativo" },
      "dia": "2026-09-14",
      "enlace": "https://<dominio>/registros/7c2e…"
    }
  }
}
```

El día 1 de cada mes, a las 00:00 UTC, se cierra el mes anterior y el reparto 75/25 puede
empeorar varios bancos a la vez: ese día es normal que llegue una tanda de avisos.

### `banco.al_tope`

Cuando el **total** de un proyecto llega al 100% (`consumido`) o lo supera (`excedido`)
viniendo de un nivel más bajo. Pensado para avisar al manager y ofrecer más horas. Mismos
campos que `banco.nivel` con `alcance: "proyecto"`.

Llega **junto con** el `banco.nivel` de ese mismo cambio (con los mismos datos). Si en un
flujo solo te interesa el tope, escucha este tipo y no el otro.

Si el proyecto pasa de `consumido` a `excedido` llega un `banco.nivel`, pero no un segundo
`banco.al_tope`. Si se amplía y más adelante vuelve a llegar al tope, se avisa otra vez.

```json
{
  "tipo": "banco.al_tope",
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "alcance": "proyecto",
    "posicion": null,
    "nivel": "consumido",
    "nivel_anterior": "bajo",
    "horas": { "asignadas": 120, "ampliadas": 20, "consumidas": 120, "inutilizables": 0, "disponibles": 0 },
    "porcentaje_consumido": 100,
    "estado_proyecto": "Activo",
    "manager_proyecto": { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" },
    "enlace": "https://<dominio>/bancos/Proyecto%20Ejemplo",
    "registro": {
      "persona": { "id": "a1b2…", "nombre": "Laura Gómez", "email": "laura.gomez@ejemplo.com", "posicion": "SEO Strategist", "equipo": "Clientes", "rol": "operativo" },
      "dia": "2026-09-14",
      "enlace": "https://<dominio>/registros/7c2e…"
    }
  }
}
```

`registro` es el registro que llevó el proyecto al tope: quién lo hizo, qué día y el
enlace, igual que en `banco.nivel`. Llega en `null` si el tope no lo provocó un registro
(por ejemplo, si lo detectó la revisión diaria o una sincronización del Excel).

### `banco.ampliacion`

Cuando alguien amplía las horas del banco de un proyecto. Es el equivalente en horas de
`hucha.ampliacion`. Solo avisa al ampliar: anular una ampliación no envía nada.

| Campo | Qué es |
|---|---|
| `proyecto` | Nombre del proyecto |
| `horas_ampliacion` | Horas de **esta** ampliación |
| `motivo` | El motivo que se escribió al ampliar |
| `dia` | Día de la ampliación (`YYYY-MM-DD`) |
| `actor` | Quien amplió: `{ nombre, email, equipo }` |
| `horas` | El banco del proyecto **después** de ampliar (mismo objeto que en `banco.nivel`) |
| `nivel` | Nivel del banco después de ampliar |
| `porcentaje_consumido` | Sobre la base efectiva, igual que en `banco.nivel` |
| `manager_proyecto` | Manager del proyecto según el Excel |
| `enlace` | Enlace al banco del proyecto |

No confundir `horas_ampliacion` (lo que se sumó ahora) con `horas.ampliadas` (el total
ampliado del proyecto, esta incluida).

**`horas`, `nivel`, `porcentaje_consumido` y `manager_proyecto` pueden llegar en `null`.**
Salen del Excel de SharePoint: si en ese momento no responde, o si el proyecto no está
activo, el aviso llega igual con esos cuatro campos en `null`. Lo que no depende del Excel
(proyecto, horas de la ampliación, motivo, día, quién la hizo y el enlace) llega siempre.

```json
{
  "tipo": "banco.ampliacion",
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "horas_ampliacion": 20,
    "motivo": "Ampliación aprobada por el cliente",
    "dia": "2026-09-18",
    "actor": { "nombre": "Marta López", "email": "marta.lopez@ejemplo.com", "equipo": "RRHH" },
    "horas": { "asignadas": 180, "ampliadas": 20, "consumidas": 120, "inutilizables": 0, "disponibles": 60 },
    "nivel": "disponible",
    "porcentaje_consumido": 66.7,
    "manager_proyecto": { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" },
    "enlace": "https://<dominio>/bancos/Proyecto%20Ejemplo"
  }
}
```

### `hucha.proyecto_nuevo`

Cuando entra un proyecto nuevo con presupuesto al sincronizar el Excel de HUCHA (hoy la
sincronización la lanza un administrador desde la plataforma).

```json
{
  "tipo": "hucha.proyecto_nuevo",
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "proyecto_id": "e5f6…",
    "presupuesto": 2500,
    "moneda": "EUR",
    "managers": [ { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" } ],
    "enlace": "https://<dominio>/presupuestos/e5f6…"
  }
}
```

`managers` puede venir vacío si el manager del Excel todavía no existe como usuario.

### `hucha.ampliacion`

Cuando se amplía el presupuesto de una HUCHA.

```json
{
  "tipo": "hucha.ampliacion",
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "proyecto_id": "e5f6…",
    "importe": 500,
    "moneda": "EUR",
    "motivo": "Ampliación aprobada por el cliente",
    "referencia": "PO-2026-118",
    "dia": "2026-09-14",
    "actor": { "nombre": "Marta López", "email": "marta.lopez@ejemplo.com", "equipo": "RRHH" },
    "saldo": { "asignado": 3000, "consumido": 2450, "disponible": 550 },
    "nivel": "bajo",
    "managers": [ { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" } ],
    "enlace": "https://<dominio>/presupuestos/e5f6…"
  }
}
```

`referencia` puede ser `null`. `nivel` también, cuando la HUCHA no tiene presupuesto.

### `hucha.nivel`

Cuando una HUCHA **empeora** de nivel (`bajo`, `consumido`, `excedido`). «Agotada» es
`consumido` o `excedido`. Igual que en los bancos, si mejora no se avisa y si vuelve a
empeorar sí.

```json
{
  "tipo": "hucha.nivel",
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "proyecto_id": "e5f6…",
    "nivel": "consumido",
    "nivel_anterior": "bajo",
    "moneda": "EUR",
    "saldo": { "asignado": 3000, "consumido": 3000, "disponible": 0 },
    "managers": [ { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" } ],
    "enlace": "https://<dominio>/presupuestos/e5f6…"
  }
}
```

## Consultas

Se autentican con la cabecera `Authorization: Bearer <clave>`. La clave se pasa aparte. Sin
clave o con una clave incorrecta, la respuesta es `401`.

### Resumen de capacidad

```
GET https://<dominio>/api/avisos/v1/resumen-capacidad
```

Pensado para el resumen quincenal. **Solo proyectos activos** (Estado «Activo» en el Excel)
y **sin tope**: cada lista trae **todos** los proyectos activos, lo único que cambia entre
listas es el orden. No hay parámetro `top` (si tu llamada lo pasa, se ignora). Quedan fuera
los activos sin ninguna hora asignada ni consumida. Cuatro listas:

- `con_mas_horas`: los que tienen más horas disponibles.
- `mas_libres`: los que llevan menos porcentaje consumido.
- `con_menos_horas`: los que tienen menos horas disponibles (primero los que se pasaron).
- `menos_libres`: los que llevan más porcentaje consumido.

`porcentaje_consumido` es `null` cuando el proyecto no tiene base efectiva: no le quedan
horas asignadas después del corte del cierre de mes (reparto 75/25). Esos proyectos no
salen en `mas_libres` ni en `menos_libres`. `porcentaje_disponible` es lo que falta hasta
100 (negativo si se pasó), o `null` en el mismo caso.

```json
{
  "generado": "2026-09-16T07:00:02.118Z",
  "con_mas_horas": [
    {
      "proyecto": "Proyecto Ejemplo",
      "horas": { "asignadas": 160, "ampliadas": 0, "consumidas": 40, "inutilizables": 12, "disponibles": 108 },
      "porcentaje_consumido": 27,
      "porcentaje_disponible": 73,
      "manager_proyecto": { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" },
      "enlace": "https://<dominio>/bancos/Proyecto%20Ejemplo"
    }
  ],
  "mas_libres": [ ],
  "con_menos_horas": [ ],
  "menos_libres": [ ]
}
```

### Resumen de HUCHA

```
GET https://<dominio>/api/avisos/v1/resumen-hucha
```

El mismo resumen que el de capacidad, pero del **presupuesto de HUCHA** (dinero) en vez
del banco de horas. **Sin tope:** cada lista trae **todos** los proyectos activos con
HUCHA, no hay parámetro `top`. Mismas cuatro listas con los mismos criterios:

- `con_mas_presupuesto`: los que tienen más presupuesto disponible.
- `mas_libres`: los que llevan menos porcentaje consumido.
- `con_menos_presupuesto`: los que tienen menos presupuesto disponible (primero los que
  se pasaron).
- `menos_libres`: los que llevan más porcentaje consumido.

Diferencias con el de capacidad:

- `presupuesto` es el mismo objeto `{ asignado, consumido, disponible }` que llega como
  `saldo` en los avisos `hucha.*`. El `asignado` ya incluye las ampliaciones, así que no
  hay campo `ampliadas` aparte.
- No salen los proyectos sin presupuesto (sin nada asignado ni consumido), ni los
  archivados.
- Las cuatro listas traen los mismos proyectos en distinto orden, salvo que `mas_libres` y
  `menos_libres` dejan fuera los que tienen `porcentaje_consumido` en `null`.
- Los responsables vienen en `managers` (una lista, como en los avisos `hucha.*`), no en
  `manager_proyecto`. Puede llegar vacía si el proyecto no tiene managers asignados.
- `porcentaje_consumido` es `null` si el proyecto no tiene nada asignado pero sí algo
  gastado. Esos no salen en `mas_libres` ni en `menos_libres`.
- No depende del Excel de SharePoint: todo sale de la base de la plataforma.

```json
{
  "generado": "2026-09-18T07:00:01.502Z",
  "con_mas_presupuesto": [
    {
      "proyecto": "Proyecto Ejemplo",
      "proyecto_id": "e5f6…",
      "presupuesto": { "asignado": 3000, "consumido": 2450, "disponible": 550 },
      "moneda": "EUR",
      "nivel": "bajo",
      "porcentaje_consumido": 81.7,
      "porcentaje_disponible": 18.3,
      "managers": [ { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" } ],
      "enlace": "https://<dominio>/presupuestos/e5f6…"
    }
  ],
  "mas_libres": [ ],
  "con_menos_presupuesto": [ ],
  "menos_libres": [ ]
}
```

### Días sin registrar

```
GET https://<dominio>/api/avisos/v1/dias-sin-registrar?fecha=2026-09-16
```

Pensado para una ejecución diaria. `fecha` es opcional (por defecto, hoy en hora de Madrid);
si llega con un formato que no sea `YYYY-MM-DD`, la respuesta es `400`.
Cuenta hacia atrás desde el día anterior a `fecha` los días laborables (de lunes a viernes,
sin festivos) seguidos en los que la persona no ha registrado nada. Solo aparecen las personas
con al menos un día pendiente. Un registro en Departamento (por ejemplo, vacaciones) cuenta
como día registrado.

| Campo | Qué es |
|---|---|
| `dias` | Días laborables seguidos sin registrar |
| `desde` | El día pendiente más antiguo |
| `ultimo_registro` | Último día que registró dentro de los últimos 90 días (`null` si no hay ninguno en ese periodo) |
| `dentro_de_plazo` | `true` si todavía puede registrar el día más antiguo por su cuenta (la plataforma deja registrar 7 días hacia atrás salvo ampliación) |
| `manager_directo` | Su manager directo o `null` |

```json
{
  "fecha": "2026-09-16",
  "personas": [
    {
      "persona": { "id": "a1b2…", "nombre": "Laura Gómez", "email": "laura.gomez@ejemplo.com", "posicion": "SEO Strategist", "equipo": "Clientes", "rol": "operativo" },
      "manager_directo": { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" },
      "dias": 2,
      "desde": "2026-09-14",
      "ultimo_registro": "2026-09-11",
      "dentro_de_plazo": true
    }
  ]
}
```

Con esto se monta la escalera de recordatorios en el flujo: `dias = 1`, aviso a la persona;
`dias = 2`, a la persona con un tono más serio; `dias >= 3`, también a `manager_directo`.

## Reglas por defecto

Son las que hay para empezar y se ajustan tras la reunión del lunes 14/09:

- Banco o HUCHA bajo: queda menos del 20%.
- Registro llamativo: más de 10 h en el día, o 6 h o más a un mismo proyecto.
- Solo proyectos activos.
- Al encender el sistema no se avisa de lo que ya estaba bajo o excedido. Solo de los
  cambios a partir de ese momento.

## Cambios de versión

Los campos nuevos se añadirán sin cambiar la versión y sin romper lo que ya funciona. Si
algún día hay que cambiar o quitar un campo, saldrá como `version: 2` y se avisará antes.

**18/09/2026** · Se añade `equipo` a todas las personas del payload (`persona`,
`manager_directo`, `manager_proyecto`, cada `managers` y el `actor` de `hucha.ampliacion`).
Sigue siendo `version: 1`: es un campo nuevo y nada de lo anterior cambia, así que los
flujos que ya funcionan siguen funcionando sin tocar nada. Al principio llegará `null` en
casi todo el mundo, hasta que Administración termine de asignar los equipos.

**18/09/2026** · Dos cosas nuevas, ninguna cambia lo que ya existe:

- Aviso nuevo **`banco.ampliacion`**: cuando se amplían las horas del banco de un
  proyecto. Llega **apagado**: hay que activarlo en Administración → Avisos, y ya tiene su
  «Enviar prueba».
- Consulta nueva **`resumen-hucha`**: el resumen de capacidad, pero del presupuesto de
  HUCHA, y sin tope: trae todos los proyectos activos con HUCHA.
- **Cambio en `resumen-capacidad`: ya no hay tope.** Cada lista trae todos los proyectos
  activos, no los `top` primeros; si tu llamada pasa `?top=`, se ignora. Si tu flujo arma
  un mensaje recorriendo las listas, ahora le llegan listas completas: conviene revisar
  cuántos proyectos muestra.

De paso se completa la sección del resumen de capacidad, que solo nombraba dos de sus
cuatro listas (`con_menos_horas` y `menos_libres` ya llegaban, no es un cambio).

**18/09/2026** · Enlaces al registro, campos nuevos sin cambiar nada de lo anterior:

- `registro.enviado` y `registro.llamativo` traen `enlace_registro`.
- `banco.nivel` y `banco.al_tope` traen `registro`: por el registro de quién bajó el
  banco, o `null` si no lo provocó un registro.
- Ver «Enlaces a un registro» para quién puede abrirlos.

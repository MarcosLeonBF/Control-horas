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
`manager_proyecto`, cada elemento de `managers` y el `actor` de `hucha.ampliacion`. Es el
campo pensado para enrutar: a qué canal va el mensaje, quién lo recibe.

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
    "proyectos_texto": "Proyecto Ejemplo (5 h), Departamento (2,5 h)"
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
    "descripcion": "11 h registradas el 14/09 (límite: 10 h)"
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
    "enlace": "https://<dominio>/bancos/Proyecto%20Ejemplo"
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
GET https://<dominio>/api/avisos/v1/resumen-capacidad?top=10
```

Pensado para el resumen quincenal. `top` va de 1 a 50 (por defecto, 10). Solo proyectos
activos.

- `con_mas_horas`: los proyectos con más horas disponibles.
- `mas_libres`: los proyectos con menos porcentaje consumido.

`porcentaje_consumido` es `null` cuando el proyecto no tiene base efectiva: no le quedan
horas asignadas después del corte del cierre de mes (reparto 75/25). Esos proyectos no
salen en `mas_libres`.

```json
{
  "generado": "2026-09-16T07:00:02.118Z",
  "top": 10,
  "con_mas_horas": [
    {
      "proyecto": "Proyecto Ejemplo",
      "horas": { "asignadas": 160, "ampliadas": 0, "consumidas": 40, "inutilizables": 12, "disponibles": 108 },
      "porcentaje_consumido": 27,
      "manager_proyecto": { "id": "c3d4…", "nombre": "Carlos Ruiz", "email": "carlos.ruiz@ejemplo.com", "equipo": "Clientes" },
      "enlace": "https://<dominio>/bancos/Proyecto%20Ejemplo"
    }
  ],
  "mas_libres": [ ]
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

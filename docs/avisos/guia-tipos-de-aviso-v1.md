# Avisos y consultas de Control de Rentabilidad

Qué llega al webhook en cada aviso y qué devuelve la API de consultas.

Versión 1 · 11/09/2026

Este documento amplía el contrato v1 con un ejemplo completo de cada aviso y de cada
consulta. Los ejemplos van con saltos de línea para que se lean bien; el cuerpo real llega en
una sola línea.

## 1. De un vistazo

**Avisos.** La plataforma los envía por su cuenta al webhook cuando pasa algo.

| Aviso | Se envía cuando | Momento | Volumen |
|---|---|---|---|
| `registro.enviado` | Alguien da de alta un registro de horas | Al guardar | Alto: cerca de uno por persona y día laborable |
| `registro.llamativo` | Un día supera las 10 h, o tiene 6 h o más a un mismo proyecto | Al guardar (alta o edición) | Ocasional |
| `banco.nivel` | Un banco de horas (de una posición o del total del proyecto) empeora de nivel | Al guardar o en la revisión diaria | Ocasional, a veces varios juntos |
| `banco.al_tope` | El total de un proyecto llega al 100 % o lo supera | Junto con su `banco.nivel` | Raro |
| `hucha.proyecto_nuevo` | Entra un proyecto nuevo con presupuesto al sincronizar el Excel de HUCHA | Cuando un administrador sincroniza | Varios seguidos |
| `hucha.ampliacion` | Se amplía el presupuesto de una HUCHA | Al guardar | Raro |
| `hucha.nivel` | Una HUCHA empeora de nivel | Al guardar o en la revisión diaria | Ocasional |

**Consultas.** Se piden a la plataforma cuando se quiera.

| Consulta | Devuelve | Parámetro |
|---|---|---|
| `GET /api/avisos/v1/resumen-capacidad` | Los proyectos activos con más horas disponibles y los que llevan menos porcentaje consumido | `top` (opcional) |
| `GET /api/avisos/v1/dias-sin-registrar` | Las personas que llevan días laborables seguidos sin registrar hasta una fecha | `fecha` (opcional) |

**Al guardar** quiere decir unos segundos después de que alguien guarde en la plataforma.

La **revisión diaria** corre todos los días a las 06:00 UTC (las 08:00 en Madrid en horario de
verano y las 07:00 en invierno). Detecta lo que cambia sin que nadie guarde nada, como el Excel
de bancos o el cierre de mes, y reenvía los avisos que tengan un reintento pendiente.

## 2. Cómo llega un aviso

### La petición

Cada aviso es un `POST` a la URL del webhook, que es una sola para todos los tipos. El cuerpo
es JSON codificado en UTF-8, en una sola línea.

| Cabecera | Contenido |
|---|---|
| `Content-Type` | `application/json` |
| `X-Avisos-Id` | Identificador del aviso. Es el mismo valor que `id` en el cuerpo |
| `X-Avisos-Tipo` | Tipo de aviso. Es el mismo valor que `tipo` en el cuerpo |
| `X-Avisos-Firma` | `t=<segundos unix>,v1=<firma>` (ver «La firma») |

### El sobre

Todos los avisos llevan el mismo sobre. Lo que cambia de un tipo a otro es `datos`.

```json
{
  "id": "3f1c2a9e-7b4d-4e2a-9c1f-5a8b6d0e2f11",
  "tipo": "registro.enviado",
  "version": 1,
  "fecha": "2026-09-14T15:32:10.412Z",
  "prueba": false,
  "datos": {}
}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `id` | texto (UUID) | Identificador único del aviso. Si el mismo aviso llega dos veces, trae el mismo `id` |
| `tipo` | texto | Uno de los siete tipos de la tabla anterior |
| `version` | número | Versión del contrato. Hoy siempre `1` |
| `fecha` | fecha y hora UTC | Momento en que ocurrió el hecho. No cambia entre reintentos |
| `prueba` | booleano | `true` si viene del botón «Enviar prueba»; `false` en los avisos reales |
| `datos` | objeto | El contenido del aviso. Depende del tipo (apartado 3) |

### Entrega y reintentos

- Un aviso se da por entregado cuando el webhook responde con un código 2xx en menos de 5
  segundos. Para eso solo cuenta el código, no el cuerpo de la respuesta.
- Si no hay respuesta a tiempo o el código no es 2xx, se reintenta a los 5 minutos, a los 30
  minutos, a las 2 horas y a las 12 horas. Son 5 intentos en total; después el aviso queda
  como fallido.
- Los reintentos no tienen hora fija: salen la próxima vez que alguien guarde en la plataforma
  algo que pueda generar avisos (un registro, una ampliación, un gasto de HUCHA…) o, como muy
  tarde, en la revisión diaria. Un reintento «a los 5 minutos» puede salir más tarde.
- Por los reintentos, un mismo aviso puede llegar más de una vez. Llega con el mismo `id` y la
  misma `fecha`; solo cambia el `t` de la firma.
- El orden de llegada no está garantizado: un reintento puede llegar después de un aviso más
  nuevo. `fecha` indica cuándo ocurrió cada cosa.
- Un solo guardado puede generar varios avisos a la vez: el pulso, algún registro llamativo y
  los cambios de nivel de los bancos afectados.
- Cuando la respuesta es un error, la plataforma guarda el código y los primeros 500
  caracteres del cuerpo en el historial de envíos (apartado 7).

### La firma

Todos los envíos van firmados, también las pruebas. La clave de firma se entrega aparte.

```
X-Avisos-Firma: t=1757851930,v1=5dae7559f136b97314806773982eb26b8d92158a7712f268ad95314e6440bfb9
```

- `t` es el momento del envío en segundos Unix. Cambia en cada reintento.
- `v1` es el HMAC-SHA256, en hexadecimal y minúsculas, del texto `<t>.<cuerpo>`: el valor de
  `t`, un punto y el cuerpo exactamente como llega, sin volver a formatearlo.

Vector de comprobación:

| Dato | Valor |
|---|---|
| Clave | `secreto-de-prueba` |
| `t` | `1757851930` |
| Cuerpo | `{"id":"3f1c2a9e","tipo":"registro.enviado"}` |
| `v1` resultante | `5dae7559f136b97314806773982eb26b8d92158a7712f268ad95314e6440bfb9` |

### Avisos de prueba

En **Administración → Avisos** hay un botón **Enviar prueba** por cada tipo.

- Manda los mismos `datos` que aparecen en los ejemplos de este documento, con
  `"prueba": true`. El `id` y la `fecha` son nuevos en cada prueba, y los enlaces apuntan al
  dominio real de la plataforma.
- Sale aunque el tipo esté pausado. Basta con que haya una URL guardada.
- No se reintenta. El resultado (el código HTTP o el error) se ve en ese momento en la pantalla.

### Tipos pausados y primer encendido

- Cada tipo se activa o se pausa por separado. Lo que ocurre mientras un tipo está pausado no se
  guarda para después: al activarlo solo llegan los avisos nuevos.
- Al encender el sistema, la plataforma anota el nivel de cada banco y de cada HUCHA sin enviar
  nada. A partir de ahí solo avisa de los cambios.

### Datos que se repiten

**Persona** (`persona` y, en las consultas, cada persona de la lista)

```json
{
  "id": "00000000-0000-4000-8000-00000000a1b2",
  "nombre": "Laura Gómez",
  "email": "laura.gomez@ejemplo.com",
  "posicion": "SEO Strategist",
  "rol": "operativo"
}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `id` | texto (UUID) | Identificador del usuario en la plataforma |
| `nombre` | texto | Nombre completo |
| `email` | texto | Email con el que entra en la plataforma |
| `posicion` | texto o `null` | Posición asignada (`SEO Strategist`, `CRM`…). `null` si no tiene |
| `rol` | texto | Rol en la plataforma: `operativo`, `manager` o `admin` |

**Manager** (`manager_directo`, `manager_proyecto` y cada elemento de `managers`)

```json
{
  "id": "00000000-0000-4000-8000-00000000c3d4",
  "nombre": "Carlos Ruiz",
  "email": "carlos.ruiz@ejemplo.com"
}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `id` | texto (UUID) o `null` | Identificador del usuario |
| `nombre` | texto | Nombre completo |
| `email` | texto o `null` | Email con el que entra en la plataforma |

De dónde sale cada uno:

- **`manager_directo`**: el manager que tiene asignado la persona en su ficha de usuario. Llega
  `null` si no tiene. El dato es nuevo, así que llegará `null` hasta que se asigne en la ficha
  de cada persona.
- **`manager_proyecto`**: el Excel de bancos trae el nombre del manager de cada proyecto, y la
  plataforma busca el usuario con ese nombre (sin distinguir mayúsculas ni espacios de más).
  - Si encuentra exactamente uno, llega el objeto completo.
  - Si no encuentra ninguno, o hay más de un usuario con ese nombre, llega
    `{ "id": null, "nombre": "<nombre del Excel>", "email": null }`.
  - Si el proyecto no tiene manager en el Excel, llega `null`.
- **`managers`** (HUCHA): la lista de managers asignados al proyecto en HUCHA. Puede traer
  varios o estar vacía.

**Niveles** de un banco de horas o de una HUCHA, de mejor a peor:

| Nivel | Significa |
|---|---|
| `disponible` | Queda el 20 % o más |
| `bajo` | Queda menos del 20 % |
| `consumido` | Se ha gastado exactamente lo asignado: queda 0 |
| `excedido` | Se ha gastado más de lo asignado |

Solo se avisa cuando el nivel empeora. Un cambio puede saltarse niveles, por ejemplo de
`disponible` a `excedido`.

### Formatos

| Qué | Formato | Ejemplo |
|---|---|---|
| `fecha` del sobre y `generado` | Fecha y hora en UTC, ISO 8601 con milisegundos | `2026-09-14T15:32:10.412Z` |
| `dia`, `desde`, `ultimo_registro` | Día en hora de Madrid | `2026-09-14` |
| Horas e importes | Número con punto decimal, hasta dos decimales | `7.5`, `33.5`, `2500` |
| Porcentajes | Número sobre 100, con un decimal | `83.8` |
| Moneda | Código ISO en el campo `moneda` | `EUR` |
| `proyectos_texto`, `descripcion` | Texto ya redactado, con coma decimal y fecha dd/mm | `2,5 h`, `14/09` |
| `enlace` | URL de la ficha en la plataforma. Pide iniciar sesión | `https://<dominio>/bancos/…` |

Los nombres de proyecto son los del Excel. `Departamento` es la imputación a horas internas
(vacaciones incluidas) y aparece como un proyecto más en los registros.

## 3. Los avisos, uno a uno

### `registro.enviado` · Alta de un registro

**Se envía** cada vez que alguien da de alta un registro de horas. Llega uno por cada día que
incluya el alta: un registro que abarca tres días genera tres avisos.

**No se envía** al editar un registro, lo edite la persona o un administrador, ni al anularlo.

```json
{
  "id": "3f1c2a9e-7b4d-4e2a-9c1f-5a8b6d0e2f11",
  "tipo": "registro.enviado",
  "version": 1,
  "fecha": "2026-09-14T15:32:10.412Z",
  "prueba": false,
  "datos": {
    "persona": {
      "id": "00000000-0000-4000-8000-00000000a1b2",
      "nombre": "Laura Gómez",
      "email": "laura.gomez@ejemplo.com",
      "posicion": "SEO Strategist",
      "rol": "operativo"
    },
    "manager_directo": {
      "id": "00000000-0000-4000-8000-00000000c3d4",
      "nombre": "Carlos Ruiz",
      "email": "carlos.ruiz@ejemplo.com"
    },
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

| Campo | Tipo | Qué es |
|---|---|---|
| `persona` | Persona | Quién registra |
| `manager_directo` | Manager o `null` | Su manager directo |
| `dia` | día | Día al que corresponden las horas |
| `horas_registro` | número | Horas de este alta en ese día |
| `horas_dia` | número | Total de la persona en ese día, sumando todos sus registros no anulados |
| `proyectos` | lista de `{ proyecto, horas }` | Reparto de este alta por proyecto. Incluye `Departamento` |
| `proyectos_texto` | texto | El mismo reparto en una línea |

- Lo habitual es un aviso por persona y día. Si alguien registra el mismo día en dos altas
  distintas, llegan dos: cada uno con sus propias horas en `horas_registro` y `proyectos`, y
  con el total acumulado del día en `horas_dia`.
- `dia` puede ser anterior a la `fecha` del sobre. La plataforma deja registrar hasta 7 días
  hacia atrás, o más si un administrador ha ampliado el plazo de esa persona.
- Es el tipo con más volumen: aproximadamente un aviso por persona y día laborable.

### `registro.llamativo` · Un día fuera de lo normal

**Se envía** al guardar un registro, alta o edición, que deja el día de esa persona por encima
de una de estas reglas:

| `regla` | Salta con | Qué cuenta |
|---|---|---|
| `dia_largo` | Más de 10 h en el día (10 h justas no saltan) | Todas las horas del día, `Departamento` incluido |
| `proyecto_largo` | 6 h o más a un mismo proyecto en el día | Solo proyectos: `Departamento` no cuenta. Llega un aviso por proyecto |

Se envía una sola vez por persona, día y regla (y por proyecto, en `proyecto_largo`). Si la
persona baja las horas y luego vuelve a subirlas, no se repite.

```json
{
  "id": "8b0d4f6a-2c1e-4a7b-b3d9-1e6f0a4c7d25",
  "tipo": "registro.llamativo",
  "version": 1,
  "fecha": "2026-09-14T18:05:44.031Z",
  "prueba": false,
  "datos": {
    "persona": {
      "id": "00000000-0000-4000-8000-00000000a1b2",
      "nombre": "Laura Gómez",
      "email": "laura.gomez@ejemplo.com",
      "posicion": "SEO Strategist",
      "rol": "operativo"
    },
    "manager_directo": {
      "id": "00000000-0000-4000-8000-00000000c3d4",
      "nombre": "Carlos Ruiz",
      "email": "carlos.ruiz@ejemplo.com"
    },
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

Con la regla `proyecto_largo` cambian estos campos de `datos`:

```json
{
  "regla": "proyecto_largo",
  "valor": 6.5,
  "limite": 6,
  "proyecto": "Proyecto Ejemplo",
  "horas_dia": 9,
  "descripcion": "6,5 h a Proyecto Ejemplo el 14/09 (límite: 6 h)"
}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `persona` | Persona | De quién es el registro |
| `manager_directo` | Manager o `null` | Su manager directo |
| `dia` | día | Día que se sale de lo normal |
| `regla` | texto | `dia_largo` o `proyecto_largo` |
| `valor` | número | Horas del día (`dia_largo`) u horas a ese proyecto en el día (`proyecto_largo`) |
| `limite` | número | Límite de la regla: `10` o `6` |
| `proyecto` | texto o `null` | El proyecto en `proyecto_largo`. `null` en `dia_largo` |
| `horas_dia` | número | Total del día |
| `descripcion` | texto | El caso en una frase |

- Puede llegar horas o días después del `registro.enviado` de ese día, si el registro se edita
  más tarde. También salta cuando lo edita un administrador.
- Un mismo día puede generar los dos (`dia_largo` y `proyecto_largo`), o varios
  `proyecto_largo` de proyectos distintos.

### `banco.nivel` · Un banco de horas empeora

**Se envía** cuando el banco de horas de un proyecto activo pasa a un nivel peor. Se vigila a
dos alturas:

- `alcance: "posicion"`: el banco de una posición dentro del proyecto. `posicion` dice cuál.
- `alcance: "proyecto"`: el total del proyecto, con las ampliaciones de horas sumadas.

Lo puede provocar un registro con horas a ese proyecto, una ampliación de horas o su
anulación, o la revisión diaria (cambios en el Excel de bancos, cierre de mes).

**No se envía:**

- Cuando el banco mejora, por ejemplo tras una ampliación. La plataforma anota el nivel nuevo
  y, si más adelante vuelve a empeorar, avisa otra vez.
- En posiciones sin horas asignadas.
- En proyectos cuyo estado en el Excel no es `Activo`.

Qué avisos genera cada cambio:

| Cambio de nivel | Banco de una posición | Total del proyecto |
|---|---|---|
| `disponible` → `bajo` | `banco.nivel` | `banco.nivel` |
| `disponible` o `bajo` → `consumido` o `excedido` | `banco.nivel` | `banco.nivel` y `banco.al_tope` |
| `consumido` → `excedido` | `banco.nivel` | `banco.nivel` |
| Cualquier mejora | Ninguno | Ninguno |

```json
{
  "id": "c47e9a12-5f3b-4d8e-a0c6-7b2d9e1f4a63",
  "tipo": "banco.nivel",
  "version": 1,
  "fecha": "2026-09-15T10:12:03.207Z",
  "prueba": false,
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "alcance": "posicion",
    "posicion": "SEO Strategist",
    "nivel": "bajo",
    "nivel_anterior": "disponible",
    "horas": {
      "asignadas": 40,
      "ampliadas": 0,
      "consumidas": 33.5,
      "inutilizables": 0,
      "disponibles": 6.5
    },
    "porcentaje_consumido": 83.8,
    "estado_proyecto": "Activo",
    "manager_proyecto": {
      "id": "00000000-0000-4000-8000-00000000c3d4",
      "nombre": "Carlos Ruiz",
      "email": "carlos.ruiz@ejemplo.com"
    },
    "enlace": "https://<dominio>/bancos/Proyecto%20Ejemplo"
  }
}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `proyecto` | texto | Nombre del proyecto |
| `alcance` | texto | `posicion` o `proyecto` |
| `posicion` | texto o `null` | La posición. `null` cuando el alcance es `proyecto` |
| `nivel` | texto | Nivel nuevo |
| `nivel_anterior` | texto | Nivel que tenía antes |
| `horas.asignadas` | número | Horas del banco. En el total del proyecto incluye las ampliaciones |
| `horas.ampliadas` | número | Horas ampliadas. Solo en el total del proyecto; `0` en una posición |
| `horas.consumidas` | número | Horas registradas |
| `horas.inutilizables` | número | Horas que se perdieron al cerrar meses anteriores (reparto 75/25) |
| `horas.disponibles` | número | Lo que queda: asignadas − consumidas − inutilizables. Negativo si el banco está `excedido` |
| `porcentaje_consumido` | número o `null` | Consumidas sobre (asignadas − inutilizables), con un decimal. `null` si esa base es 0 |
| `estado_proyecto` | texto o `null` | Estado del proyecto en el Excel. Hoy siempre `Activo` |
| `manager_proyecto` | Manager o `null` | Manager del proyecto según el Excel |
| `enlace` | texto | Ficha del banco en la plataforma |

- Un mismo registro puede empeorar a la vez el banco de una posición y el total del proyecto.
  En ese caso llegan dos `banco.nivel`, uno por cada alcance.
- Como el porcentaje se calcula sobre lo que de verdad se puede usar (asignadas menos
  inutilizables), puede no coincidir con `consumidas / asignadas`.
- La revisión diaria puede enviar varios `banco.nivel` juntos a primera hora.

### `banco.al_tope` · Un proyecto llega al tope

**Se envía** cuando el total de un proyecto pasa de `disponible` o `bajo` a `consumido` o
`excedido`. Siempre con `alcance: "proyecto"` y `posicion: null`.

Siempre llega junto con un `banco.nivel` del mismo cambio. Los dos traen los mismos `datos` y
cada uno tiene su propio `id`.

```json
{
  "id": "5e2b8c71-9d4a-4f06-8b1e-3c7a0d5f9e48",
  "tipo": "banco.al_tope",
  "version": 1,
  "fecha": "2026-09-16T12:40:18.664Z",
  "prueba": false,
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "alcance": "proyecto",
    "posicion": null,
    "nivel": "consumido",
    "nivel_anterior": "bajo",
    "horas": {
      "asignadas": 120,
      "ampliadas": 20,
      "consumidas": 120,
      "inutilizables": 0,
      "disponibles": 0
    },
    "porcentaje_consumido": 100,
    "estado_proyecto": "Activo",
    "manager_proyecto": {
      "id": "00000000-0000-4000-8000-00000000c3d4",
      "nombre": "Carlos Ruiz",
      "email": "carlos.ruiz@ejemplo.com"
    },
    "enlace": "https://<dominio>/bancos/Proyecto%20Ejemplo"
  }
}
```

Los campos son los mismos que en `banco.nivel`.

- `consumido` exige quedarse justo en 0 horas. Si el registro que lleva al tope lo sobrepasa,
  el nivel llega directamente como `excedido`.
- Al pasar de `consumido` a `excedido` no hay un segundo `banco.al_tope`: solo llega
  `banco.nivel`.
- Si se amplían horas, el proyecto sale del tope. Si más adelante vuelve a llegar, se envía otro
  `banco.al_tope`.

### `hucha.proyecto_nuevo` · Proyecto nuevo con presupuesto

**Se envía** cuando un administrador sincroniza el Excel de HUCHA desde la plataforma y se crea
un proyecto nuevo con presupuesto. Llega uno por proyecto; si entran varios, llegan seguidos.

**No se envía** si el proyecto ya existía, ni cuando un proyecto archivado vuelve a tener
presupuesto (se reactiva, no es nuevo).

```json
{
  "id": "a93f1d07-6b2e-4c58-9f0a-8e4d2b7c1a36",
  "tipo": "hucha.proyecto_nuevo",
  "version": 1,
  "fecha": "2026-09-14T09:03:27.950Z",
  "prueba": false,
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "proyecto_id": "00000000-0000-4000-8000-00000000e5f6",
    "presupuesto": 2500,
    "moneda": "EUR",
    "managers": [
      {
        "id": "00000000-0000-4000-8000-00000000c3d4",
        "nombre": "Carlos Ruiz",
        "email": "carlos.ruiz@ejemplo.com"
      }
    ],
    "enlace": "https://<dominio>/presupuestos/00000000-0000-4000-8000-00000000e5f6"
  }
}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `proyecto` | texto | Nombre del proyecto |
| `proyecto_id` | texto (UUID) | Identificador del proyecto en HUCHA |
| `presupuesto` | número | Presupuesto con el que entra, según el Excel |
| `moneda` | texto | Moneda del presupuesto |
| `managers` | lista de Manager | Managers asignados. Vacía si el manager del Excel todavía no es usuario |
| `enlace` | texto | Ficha del presupuesto en la plataforma |

- La sincronización hoy es manual: estos avisos llegan cuando alguien la lanza, no a una hora
  fija.

### `hucha.ampliacion` · Ampliación de presupuesto

**Se envía** cada vez que se amplía el presupuesto de una HUCHA. Llega uno por ampliación.

```json
{
  "id": "e1c6b3f9-0a7d-4e25-b8f4-6d9a2c0e7b13",
  "tipo": "hucha.ampliacion",
  "version": 1,
  "fecha": "2026-09-14T11:47:02.318Z",
  "prueba": false,
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "proyecto_id": "00000000-0000-4000-8000-00000000e5f6",
    "importe": 500,
    "moneda": "EUR",
    "motivo": "Ampliación aprobada por el cliente",
    "referencia": "PO-2026-118",
    "dia": "2026-09-14",
    "actor": { "nombre": "Marta López" },
    "saldo": { "asignado": 3000, "consumido": 2450, "disponible": 550 },
    "nivel": "bajo",
    "managers": [
      {
        "id": "00000000-0000-4000-8000-00000000c3d4",
        "nombre": "Carlos Ruiz",
        "email": "carlos.ruiz@ejemplo.com"
      }
    ],
    "enlace": "https://<dominio>/presupuestos/00000000-0000-4000-8000-00000000e5f6"
  }
}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `proyecto`, `proyecto_id` | texto | Como en `hucha.proyecto_nuevo` |
| `importe` | número | Cuánto se amplía |
| `moneda` | texto | Moneda del presupuesto |
| `motivo` | texto | Motivo que se escribió al ampliar. Puede venir vacío |
| `referencia` | texto o `null` | Referencia (pedido, presupuesto…). `null` si no se indicó |
| `dia` | día | Fecha de la ampliación que se indicó al registrarla |
| `actor.nombre` | texto | Quién registró la ampliación en la plataforma |
| `saldo.asignado` | número | Presupuesto total después de ampliar |
| `saldo.consumido` | número | Gastado hasta ahora |
| `saldo.disponible` | número | Lo que queda después de ampliar |
| `nivel` | texto o `null` | Nivel después de ampliar. `null` si la HUCHA no tiene presupuesto |
| `managers` | lista de Manager | Managers asignados al proyecto |
| `enlace` | texto | Ficha del presupuesto en la plataforma |

- `saldo` y `nivel` son los de después de ampliar. Si `nivel` sigue en `bajo`, la ampliación no
  ha bastado para salir de la zona baja.
- Una ampliación nunca genera un `hucha.nivel`, porque solo puede mejorar el saldo.

### `hucha.nivel` · La HUCHA empeora

**Se envía** cuando la HUCHA de un proyecto activo pasa a un nivel peor. Lo puede provocar un
gasto registrado en la HUCHA, la anulación de una ampliación, la sincronización del Excel o la
revisión diaria. Una HUCHA «agotada» es la que está en `consumido` o `excedido`.

**No se envía** cuando mejora (una ampliación o un gasto anulado): se anota el nivel nuevo y, si
vuelve a empeorar, avisa otra vez. Tampoco hay un aviso por cada gasto, solo cuando cambia el
nivel.

```json
{
  "id": "7d4a0e58-3b9c-4f17-a6e2-9c1b8f3d0a74",
  "tipo": "hucha.nivel",
  "version": 1,
  "fecha": "2026-09-17T16:20:55.402Z",
  "prueba": false,
  "datos": {
    "proyecto": "Proyecto Ejemplo",
    "proyecto_id": "00000000-0000-4000-8000-00000000e5f6",
    "nivel": "consumido",
    "nivel_anterior": "bajo",
    "moneda": "EUR",
    "saldo": { "asignado": 3000, "consumido": 3000, "disponible": 0 },
    "managers": [
      {
        "id": "00000000-0000-4000-8000-00000000c3d4",
        "nombre": "Carlos Ruiz",
        "email": "carlos.ruiz@ejemplo.com"
      }
    ],
    "enlace": "https://<dominio>/presupuestos/00000000-0000-4000-8000-00000000e5f6"
  }
}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `proyecto`, `proyecto_id` | texto | Como en `hucha.proyecto_nuevo` |
| `nivel` | texto | Nivel nuevo |
| `nivel_anterior` | texto | Nivel que tenía antes |
| `moneda` | texto | Moneda del presupuesto |
| `saldo` | objeto | `asignado`, `consumido` y `disponible` en ese momento |
| `managers` | lista de Manager | Managers asignados al proyecto |
| `enlace` | texto | Ficha del presupuesto en la plataforma |

## 4. La API de consultas

Dos consultas de solo lectura para lo que va por calendario. Se pueden llamar cuando se quiera
y tantas veces como haga falta: no cambian nada en la plataforma.

### Cómo se llaman

- Método `GET`, sin cuerpo.
- Dirección base: `https://<dominio>/api/avisos/v1/`. Las URLs completas aparecen en
  **Administración → Avisos**.
- Autenticación: cabecera `Authorization: Bearer <clave>`. La clave de consultas se entrega
  aparte y es distinta de la clave de firma.
- La respuesta es JSON en UTF-8, calculado en el momento con los datos de ese instante. No se
  guarda en caché.

```
GET /api/avisos/v1/dias-sin-registrar?fecha=2026-09-16 HTTP/1.1
Host: <dominio>
Authorization: Bearer <clave>
```

| Código | Cuándo | Cuerpo |
|---|---|---|
| `200` | Todo correcto | El JSON de la consulta |
| `400` | `fecha` no tiene el formato `AAAA-MM-DD` (solo en `dias-sin-registrar`) | `{ "error": "El parámetro fecha tiene que ser YYYY-MM-DD." }` |
| `401` | Falta la cabecera o la clave no es la buena | `{ "error": "No autorizado" }` |
| `500` | Error de la plataforma | `{ "error": "<detalle del error>" }` |

### `resumen-capacidad` · Proyectos con más capacidad

```
GET /api/avisos/v1/resumen-capacidad?top=2
```

| Parámetro | Valores | Por defecto |
|---|---|---|
| `top` | Entero de 1 a 50: cuántos proyectos trae cada lista. Por encima de 50 se usa 50 y por debajo de 1 se usa 1. Si no es un número entero, se usa 10 | `10` |

No tiene parámetro de fecha: siempre devuelve la situación del momento.

Respuesta:

```json
{
  "generado": "2026-09-16T07:00:02.118Z",
  "top": 2,
  "con_mas_horas": [
    {
      "proyecto": "Proyecto Ejemplo",
      "horas": {
        "asignadas": 160, "ampliadas": 0, "consumidas": 40,
        "inutilizables": 12, "disponibles": 108
      },
      "porcentaje_consumido": 27,
      "manager_proyecto": {
        "id": "00000000-0000-4000-8000-00000000c3d4",
        "nombre": "Carlos Ruiz",
        "email": "carlos.ruiz@ejemplo.com"
      },
      "enlace": "https://<dominio>/bancos/Proyecto%20Ejemplo"
    },
    {
      "proyecto": "Proyecto Norte",
      "horas": {
        "asignadas": 120, "ampliadas": 20, "consumidas": 70,
        "inutilizables": 0, "disponibles": 50
      },
      "porcentaje_consumido": 58.3,
      "manager_proyecto": { "id": null, "nombre": "Ana Pérez", "email": null },
      "enlace": "https://<dominio>/bancos/Proyecto%20Norte"
    }
  ],
  "mas_libres": [
    {
      "proyecto": "Proyecto Sur",
      "horas": {
        "asignadas": 40, "ampliadas": 0, "consumidas": 4,
        "inutilizables": 0, "disponibles": 36
      },
      "porcentaje_consumido": 10,
      "manager_proyecto": null,
      "enlace": "https://<dominio>/bancos/Proyecto%20Sur"
    },
    {
      "proyecto": "Proyecto Ejemplo",
      "horas": {
        "asignadas": 160, "ampliadas": 0, "consumidas": 40,
        "inutilizables": 12, "disponibles": 108
      },
      "porcentaje_consumido": 27,
      "manager_proyecto": {
        "id": "00000000-0000-4000-8000-00000000c3d4",
        "nombre": "Carlos Ruiz",
        "email": "carlos.ruiz@ejemplo.com"
      },
      "enlace": "https://<dominio>/bancos/Proyecto%20Ejemplo"
    }
  ]
}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `generado` | fecha y hora UTC | Momento en que se calculó |
| `top` | número | El `top` que se ha aplicado |
| `con_mas_horas` | lista | Proyectos ordenados por `horas.disponibles`, de más a menos |
| `mas_libres` | lista | Proyectos ordenados por `porcentaje_consumido`, de menos a más |

Cada proyecto de las dos listas trae:

| Campo | Tipo | Qué es |
|---|---|---|
| `proyecto` | texto | Nombre del proyecto |
| `horas` | objeto | Las mismas cifras que en `banco.nivel`, para el total del proyecto |
| `porcentaje_consumido` | número o `null` | Como en `banco.nivel` |
| `manager_proyecto` | Manager o `null` | Manager del proyecto según el Excel |
| `enlace` | texto | Ficha del banco en la plataforma |

- Solo entran proyectos con estado `Activo` en el Excel, y siempre con su total (no por
  posición).
- Un mismo proyecto puede aparecer en las dos listas.
- `mas_libres` deja fuera los proyectos cuyo porcentaje es `null`.
- Las cifras salen del mismo cálculo que la ficha del banco en la plataforma.

### `dias-sin-registrar` · Personas con días pendientes

```
GET /api/avisos/v1/dias-sin-registrar?fecha=2026-09-16
```

| Parámetro | Valores | Por defecto |
|---|---|---|
| `fecha` | Día de la consulta, en formato `AAAA-MM-DD` | Hoy, en hora de Madrid |

Se cuentan los días anteriores a `fecha`. El propio día de `fecha` no cuenta, porque todavía se
puede registrar.

Respuesta:

```json
{
  "fecha": "2026-09-16",
  "personas": [
    {
      "persona": {
        "id": "00000000-0000-4000-8000-00000000b7e1",
        "nombre": "Pablo Martín",
        "email": "pablo.martin@ejemplo.com",
        "posicion": "CRM",
        "rol": "operativo"
      },
      "manager_directo": null,
      "dias": 8,
      "desde": "2026-09-04",
      "ultimo_registro": "2026-09-03",
      "dentro_de_plazo": false
    },
    {
      "persona": {
        "id": "00000000-0000-4000-8000-00000000a1b2",
        "nombre": "Laura Gómez",
        "email": "laura.gomez@ejemplo.com",
        "posicion": "SEO Strategist",
        "rol": "operativo"
      },
      "manager_directo": {
        "id": "00000000-0000-4000-8000-00000000c3d4",
        "nombre": "Carlos Ruiz",
        "email": "carlos.ruiz@ejemplo.com"
      },
      "dias": 2,
      "desde": "2026-09-14",
      "ultimo_registro": "2026-09-11",
      "dentro_de_plazo": true
    }
  ]
}
```

| Campo | Tipo | Qué es |
|---|---|---|
| `fecha` | día | La fecha que se ha usado |
| `personas` | lista | Solo las personas con al menos un día pendiente. Ordenadas por `dias`, de más a menos, y después por nombre. Vacía si nadie tiene días pendientes |
| `persona` | Persona | Quién tiene días pendientes |
| `manager_directo` | Manager o `null` | Su manager directo |
| `dias` | número | Días laborables seguidos sin registrar, contados hacia atrás desde el día anterior a `fecha`. Como máximo, 30 |
| `desde` | día | El día pendiente más antiguo de esa racha |
| `ultimo_registro` | día o `null` | Último día con algún registro antes de `fecha`. Mira hasta 90 días atrás; `null` si no hay ninguno en ese tiempo |
| `dentro_de_plazo` | booleano | `true` si la persona todavía puede registrar el día `desde` por su cuenta (apartado 5) |

## 5. Personas que no registran en días

Esta es la lógica que hay detrás de `dias-sin-registrar`.

### Quién puede aparecer

Las personas activas con rol `operativo` o `manager`. Los administradores no aparecen.

### Qué cuenta como día registrado

Cualquier registro no anulado de la persona en ese día, tenga las horas que tenga. Un registro
en `Departamento` también cuenta, y así es como cuentan las vacaciones. Los registros anulados
no cuentan.

### Cómo se cuentan los días

- Se empieza por el día anterior a `fecha` y se va hacia atrás, solo por días laborables: de
  lunes a viernes, sin los festivos cargados en la plataforma.
- La cuenta se para en el primer día laborable que tenga un registro. `desde` es el último día
  que se ha contado, es decir, el pendiente más antiguo.
- Los fines de semana y los festivos se saltan: ni suman ni cortan la cuenta. Un registro hecho
  en sábado no corta la racha.
- No se cuentan días anteriores al alta del usuario en la plataforma. El día del alta sí cuenta.
- El máximo es 30 días.
- Solo cuenta la racha más reciente. Si una persona registró ayer pero se dejó días anteriores,
  no aparece. Por lo mismo, si alguien con varios días pendientes registra solo el último, sale
  de la lista aunque le sigan faltando los anteriores.

### Ejemplo

Consulta del miércoles 16/09 (`fecha=2026-09-16`). Los números indican el orden en que se
cuentan los días, desde el martes 15 hacia atrás.

| Día | jue 03 | vie 04 | sáb 05 | dom 06 | lun 07 | mar 08 | mié 09 | jue 10 | vie 11 | sáb 12 | dom 13 | lun 14 | mar 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Laura | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | 2 | 1 |
| Pablo | ✓ | 8 | · | · | 7 | 6 | 5 | 4 | 3 | · | · | 2 | 1 |

✓ = registró · número = día pendiente · punto = fin de semana (no cuenta)

- **Laura** registró por última vez el viernes 11. Salen `dias: 2`, `desde: "2026-09-14"` y
  `ultimo_registro: "2026-09-11"`.
- **Pablo** registró por última vez el jueves 03. Salen `dias: 8`, `desde: "2026-09-04"` y
  `ultimo_registro: "2026-09-03"`.

Cómo evoluciona la cuenta de Laura si no registra nada:

| Consulta | Resultado |
|---|---|
| lunes 14/09 | No aparece: se cuenta desde el domingo 13 hacia atrás y el viernes 11 está registrado |
| martes 15/09 | `dias: 1`, `desde: "2026-09-14"` |
| miércoles 16/09 | `dias: 2`, `desde: "2026-09-14"` |
| jueves 17/09 | `dias: 3`, `desde: "2026-09-14"` |

Si el miércoles registra el martes 15 pero no el lunes 14, la consulta del jueves 17 da
`dias: 1` y `desde: "2026-09-16"`. El lunes 14 queda fuera porque ya no forma parte de la racha
más reciente.

### El plazo para registrar

La plataforma deja registrar por cuenta propia hasta 7 días naturales hacia atrás. Un
administrador puede ampliar ese plazo a una persona concreta.

`dentro_de_plazo` dice si `desde` sigue dentro de ese plazo, contado desde `fecha`. En el
ejemplo, con la consulta del 16/09 el plazo llega hasta el 09/09:

- Laura (`desde` 14/09) está dentro: `true`. Puede registrar esos días ella misma.
- Pablo (`desde` 04/09) está fuera: `false`. El viernes 04 ya no lo puede registrar él solo;
  hace falta que un administrador le amplíe el plazo.

### Otras cosas que conviene saber

- **La consulta no guarda nada.** La plataforma no anota a quién se ha avisado ni en qué punto
  está nadie: cada llamada recalcula desde cero. Mientras la persona no registre, `dias` sube
  uno por cada día laborable. En cuanto registra el último día laborable anterior a la
  consulta, desaparece de la lista.
- **Fechas pasadas.** Una consulta con una fecha pasada usa los registros que existen hoy, no
  los que existían ese día. Si alguien registró tarde, ya no aparece.
- **Fechas futuras.** Con una fecha futura, los días que todavía no han llegado cuentan como
  pendientes.
- **Festivos.** Solo se descuentan los festivos cargados en la plataforma, y el calendario está
  pendiente de decidir. Un festivo que no esté cargado cuenta como laborable: si el lunes 12/10
  no está cargado, la consulta del martes 13/10 dará un día pendiente a todo el que no registre
  nada ese lunes.
- **Vacaciones y ausencias.** Solo cuentan como registradas si la persona las imputa en
  `Departamento`. Si no, esos días salen como pendientes.
- **Fines de semana y festivos en la consulta.** La consulta responde igual cualquier día. Una
  consulta hecha en sábado cuenta desde el viernes hacia atrás.

### Lo que ha pedido negocio

La escalera de recordatorios que se planteó, pendiente de cerrar en la reunión del 14/09:

| `dias` | A quién |
|---|---|
| 1 | A la persona |
| 2 | A la persona |
| 3 | Al manager (`manager_directo`) |
| 4 o más | A definir |

La plataforma no envía estos recordatorios: la consulta devuelve la lista con los días de cada
persona y los datos de su manager directo.

## 6. Lo que no se envía

- Un aviso por cada gasto de HUCHA. Solo se avisa cuando cambia el nivel.
- Un aviso al anular un registro de horas, ni cuando un banco o una HUCHA mejora.
- Un pulso al editar un registro.
- Avisos de proyectos que no estén `Activo` en el Excel ni de posiciones sin horas asignadas.
- Recordatorios y resúmenes por el webhook. Eso va por la API de consultas.
- Avisos reales desde un entorno que no sea producción. Desde cualquier otro entorno solo sale
  «Enviar prueba».

## 7. Historial de envíos

En **Administración → Avisos** se ven los últimos 50 envíos, con la fecha, el tipo, el estado,
los intentos, el último código HTTP, el error y si era una prueba.

| Estado | Significa |
|---|---|
| `enviado` | El webhook respondió con un 2xx |
| `enviando` | Está saliendo en este momento |
| `pendiente` | Esperando un reintento. Se ven el código y el error del último intento |
| `fallido` | Agotó los 5 intentos |
| `descartado` | No había URL guardada o el tipo estaba pausado |

## 8. Qué se intercambia para conectar

| Quién | Qué |
|---|---|
| Plataforma → automatización | La clave de firma, la clave de consultas y las URLs de las consultas |
| Automatización → plataforma | La URL del webhook: una sola, con `https://`, para todos los tipos |

Las claves se entregan por privado y nunca aparecen en la pantalla de la plataforma.

## 9. Pendiente y cambios

### Pendiente de la reunión del lunes 14/09

Puede cambiar sin tocar el formato de los avisos:

- Los umbrales: bajo = queda menos del 20 %; llamativo = más de 10 h en el día, o 6 h o más a
  un proyecto.
- El calendario de festivos.
- Quién asigna el manager directo de cada persona.
- Qué pasa del cuarto día sin registrar en adelante.
- Si al encender se manda un resumen de lo que ya estaba bajo. Hoy no se manda.

### Cambios de versión

Pueden aparecer campos nuevos en cualquier momento, sin cambiar `version`, y los que ya
existen no cambian. Si algún día hay que cambiar o quitar un campo, los avisos llegarán con
`version: 2` y se avisará antes.

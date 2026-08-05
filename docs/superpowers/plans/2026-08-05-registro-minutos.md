# Registrar el tiempo en minutos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada línea de `/registrar` permita introducir el tiempo en minutos además de en horas, sin cambiar lo que se guarda.

**Architecture:** `hours` sigue siendo la única fuente de verdad y lo único que viaja a la RPC. La unidad es estado de UI por línea y solo decide **cómo se muestra** el valor: en minutos, el campo pinta `horasAMinutos(hours)` y al escribir convierte con `minutosAHoras`. Por eso alternar de unidad no convierte nada ni pierde precisión: solo cambia la proyección de un valor que no se ha movido.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Playwright como runner.

**Spec:** `docs/superpowers/specs/2026-08-05-registro-minutos-design.md`

## Global Constraints

- **Gate de verificación del repo: `npx tsc --noEmit` y `npm run build`.** `npm run lint` está roto repo-wide desde Next 16 — no lo uses como señal.
- **Nunca arranques ni pares el dev server.** Lo gestiona el usuario.
- **Nada de tests E2E de navegador.** Decisión explícita del usuario (2026-08-05): de las pruebas en navegador se encarga él. Solo se escriben tests de función pura, que corren sin navegador bajo el proyecto `node-horas`.
- **Sin identidad visual nueva.** Ni paleta, ni tipografías, ni primitivas nuevas en `components/ui/`. Una variante aditiva sobre una primitiva existente sí.
- **Lo que viaja al servidor no cambia.** La RPC `guardar_registro` sigue recibiendo `hours`. Si algo de este plan te lleva a tocar `LineInput` o la action, has tomado un desvío equivocado: para y revisa.
- **10 min se guarda como 0,17 h.** Decisión de negocio tomada y documentada en el spec. No la "arregles" ampliando decimales.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `lib/horas/format.ts` (modificar) | `minutosAHoras` y `horasAMinutos`, puras |
| `e2e/horas-registro-minutos.spec.ts` (crear) | Tests de esas dos funciones (proyecto `node-horas`) |
| `playwright.config.ts` (modificar) | Alta del spec nuevo en `node-horas` y en el `testIgnore` de `chromium-horas` |
| `components/ui/native-select.tsx` (modificar) | Variante `bare`: sin caja propia, para incrustar |
| `components/horas/RegistroForm.tsx` (modificar) | El control combinado y el estado de unidad por línea |

---

### Task 1: Conversión pura + tests

**Files:**
- Modify: `lib/horas/format.ts`
- Create: `e2e/horas-registro-minutos.spec.ts`
- Modify: `playwright.config.ts:17` y `:24`

**Interfaces:**
- Produces (lo usa Task 3): `minutosAHoras(min: number): number` y `horasAMinutos(horas: number): number`.

- [ ] **Step 1: Dar de alta el spec nuevo en Playwright**

En `playwright.config.ts`, el `testMatch` del proyecto `node-horas` (línea 17) pasa a incluir `'**/horas-registro-minutos.spec.ts'`, y el `testIgnore` del proyecto `chromium-horas` (línea 24) también.

**Las dos altas son obligatorias.** `chromium-horas` captura `**/horas-*.spec.ts`, así que sin la exclusión el test de funciones puras correría además en navegador con sesión de operativo y fallaría por motivos ajenos. Es el mismo doble alta que ya tienen `horas-reportes-mes.spec.ts` y `horas-auditoria-diff.spec.ts`.

- [ ] **Step 2: Escribir los tests que fallan**

Crea `e2e/horas-registro-minutos.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { horasAMinutos, minutosAHoras } from '../lib/horas/format'

// El caso que motivó la feature: 10 minutos no caben exactos en centésimas de hora
// (0,1666…), y la decisión tomada es redondear.
test('minutosAHoras redondea 10 minutos a centesimas', () => {
  expect(minutosAHoras(10)).toBe(0.17)
})

test('minutosAHoras es exacto en los multiplos de 3 minutos', () => {
  expect(minutosAHoras(15)).toBe(0.25)
  expect(minutosAHoras(30)).toBe(0.5)
  expect(minutosAHoras(3)).toBe(0.05)
})

// Un minuto tiene que dar algo > 0: la RPC rechaza `horas <= 0`.
test('minutosAHoras de un minuto no cae a cero', () => {
  expect(minutosAHoras(1)).toBe(0.02)
})

test('minutosAHoras redondea hacia abajo cuando toca', () => {
  // 20 min = 0,3333… → 0,33
  expect(minutosAHoras(20)).toBe(0.33)
})

test('minutosAHoras de cero es cero', () => {
  expect(minutosAHoras(0)).toBe(0)
})

test('horasAMinutos convierte a minutos enteros', () => {
  expect(horasAMinutos(2)).toBe(120)
  expect(horasAMinutos(0.5)).toBe(30)
})

// El valor guardado de "10 minutos" tiene que volver a leerse como 10 minutos, o el
// campo mostraría 10,2 al cambiar de unidad.
test('horasAMinutos redondea el valor guardado de 10 minutos', () => {
  expect(horasAMinutos(0.17)).toBe(10)
})

test('el viaje de ida y vuelta de 10 minutos cierra', () => {
  expect(horasAMinutos(minutosAHoras(10))).toBe(10)
})

test('el viaje de ida y vuelta de 2 horas cierra', () => {
  expect(minutosAHoras(horasAMinutos(2))).toBe(2)
})
```

- [ ] **Step 3: Correr los tests para verificar que fallan**

Run: `npx playwright test --project=node-horas horas-registro-minutos`
Expected: FAIL. Playwright no hace type-check, así que el fallo será de ejecución (`TypeError: minutosAHoras is not a function`), no de tipos.

- [ ] **Step 4: Escribir las dos funciones**

Al final de `lib/horas/format.ts`:

```ts
// Minutos → horas, redondeado a centésimas porque es lo que la BD guarda
// (`time_log_lines.hours` es numeric(5,2)). Solo los múltiplos de 3 minutos caben
// exactos: 10 min son 0,1666… y se guardan como 0,17. Decisión tomada a sabiendas
// (spec 2026-08-05-registro-minutos-design), no un descuido de precisión.
export function minutosAHoras(min: number): number {
  return Math.round((min / 60) * 100) / 100
}

// Horas → minutos enteros. Redondea porque el valor guardado ya viene redondeado a
// centésimas: 0,17 h son 10,2 minutos, y el campo debe volver a mostrar 10.
export function horasAMinutos(horas: number): number {
  return Math.round(horas * 60)
}
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `npx playwright test --project=node-horas horas-registro-minutos`
Expected: PASS, los 9 tests.

- [ ] **Step 6: Verificar el gate**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/horas/format.ts e2e/horas-registro-minutos.spec.ts playwright.config.ts
git commit -m "feat(registro): conversion pura entre horas y minutos"
```

---

### Task 2: Variante `bare` de `NativeSelect`

**Files:**
- Modify: `components/ui/native-select.tsx`

**Interfaces:**
- Produces (lo usa Task 3): `NativeSelect` acepta `bare?: boolean`. Con `bare`, el select no dibuja borde, fondo, alto propio ni anillo de foco, para incrustarse dentro de un contenedor que ya los aporta. Sin `bare`, el comportamiento es exactamente el de hoy.

- [ ] **Step 1: Añadir la variante**

Sustituye el cuerpo de `components/ui/native-select.tsx` por:

```tsx
'use client'
import type { ReactNode, SelectHTMLAttributes } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// <select> nativo con flecha propia (ChevronsUpDown) y separación consistente del borde.
// Los <select> nativos no dejan controlar el padding de la flecha del navegador; aquí se
// oculta (appearance-none) y se superpone una flecha con la misma separación (right-2.5)
// que los selectores Base UI. Ancho automático por defecto (para filtros en fila); pásale
// `fullWidth` para que ocupe todo el ancho (formularios). El padding derecho (pr-9) se
// aplica al final para que gane a cualquier px-* del className recibido.
//
// `bare` quita la caja propia (borde, fondo, alto y anillo de foco) para incrustarlo
// dentro de otro control que ya los aporta: lo usa el campo de tiempo de /registrar,
// donde el número y la unidad comparten un único borde. La flecha se acerca al borde
// porque el hueco disponible es menor.
export default function NativeSelect({
  className, fullWidth, bare, children, ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { fullWidth?: boolean; bare?: boolean; children: ReactNode }) {
  return (
    <span className={cn('relative inline-block align-middle', fullWidth && 'block w-full', bare && 'h-full')}>
      <select
        {...props}
        className={cn(
          'appearance-none pl-2.5 text-sm text-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          bare
            ? 'h-full bg-transparent'
            : 'h-9 rounded-lg border border-border bg-background focus:border-transparent focus:ring-2 focus:ring-ring',
          fullWidth && 'w-full',
          className,
          bare ? 'pr-6' : 'pr-9',
        )}
      >
        {children}
      </select>
      <ChevronsUpDown
        className={cn(
          'pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground',
          bare ? 'right-1' : 'right-2.5',
        )}
      />
    </span>
  )
}
```

Nota: las clases comunes (`appearance-none`, `pl-2.5`, tipografía, estados deshabilitados) se extraen fuera del ternario para que las dos variantes no dupliquen la misma lista. El resultado para el caso sin `bare` es idéntico al de hoy.

- [ ] **Step 2: Verificar que no se movió nada donde ya se usa**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run build`
Expected: build correcto.

Con el dev server levantado, abre `/reportes` y `/registrar` y confirma a ojo que los selectores existentes (proyecto, usuario, área, posición, departamento, etapa, descripción) se ven exactamente igual que antes: mismo alto, mismo borde, misma flecha.

- [ ] **Step 3: Commit**

```bash
git add components/ui/native-select.tsx
git commit -m "feat(ui): variante bare de NativeSelect para incrustar"
```

---

### Task 3: El campo de tiempo con unidad

**Files:**
- Modify: `components/horas/RegistroForm.tsx`

**Interfaces:**
- Consumes: `minutosAHoras` / `horasAMinutos` (Task 1) y `NativeSelect` con `bare` (Task 2).

- [ ] **Step 1: Importar las conversiones**

En `components/horas/RegistroForm.tsx`, la línea 6 pasa de:

```tsx
import { formatHoras } from '@/lib/horas/format'
```

a:

```tsx
import { formatHoras, horasAMinutos, minutosAHoras } from '@/lib/horas/format'
```

- [ ] **Step 2: Añadir el estado de unidad por línea**

Justo debajo de `const [lines, setLines] = useState<LineInput[]>(...)` (línea 77), añade:

```tsx
  // Unidad de captura de cada línea. Es estado de UI: NO viaja al servidor y no se
  // guarda. `hours` sigue siendo la única fuente de verdad; la unidad solo decide
  // cómo se proyecta ese número en el campo, así que alternar no convierte nada.
  // El array va en paralelo a `lines` (mismo índice) y se mantiene en los dos únicos
  // sitios que cambian su longitud: quitar línea y añadir línea.
  const [unidades, setUnidades] = useState<Unidad[]>(
    () => Array<Unidad>(initial?.lines.length ?? 1).fill('h'),
  )
```

Y arriba del componente, junto a las demás constantes de módulo (después de `CLIENTES_DEP`, línea 28):

```tsx
type Unidad = 'h' | 'min'
```

- [ ] **Step 3: Mantener el array en sincronía al quitar y añadir líneas**

En `removeBtn` (línea 223), el `onClick` pasa de:

```tsx
onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
```

a:

```tsx
onClick={() => {
  setLines((p) => p.filter((_, idx) => idx !== i))
  setUnidades((p) => p.filter((_, idx) => idx !== i))
}}
```

Y en el botón de añadir línea (línea 294), el `onClick` pasa de:

```tsx
onClick={() => setLines((p) => [...p, emptyLine(areas[0]?.id ?? '', defaultDate)])}
```

a:

```tsx
onClick={() => {
  setLines((p) => [...p, emptyLine(areas[0]?.id ?? '', defaultDate)])
  setUnidades((p) => [...p, 'h'])
}}
```

Los otros dos `setLines` (líneas 95 y 144) usan `map` y no cambian la longitud del array, así que no hay que tocarlos.

- [ ] **Step 4: Reemplazar el campo**

En `lineControls`, el bloque de las líneas 199-202 pasa de:

```tsx
    const horas = (
      <Input aria-label="Horas" type="number" step="0.5" min="0" value={l.hours || ''}
        onChange={(e) => update(i, { hours: Number(e.target.value) })} />
    )
```

a:

```tsx
    const unidad = unidades[i] ?? 'h'
    // El campo muestra `hours` proyectado a la unidad activa; lo que se guarda son
    // siempre horas. `|| ''` deja el campo vacío en 0, como hacía el Input anterior.
    const valorMostrado = l.hours ? (unidad === 'h' ? l.hours : horasAMinutos(l.hours)) : ''
    const horas = (
      <div>
        {/* El número y la unidad comparten un único borde y un único anillo de foco:
            se leen como un control, no como dos campos sueltos. */}
        <div className="flex items-stretch rounded-lg border border-border bg-background focus-within:border-transparent focus-within:ring-2 focus-within:ring-ring">
          <input
            // El nombre accesible sigue a la unidad: si no, un lector de pantalla
            // anunciaría "Horas" sobre un 10 que son minutos.
            aria-label={unidad === 'h' ? 'Horas' : 'Minutos'}
            type="number"
            // `step` no es cosmético: en HTML5 los valores válidos son min + n × step.
            // Con step="0.5" (lo que había antes) un 0,17 quedaba marcado como inválido,
            // que es justo lo que produce cargar 10 minutos.
            step={unidad === 'h' ? 'any' : '1'}
            min={unidad === 'h' ? '0' : '1'}
            value={valorMostrado}
            onChange={(e) => {
              const n = Number(e.target.value)
              update(i, { hours: unidad === 'h' ? n : minutosAHoras(n) })
            }}
            className="w-full min-w-0 bg-transparent px-2.5 py-2 text-sm text-foreground focus:outline-none"
          />
          <NativeSelect
            bare
            aria-label="Unidad"
            value={unidad}
            onChange={(e) => setUnidades((p) => p.map((u, idx) => (idx === i ? (e.target.value as Unidad) : u)))}
            className="border-l border-border"
          >
            <option value="h">h</option>
            <option value="min">min</option>
          </NativeSelect>
        </div>
        {/* En minutos, el valor que se va a guardar queda a la vista. Sin esto el
            selector reintroduce el error silencioso que hizo descartar un interruptor
            global de unidad. En horas no hay nada que tranquilizar: no se muestra. */}
        {unidad === 'min' && l.hours > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">= {formatHoras(l.hours)}</p>
        )}
      </div>
    )
```

- [ ] **Step 5: Dar sitio a la columna y renombrarla**

La columna ya no contiene solo un número, así que `w-24` (6rem) se queda corta y el rótulo "Horas" deja de ser cierto.

En la cabecera (línea 247):

```tsx
              <th className="pb-1 pr-3 font-medium">Tiempo</th>
```

En la celda (línea 261):

```tsx
                  <td className="w-36 pr-3 align-top">{c.horas}</td>
```

Y en la vista móvil (línea 285):

```tsx
                <MobileField label="Tiempo">{c.horas}</MobileField>
```

El `aria-label` del input **no** cambia en modo horas (sigue siendo "Horas"), así que los tests que localizan el campo por ese nombre siguen funcionando.

- [ ] **Step 6: Comprobar que `Input` sigue usándose**

El componente `Input` de `@/components/ui/input` ya no se usa para las horas, pero sí para otros campos del formulario. Confirma que el import de la línea 8 sigue haciendo falta:

Run: `npx tsc --noEmit`
Expected: sin errores. Si aparece "declarado pero nunca usado" para `Input`, quita ese import.

- [ ] **Step 7: Verificar el gate**

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 8: Commit**

```bash
git add components/horas/RegistroForm.tsx
git commit -m "feat(registro): elegir horas o minutos en cada linea"
```

---

## Comprobación a mano (la hace el usuario)

Con el dev server levantado, en `/registrar`:

- [ ] El campo arranca en `h` y se comporta como siempre.
- [ ] Cambiar a `min`, escribir 10: aparece `= 0,17h` debajo y el total del día suma 0,17.
- [ ] Volver a `h`: el campo muestra 0,17 y **no** queda marcado como inválido.
- [ ] Escribir 2 en `h`, cambiar a `min`: muestra 120.
- [ ] Quitar una línea intermedia: las unidades de las demás no se descolocan.
- [ ] Guardar y comprobar en `/mis-registros` que el registro quedó con 0,17 h.
- [ ] En móvil, el control entra sin romper la fila.

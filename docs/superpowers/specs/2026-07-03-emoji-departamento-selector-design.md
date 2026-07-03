# Icono por departamento en el selector de registrar

**Fecha:** 2026-07-03
**Estado:** Aprobado (diseño) — implementado
**Pedido:** El jefe pidió usar iconos para diferenciar los departamentos en el
selector que aparece al registrar horas en el proyecto interno "Departamento".

> **Nota de evolución:** el pedido original decía "emoticonos". Se aclaró después
> que deben ser **iconos de lucide-react** (el design system de la app,
> monocromos y coherentes con la UI shadcn), **no emojis unicode genéricos**.
> El diseño pasó de "prefijo emoji en `<option>`" a un selector custom con icono.

## Alcance

- **Incluye:** el selector de Departamento del formulario de registrar horas
  (`components/horas/RegistroForm.tsx`), tanto en la vista de escritorio (tabla)
  como en la de móvil (tarjetas) — ambas reutilizan el mismo control `depto`.
- **No incluye:** Mis registros ni Reportes (decisión del usuario: solo el
  selector de registrar). Tampoco el panel de Catálogos.

## Origen del icono: mapa fijo en código

Decisión del usuario: **mapa fijo en código**, no configurable por el admin. No se
toca la tabla `departamentos` (no lleva columna nueva) ni el panel de administración.

Se crea un helper puro y compartible:

**`lib/horas/departamento-icon.ts`**

- `departamentoIcon(name: string): LucideIcon` — devuelve el **componente de icono
  lucide** (no un string).
- Normaliza el nombre: `trim`, minúsculas y sin acentos (`normalize('NFD')` +
  quitar diacríticos).
- Busca por **palabra clave (substring)**, no por igualdad exacta, para que
  variantes como "Marketing Digital" o "Diseño Gráfico" también matcheen.
- Recorre un array ordenado de pares `[keyword, LucideIcon]` y devuelve el icono
  del primer keyword contenido en el nombre normalizado.
- Sin coincidencia → **fallback genérico** `Building2`, para que ningún
  departamento quede sin icono.

### Mapa inicial

Los departamentos **reales activos** en la BD (consultados vía MCP el 2026-07-03)
son: Clientes, Contenido, Marketing, Prospección, RRHH, Todos, Ventas. Los siete
tienen icono propio. Se agregan unas pocas keywords comunes extra para robustez
ante futuros departamentos (el punto débil del mapa fijo).

| Palabra clave (normalizada) | Icono lucide | Nota |
|---|---|---|
| `clientes` | `Handshake` | real |
| `contenido` | `FileText` | real |
| `marketing` | `Megaphone` | real |
| `prospeccion` | `Target` | real |
| `rrhh` | `Users` | real (Recursos Humanos) |
| `todos` | `Globe` | real (todos los departamentos) |
| `ventas` | `HandCoins` | real |
| `diseno` | `Palette` | extra |
| `desarrollo` / `dev` | `Code` | extra |
| `seo` | `Search` | extra |
| `paid` / `ads` | `TrendingUp` | extra |
| `administracion` | `FolderKanban` | extra |
| `soporte` | `LifeBuoy` | extra |
| *(sin match)* | `Building2` | fallback |

> Nota: las keywords se guardan ya normalizadas, sin acentos (`prospeccion`,
> `diseno`, `administracion`). El array se recorre en orden y devuelve el icono
> del primer keyword contenido en el nombre normalizado; los reales van primero.

## Renderizado

Un `<select>` nativo **no puede renderizar SVG** dentro de sus `<option>` (solo
texto), así que para mostrar iconos lucide por departamento se reemplaza el select
nativo por un componente custom.

**`components/horas/DepartamentoSelect.tsx`** — Base UI `Select` (mismo patrón que
`ProjectCombobox`, pero sin buscador porque son pocos departamentos):

- `Select.Trigger` muestra el icono + nombre del departamento elegido
  (`Select.Value` con función hija), o el placeholder "— Departamento —".
- El popup renderiza en **portal** (no lo recorta el `overflow` de la tabla) y
  lista cada departamento como `<icono lucide> <nombre> <check si seleccionado>`.
- Props: `value`, `onValueChange`, `departamentos`, `ariaLabel`, `className`.

En `RegistroForm.tsx`, el control `depto` pasa de un `<select>` nativo a:

```tsx
<DepartamentoSelect ariaLabel="Departamento" value={l.department} departamentos={departamentos}
  onValueChange={(v) => update(i, { department: v })} />
```

**Clave de diseño:** el valor elegido sigue siendo `d.name` sin cambios. El icono
es solo presentación. Por lo tanto:

- No cambia el dato que se guarda en `time_log_lines.department`.
- No cambia la validación por posición del RPC `guardar_registro`.

El caso "sin departamentos" (placeholder deshabilitado) queda igual, sin icono.

## Qué NO cambia

- Esquema de BD (`departamentos`, `time_log_lines`).
- Server actions, queries, RPC de guardado y validación de alcance.
- Datos históricos ya guardados.
- Catálogos, Reportes, Mis registros.

## Testing

- Verificación manual en la página de registrar: elegir proyecto "Departamento"
  y confirmar que cada opción del selector muestra su icono lucide, en escritorio
  y móvil, y que el icono del elegido aparece en el trigger.
- Confirmar que al guardar, `department` conserva el nombre.
- El helper `departamentoIcon` se validó contra los 7 departamentos reales +
  un nombre desconocido (fallback `Building2`).

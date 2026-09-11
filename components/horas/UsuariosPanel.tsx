'use client'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarClock, Pencil, Search, Trash2, UserCheck, UserX } from 'lucide-react'
import { actualizarUsuario, actualizarDiasRegistro, cambiarEstadoUsuario, eliminarUsuario, type EdicionUsuario } from '@/app/(horas)/admin/usuarios/actions'
import type { AreaRow } from '@/lib/horas/types'
import { formatFechaISO } from '@/lib/horas/format'
import { cn } from '@/lib/utils'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import NativeSelect from '@/components/ui/native-select'
import { Badge } from '@/components/ui/badge'
import AccionIcono from '@/components/horas/AccionIcono'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

export interface PosicionOpt { id: string; name: string }
export interface UsuarioRow {
  id: string; full_name: string; email: string; positionId: string | null
  role: 'operativo' | 'manager' | 'admin'; status: 'activo' | 'inactivo'; areaIds: string[]
  canCreateUsers: boolean
  registroDiasAtras: number | null // días hacia atrás que puede registrar; null = los 7 normales
  managerId: string | null // manager directo; null = sin asignar
}

const fieldSelect = 'h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

const DIAS_NORMALES = 7
const DIAS_MAX = 3650 // el mismo techo que el CHECK de la migración 0043

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '·'
}

// Tiene la ventana de registro ampliada AHORA MISMO. Un admin no cuenta aunque
// tuviera días guardados: registra sin límite de fecha, así que el permiso no le
// hace nada y enseñarlo encendido sería mentir. Única definición para las tres
// cosas que lo muestran: el chip que filtra, el icono de la fila y el badge.
function tienePermiso(u: UsuarioRow) {
  return u.registroDiasAtras !== null && u.role !== 'admin'
}

// Búsqueda tolerante a tildes y mayúsculas: "Rodriguez" encuentra a "Rodríguez".
function normalizar(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

// Fecha ISO de hace n días. Mismo criterio que RegistroForm (UTC vía toISOString):
// es una previsualización, el piso que manda es el que calcula la base de datos.
function fechaHaceDias(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// Meses → días por calendario real, no por 30 fijos: "3 meses" tiene los días que
// de verdad tienen esos tres meses, y el diálogo enseña la fecha que sale.
function diasDeMeses(n: number) {
  const hoy = new Date()
  const antes = new Date(hoy)
  antes.setMonth(antes.getMonth() - n)
  return Math.round((hoy.getTime() - antes.getTime()) / 86_400_000)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

// Diálogo de la acción "Días de registro" de cada fila. Concede o retira el permiso
// ampliado (migración 0043) sin obligar a abrir el editor completo del usuario.
function DiasRegistroDialog({ u, onDone }: { u: UsuarioRow; onDone: () => void }) {
  const router = useRouter()
  const yaTiene = u.registroDiasAtras !== null
  const [valor, setValor] = useState(String(u.registroDiasAtras ?? 30))
  const [unidad, setUnidad] = useState<'dias' | 'meses'>('dias')
  const [saving, setSaving] = useState(false)
  const esAdmin = u.role === 'admin'

  const n = Number(valor)
  const valido = Number.isInteger(n) && n >= 1
  const dias = valido ? (unidad === 'meses' ? diasDeMeses(n) : n) : 0
  const pasado = dias > DIAS_MAX

  async function guardar(nuevos: number | null) {
    setSaving(true)
    const res = await actualizarDiasRegistro(u.id, nuevos)
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(nuevos === null ? 'Permiso quitado' : `Podrá registrar hasta ${nuevos} días atrás`)
    onDone(); router.refresh()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Días de registro</DialogTitle>
          <DialogDescription>{u.full_name}</DialogDescription>
        </DialogHeader>

        {esAdmin ? (
          <p className="text-sm text-muted-foreground">
            Es admin: ya registra, edita y anula sin límite de fecha. Este permiso no le cambia nada.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {yaTiene
                ? `Ahora puede registrar hasta ${u.registroDiasAtras} días atrás.`
                : `Ahora solo puede registrar hasta ${DIAS_NORMALES} días atrás.`}
            </p>

            <div className="flex items-end gap-2">
              <Field label="Cantidad">
                <Input
                  aria-label="Cantidad" type="number" min={1} step={1} value={valor}
                  onChange={(e) => setValor(e.target.value)} className="h-9 w-24 tabular-nums"
                />
              </Field>
              <Field label="Unidad">
                <NativeSelect
                  aria-label="Unidad" value={unidad}
                  onChange={(e) => setUnidad(e.target.value as 'dias' | 'meses')} className={cn(fieldSelect, 'w-28')}
                >
                  <option value="dias">días</option>
                  <option value="meses">meses</option>
                </NativeSelect>
              </Field>
            </div>

            <p className={cn('text-sm', pasado || !valido ? 'text-destructive' : 'text-foreground/80')}>
              {!valido
                ? 'Escribe un número entero de 1 o más.'
                : pasado
                  ? `Son ${dias} días: el máximo es ${DIAS_MAX} (10 años).`
                  : <>Podrá registrar desde el <span className="font-medium tabular-nums">{formatFechaISO(fechaHaceDias(dias))}</span>, y también editar y anular hasta ahí.</>}
            </p>
          </>
        )}

        <DialogFooter>
          {yaTiene && (
            <Button variant="destructive" disabled={saving} onClick={() => guardar(null)}>
              Quitar permiso
            </Button>
          )}
          <Button variant="outline" disabled={saving} onClick={onDone}>Cancelar</Button>
          {!esAdmin && (
            <Button disabled={saving || !valido || pasado} onClick={() => guardar(dias)}>
              {saving ? 'Guardando…' : yaTiene ? 'Guardar' : 'Dar permiso'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Editor({ u, areas, posiciones, managers, onDone }: { u: UsuarioRow; areas: AreaRow[]; posiciones: PosicionOpt[]; managers: PosicionOpt[]; onDone: () => void }) {
  const router = useRouter()
  const [f, setF] = useState<EdicionUsuario>({
    full_name: u.full_name, positionId: u.positionId ?? '', role: u.role, status: u.status, areaIds: u.areaIds,
    canCreateUsers: u.canCreateUsers, managerId: u.managerId,
  })
  const [saving, setSaving] = useState(false)
  const selectableAreas = areas.filter((a) => !a.is_internal)

  async function save() {
    setSaving(true)
    const res = await actualizarUsuario(u.id, f)
    setSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Usuario actualizado')
    onDone(); router.refresh()
  }

  return (
    <div className="rounded-xl border border-border bg-(--muted-surface) p-5 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--brand)/10 text-xs font-semibold text-(--brand-strong)">
          {initials(f.full_name || u.full_name)}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Editar usuario</p>
          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre">
          <Input aria-label="Editar nombre" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} className="h-9" />
        </Field>
        <Field label="Posición (banco de horas)">
          <NativeSelect aria-label="Editar posición" value={f.positionId} onChange={(e) => setF({ ...f, positionId: e.target.value })} className={fieldSelect} fullWidth>
            <option value="">— Sin posición —</option>
            {posiciones.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Rol">
          <NativeSelect aria-label="Editar rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as EdicionUsuario['role'] })} className={fieldSelect} fullWidth>
            <option value="operativo">Operativo</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </NativeSelect>
        </Field>
        <Field label="Estado">
          <NativeSelect aria-label="Editar estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as EdicionUsuario['status'] })} className={fieldSelect} fullWidth>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </NativeSelect>
        </Field>
        <Field label="Manager directo">
          <NativeSelect
            aria-label="Editar manager directo" value={f.managerId ?? ''}
            onChange={(e) => setF({ ...f, managerId: e.target.value || null })} className={fieldSelect} fullWidth
          >
            <option value="">— Sin manager directo —</option>
            {managers.filter((m) => m.id !== u.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </NativeSelect>
        </Field>
      </div>

      {/* Áreas = visibilidad del manager/admin. El operativo las hereda de su posición
          (no se editan aquí); el área con la que se registra sale siempre de la posición. */}
      {(f.role === 'manager' || f.role === 'admin') && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full bg-(--brand)" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/70">Áreas que puede ver</h4>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {f.role === 'manager'
              ? 'El manager verá los registros, bancos y reportes de los usuarios de estas áreas. El área con la que él registra sale de su posición.'
              : 'Áreas de visibilidad. El admin ve todo por defecto; el área con la que registra sale de su posición.'}
          </p>
          {selectableAreas.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No hay áreas en el catálogo.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {selectableAreas.map((a) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-2 text-sm text-foreground/80 hover:text-foreground">
                  <input type="checkbox" className="size-4 accent-(--brand)" checked={f.areaIds.includes(a.id)}
                    onChange={(e) => setF({ ...f, areaIds: e.target.checked ? [...f.areaIds, a.id] : f.areaIds.filter((x) => x !== a.id) })} />
                  {a.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Permiso delegado de alta: solo aplica a no-admins (el admin ya crea usuarios por rol). */}
      {f.role !== 'admin' && (
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-foreground/80 hover:text-foreground">
          <input type="checkbox" className="size-4 accent-(--brand)" checked={f.canCreateUsers}
            onChange={(e) => setF({ ...f, canCreateUsers: e.target.checked })} />
          Puede dar de alta usuarios (solo operativos y managers; no edita ni desactiva)
        </label>
      )}

      <div className="mt-5 flex gap-2">
        <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button>
        <Button onClick={onDone} variant="outline">Cancelar</Button>
      </div>
    </div>
  )
}

export default function UsuariosPanel({ usuarios, areas, posiciones, managers, readOnly = false }: { usuarios: UsuarioRow[]; areas: AreaRow[]; posiciones: PosicionOpt[]; managers: PosicionOpt[]; readOnly?: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [dias, setDias] = useState<UsuarioRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [soloAmpliados, setSoloAmpliados] = useState(false)
  const ampliados = usuarios.filter(tienePermiso)
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? ''
  const posName = (id: string | null) => (id ? posiciones.find((p) => p.id === id)?.name ?? '—' : '—')
  const columnas = readOnly ? 5 : 6

  // Buscador: con la plantilla entera en una sola tabla, encontrar a alguien era scroll.
  // Filtra por nombre, correo y posición, que es por lo que se busca a una persona.
  const filtrados = useMemo(() => {
    const term = normalizar(q.trim())
    return usuarios.filter((u) => {
      if (soloAmpliados && !tienePermiso(u)) return false
      if (!term) return true
      return normalizar(`${u.full_name} ${u.email} ${posName(u.positionId)}`).includes(term)
    })
    // posName depende de `posiciones`, que es estable durante la vida de la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarios, posiciones, q, soloAmpliados])

  async function toggle(u: UsuarioRow) {
    setBusy(u.id)
    const res = await cambiarEstadoUsuario(u.id, u.status === 'activo' ? 'inactivo' : 'activo')
    setBusy(null)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(u.status === 'activo' ? 'Usuario desactivado' : 'Usuario activado')
    router.refresh()
  }

  async function eliminar(u: UsuarioRow) {
    if (!confirm(`¿Eliminar a "${u.full_name}" definitivamente? No se puede deshacer. Si tiene registros de horas, desactívalo en su lugar.`)) return
    setBusy(u.id)
    const res = await eliminarUsuario(u.id)
    setBusy(null)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Usuario eliminado')
    router.refresh()
  }

  return (
    <TooltipProvider delay={150}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar usuario" placeholder="Buscar por nombre, correo o posición"
              value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8"
            />
          </div>
          {/* El permiso ampliado es la excepción, y una excepción hay que poder revisarla:
              el chip lleva la cuenta a la vista y deja la tabla en solo esos para apagarlos.
              Deshabilitado en cero, que también es una respuesta. */}
          <Button
            variant={soloAmpliados ? 'secondary' : 'outline'} size="lg"
            aria-pressed={soloAmpliados} disabled={ampliados.length === 0 && !soloAmpliados}
            onClick={() => setSoloAmpliados((v) => !v)}
          >
            <CalendarClock />
            Con registro ampliado
            <span className="tabular-nums opacity-70">{ampliados.length}</span>
          </Button>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {filtrados.length === usuarios.length
              ? `${usuarios.length} usuarios`
              : `${filtrados.length} de ${usuarios.length}`}
          </span>
        </div>

        {/* bg-card, no transparente: el fondo del AppShell dibuja círculos de marca y su
            arco se veía cruzando las filas de la tabla. */}
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-(--muted-surface) hover:bg-(--muted-surface)">
                  <TableHead>Usuario</TableHead>
                  <TableHead>Posición</TableHead>
                  <TableHead>Rol y alcance</TableHead>
                  <TableHead>Permisos</TableHead>
                  <TableHead>Estado</TableHead>
                  {!readOnly && <TableHead className="text-right">Acciones</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columnas} className="py-10 text-center text-sm text-muted-foreground">
                      {/* Quitarle el permiso al último mientras el chip filtra deja la tabla
                          vacía sin búsqueda de por medio: ese caso tiene su propia frase. */}
                      {q.trim()
                        ? `Ningún usuario coincide con «${q.trim()}».`
                        : soloAmpliados
                          ? 'Ya nadie tiene la ventana de registro ampliada.'
                          : 'Todavía no hay usuarios.'}
                    </TableCell>
                  </TableRow>
                )}
                {filtrados.map((u) => {
                  const areasDelUsuario = u.areaIds.map(areaName).filter(Boolean).join(', ')
                  const inactivo = u.status === 'inactivo'
                  return (
                    <Fragment key={u.id}>
                      <TableRow className={cn(inactivo && 'opacity-55')}>
                        <TableCell className="py-3">
                          <div className="font-medium text-foreground">{u.full_name}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </TableCell>
                        <TableCell className="py-3 text-foreground/70">{posName(u.positionId)}</TableCell>
                        {/* Las áreas bajan a segunda línea: como columna propia eran casi todo
                            guiones (el operativo no tiene áreas de visibilidad, por diseño). */}
                        <TableCell className="py-3 text-foreground/70">
                          <div className="capitalize">{u.role}</div>
                          {areasDelUsuario && <div className="text-xs text-muted-foreground">{areasDelUsuario}</div>}
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex flex-col items-start gap-1">
                            {u.canCreateUsers && u.role !== 'admin' && (
                              <Badge className="bg-sky-50 text-sky-700">Alta de usuarios</Badge>
                            )}
                            {tienePermiso(u) && (
                              <Badge className="bg-(--brand)/10 text-(--brand-strong)">Registro {u.registroDiasAtras} días</Badge>
                            )}
                          </div>
                        </TableCell>
                        {/* "Activo" es casi toda la tabla: en verde era ruido. Lo informativo
                            es el inactivo, que además atenúa su fila entera. */}
                        <TableCell className="py-3">
                          {/* El texto del DOM se queda en minúscula (la mayúscula la pone
                              CSS): es el contrato que ya afirman los E2E del panel. */}
                          {inactivo ? (
                            <Badge className="bg-neutral-100 capitalize text-neutral-500">{u.status}</Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-sm text-foreground/70">
                              <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
                              <span className="capitalize">{u.status}</span>
                            </span>
                          )}
                        </TableCell>
                        {!readOnly && (
                          <TableCell className="py-3">
                            <div className="flex items-center justify-end gap-0.5">
                              <AccionIcono label="Editar" onClick={() => setEditing(editing === u.id ? null : u.id)}>
                                <Pencil />
                              </AccionIcono>
                              <AccionIcono
                                label="Días de registro" activo={tienePermiso(u)}
                                tooltip={tienePermiso(u) ? `Registra hasta ${u.registroDiasAtras} días atrás` : 'Días de registro'}
                                onClick={() => setDias(u)}
                              >
                                <CalendarClock />
                              </AccionIcono>
                              <AccionIcono
                                label={u.status === 'activo' ? 'Desactivar' : 'Activar'}
                                disabled={busy === u.id} onClick={() => toggle(u)}
                              >
                                {u.status === 'activo' ? <UserX /> : <UserCheck />}
                              </AccionIcono>
                              <AccionIcono label="Eliminar" destructivo disabled={busy === u.id} onClick={() => eliminar(u)}>
                                <Trash2 />
                              </AccionIcono>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                      {!readOnly && editing === u.id && (
                        <TableRow>
                          <TableCell colSpan={columnas} className="py-3">
                            <Editor u={u} areas={areas} posiciones={posiciones} managers={managers} onDone={() => setEditing(null)} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {dias && <DiasRegistroDialog key={dias.id} u={dias} onDone={() => setDias(null)} />}
    </TooltipProvider>
  )
}

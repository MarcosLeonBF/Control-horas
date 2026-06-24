# Registro de decisiones y estado — Proyecto controlHoras

> Documento vivo, en lenguaje no técnico, pensado para reuniones y seguimiento.
> Para el detalle técnico ver:
> - Diseño: [`specs/2026-06-23-hucha-presupuestos-design.md`](specs/2026-06-23-hucha-presupuestos-design.md)
> - Plan de implementación 1: [`plans/2026-06-23-plan1-fundacion-datos-ledger.md`](plans/2026-06-23-plan1-fundacion-datos-ledger.md)

**Última actualización:** 2026-06-23 (Plan 1 completado)

---

## 1. Qué estamos construyendo

Dos aplicaciones internas relacionadas para Bastida & Fariña, que comparten una misma base:

1. **Control de Horas** — registro de horas del equipo con "bancos de horas" por cliente/proyecto/área, alertas, dashboard. Ya existe una primera versión muy básica.
2. **Presupuesto HUCHA** — versión simple del mismo concepto de "banco", pero con **dinero**: cada proyecto tiene una hucha de presupuesto; los managers registran gastos (consumos) y administración la amplía.

---

## 2. Decisiones tomadas (con su porqué)

| # | Decisión | Por qué | Estado |
|---|---|---|---|
| D1 | **Empezar por HUCHA**, no por Horas | HUCHA es la app simple y ejercita la misma base (usuarios, banco, historial, dashboard, export) con mucho menos riesgo y entrega rápida | Firme |
| D2 | **Construir una "fundación compartida"** al hacer HUCHA | Usuarios+roles, proyectos y el "banco+historial" se diseñan una vez y Horas los reutiliza después | Firme |
| D3 | **Nombre: HUCHA** (con H) | El PDF lo escribe "UCHA" sin H; es un error. Se usa HUCHA en todo | Firme |
| D4 | **Moneda: EUR (euros)** | Confirmado por el cliente; el PDF usaba USD en ejemplos | Firme |
| D5 | **3 roles**: operativo / manager / admin | Suficiente para ambas apps; se fusiona "Administración" y "Admin" en uno | Firme (revisable a 4 roles si hace falta) |
| D6 | **No tocar la versión actual de Horas**; construir al lado y reconstruir Horas después | La versión actual se reescribirá igual (para registro multilínea); migrarla ahora sería trabajo doble | Firme |
| D7 | **Banco + "ledger" (libro de movimientos)** como patrón central | Guardar cada movimiento (no solo el saldo) da auditoría completa y permite corregir sin borrar | Firme |
| D8 | **El manager puede descargar los datos de sus proyectos** | Es el mismo dato que ya ve; sin coste técnico | **Revisable en reunión** (el PDF da la descarga solo al admin) |
| D9 | **"Usuario autorizado" que amplía = admin** por ahora | Con 3 roles, ese permiso recae en admin | Revisable (futuro 4º rol) |
| D10 | **Design system de plataforma: shadcn/ui + estética "Estudio"** (editorial/suizo: formal, elegante, atemporal, cómoda) | Consistencia visual profesional en **toda la plataforma**, anclada al producto principal (Control de Horas); HUCHA la hereda. Tokens globales en `app/globals.css`/`app/layout.tsx`. Se descartó "Tesorería" por sesgo a dinero | Firme |
| D11 | **Trabajar directo sobre producción** (Supabase y git) | El proyecto aún no está en uso → es seguro y ágil | Firme (mientras no haya usuarios reales) |

---

## 3. Alcance de HUCHA (resumen)

**Incluye:** login, usuarios creados por admin con proyectos asignados, presupuesto por proyecto (empieza en 0), registro individual de consumo, descuento automático, ampliación solo admin, historial de movimientos, dashboard con estados, y descarga Excel/CSV.

**No incluye** (es de Horas, lo dice el propio PDF): registro multilínea, etapas, departamento, banco por rol, cálculo por usuario, flujos de aprobación.

**Estados de una hucha:** sin presupuesto · disponible · bajo · consumido · excedido.

---

## 4. Plan de trabajo por fases

- **Plan 1 — Fundación de datos + Ledger** (base de datos): usuarios/roles, proyectos, asignaciones, banco+movimientos y sus reglas. *(en curso)*
- **Plan 2 — App HUCHA (Manager):** pantallas del manager (sus proyectos, registrar consumo, historial).
- **Plan 3 — App HUCHA (Admin + Dashboard + Descargas):** gestión de usuarios/proyectos, ampliar/corregir, dashboard global y exports.

Cada plan deja software funcionando y probado antes de pasar al siguiente.

---

## 5. Estado de avance

### Plan 1 — Fundación de datos + Ledger — ✅ COMPLETADO
| Task | Descripción | Estado |
|---|---|---|
| 1 | Usuarios/roles, proyectos, asignaciones (+ creación automática de perfil, permisos base) | ✅ Completada y revisada |
| 2 | Tablas de la hucha (banco + movimientos), estados y creación automática de la hucha al crear proyecto | ✅ Completada y revisada |
| 3 | Motor del libro de movimientos (registrar consumo/ampliación/anulación con sus validaciones) | ✅ Completada y revisada |
| 4 | Reglas de seguridad/permisos a nivel base de datos (RLS) | ✅ Completada y revisada |

**Review final de toda la rama: ✅ aprobado** — esquema coherente, seguridad de punta a punta (sin escalación de rol, sin escritura directa de saldos, aislamiento entre managers), cuentas del dinero correctas. Sin hallazgos graves; 6 observaciones menores registradas y diferidas.

**Método de calidad:** cada pieza se construye con prueba primero (falla → se implementa → pasa), se revisa de forma independiente, y se corrige antes de avanzar. Migraciones aplicadas a producción vía Supabase; un hallazgo importante (anular una anulación) se detectó en review y se corrigió con su propio test.

**Lo que ya existe en la base de datos:** las 5 tablas, la creación automática de la hucha al crear un proyecto, el alta automática de perfil al crear un usuario, y el motor que registra consumos/ampliaciones/anulaciones manteniendo el saldo y el historial — todo con permisos por rol. Falta solo la interfaz (Planes 2 y 3).

### Próximo: Plan 2 — App HUCHA (Manager)
Pantallas del manager: sus proyectos con saldo, registrar consumo, historial. ⏳ Por planificar.

---

## 6. Temas a confirmar en la reunión
1. **Descargas del manager** (D8) — ¿se mantiene o se restringe a solo admin?
2. **¿Hace falta un 4º rol** (alguien que amplíe presupuesto sin ser admin completo)? (D9)
3. Validar la frontera de alcance HUCHA vs Horas y el orden de fases.

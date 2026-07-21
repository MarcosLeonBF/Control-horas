// Carga del histórico mensual de horas (spec 2026-07-21-horas-historicas-carga-design).
//
// La hoja HorasHistoricas_CONTROLHORAS tiene una pestaña por persona y sus filas
// son CIERRES MENSUALES (fecha = último día del mes), no registros diarios.
//
//   node scripts/import-horas-historicas.mjs             → dry-run (no escribe nada)
//   node scripts/import-horas-historicas.mjs --apply     → borra por source e inserta
//
// Es re-ejecutable: --apply borra lo previo de este mismo source antes de insertar,
// así que corregir la hoja y relanzar deja el resultado idéntico, nunca duplicado.

// .env.local lo carga Next automáticamente, pero dotenv por defecto solo mira .env.
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const SHEET_ID = '1iPmvHkzGkAW5_3YJ1usdWcRfulPE4D8q4eUrrzLDdDY'
const SOURCE = 'HorasHistoricas_CONTROLHORAS'
const APPLY = process.argv.includes('--apply')

const fail = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1) }

// --- CSV: parser con comillas (las descripciones y nombres pueden llevar comas) ---
function parseCsv(text) {
  const rows = []
  let field = '', row = [], quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

// --- Fechas: la hoja usa M/D/YYYY y SIEMPRE el último día del mes ---
function parseMonthEnd(raw) {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return { error: `fecha ilegible: "${raw}"` }
  const M = Number(m[1]), D = Number(m[2]), Y = Number(m[3])
  if (M < 1 || M > 12) return { error: `mes fuera de rango: "${raw}"` }
  const ultimoDia = new Date(Y, M, 0).getDate()
  // Premisa del diseño: si aparece un día que no es cierre de mes, la hoja ha
  // cambiado de naturaleza y el modelo de tabla aparte deja de estar justificado.
  if (D !== ultimoDia) return { error: `"${raw}" no es fin de mes (el mes acaba el ${ultimoDia})` }
  return { month: `${Y}-${String(M).padStart(2, '0')}` }
}

async function get(url, what) {
  const res = await fetch(url)
  if (!res.ok) fail(`no se pudo descargar ${what} (HTTP ${res.status}). ¿Sigue siendo pública la hoja?`)
  return res.text()
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) fail('faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  const db = createClient(url, key, { auth: { persistSession: false } })

  // --- 1. Descubrir las pestañas (no se fijan: una pestaña nueva se recoge sola) ---
  const html = await get(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`, 'el índice de la hoja')
  const gids = [...new Set([...html.matchAll(/gid=(\d+)/g)].map((m) => m[1]))]
  if (!gids.length) fail('no se encontró ninguna pestaña en la hoja')
  console.log(`Pestañas encontradas: ${gids.length}`)

  // --- 2. Descargar y parsear ---
  const filas = []
  const errores = []
  for (const gid of gids) {
    const csv = await get(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`,
      `la pestaña ${gid}`,
    )
    const rows = parseCsv(csv)
    if (!rows.length) continue
    const head = rows[0].map((h) => h.trim())
    for (const raw of rows.slice(1)) {
      if (!raw.some((v) => v && v.trim())) continue // fila en blanco
      const o = {}
      head.forEach((h, i) => { o[h] = (raw[i] ?? '').trim() })
      const usuario = o['Usuario']
      if (!usuario) continue

      const fecha = parseMonthEnd(o['Fecha'])
      if (fecha.error) { errores.push(`${usuario}: ${fecha.error}`); continue }

      const hours = Number(o['Horas'])
      if (!Number.isFinite(hours) || hours <= 0) {
        errores.push(`${usuario} (${o['Fecha']}): horas inválidas "${o['Horas']}"`); continue
      }
      if (!o['Proyecto']) { errores.push(`${usuario} (${o['Fecha']}): fila sin proyecto`); continue }

      filas.push({
        usuario,
        month: fecha.month,
        project: o['Proyecto'],
        department: o['Departamento'] || '—',
        etapa: o['Etapa'] || '—',
        area: o['Área'] || null,
        hours,
        description: o['Descripción'] || null,
      })
    }
  }
  if (errores.length) {
    console.error('\nFilas inválidas:')
    for (const e of errores.slice(0, 25)) console.error('  -', e)
    if (errores.length > 25) console.error(`  … y ${errores.length - 25} más`)
    fail(`${errores.length} filas no se pueden importar. No se ha escrito nada.`)
  }
  console.log(`Filas leídas: ${filas.length}`)

  // --- 3. Resolver usuarios contra perfiles (abortar si alguno no existe) ---
  const { data: profiles, error: pErr } = await db.from('profiles').select('id, full_name')
  if (pErr) fail(`no se pudieron leer los perfiles: ${pErr.message}`)
  const idPorNombre = new Map()
  const repetidos = new Set()
  for (const p of profiles ?? []) {
    if (!p.full_name) continue
    if (idPorNombre.has(p.full_name)) repetidos.add(p.full_name)
    idPorNombre.set(p.full_name, p.id)
  }
  const usuariosHoja = [...new Set(filas.map((f) => f.usuario))]
  const sinPerfil = usuariosHoja.filter((u) => !idPorNombre.has(u))
  if (sinPerfil.length) {
    console.error('\nUsuarios de la hoja sin perfil en la BD:')
    for (const u of sinPerfil) console.error('  -', u)
    fail('no se importa nada: cada pestaña debe corresponder a un usuario existente.')
  }
  // Homónimos: el nombre dejaría de identificar a la persona, así que se para.
  const ambiguos = usuariosHoja.filter((u) => repetidos.has(u))
  if (ambiguos.length) {
    console.error('\nNombres duplicados en profiles (no se puede saber a quién imputar):')
    for (const u of ambiguos) console.error('  -', u)
    fail('resuelve los homónimos antes de importar.')
  }

  // --- 4. Avisos: etapas/departamentos fuera de catálogo (no paran la carga) ---
  const [{ data: etapas }, { data: deps }] = await Promise.all([
    db.from('etapas').select('name'),
    db.from('departamentos').select('name'),
  ])
  const norm = (s) => s.toLocaleLowerCase('es')
  const etapasCat = new Set((etapas ?? []).map((e) => norm(e.name)))
  const depsCat = new Set((deps ?? []).map((d) => norm(d.name)))
  const etapasRaras = [...new Set(filas.map((f) => f.etapa).filter((e) => !etapasCat.has(norm(e))))]
  const depsRaros = [...new Set(filas.map((f) => f.department).filter((d) => !depsCat.has(norm(d))))]
  if (etapasRaras.length) console.log(`⚠ Etapas fuera de catálogo: ${etapasRaras.join(', ')}`)
  if (depsRaros.length) console.log(`⚠ Departamentos fuera de catálogo: ${depsRaros.join(', ')}`)

  // --- 5. Informe ---
  const porUsuario = new Map()
  const porMes = new Map()
  let total = 0
  for (const f of filas) {
    porUsuario.set(f.usuario, (porUsuario.get(f.usuario) ?? 0) + f.hours)
    porMes.set(f.month, (porMes.get(f.month) ?? 0) + f.hours)
    total += f.hours
  }
  const r2 = (n) => Math.round(n * 100) / 100
  console.log('\nHoras por persona:')
  for (const [u, h] of [...porUsuario].sort((a, b) => b[1] - a[1])) console.log(`   ${u.padEnd(30)} ${r2(h)}`)
  console.log('\nHoras por mes:')
  for (const [m, h] of [...porMes].sort()) console.log(`   ${m}   ${r2(h)}`)
  console.log(`\nTOTAL: ${r2(total)} h en ${filas.length} filas, ${porUsuario.size} personas, ${porMes.size} meses`)

  if (!APPLY) {
    console.log('\n— DRY-RUN: no se ha escrito nada. Repite con --apply para cargar. —')
    return
  }

  // --- 6. Carga (borra este source y reinserta: idempotente) ---
  const registros = filas.map((f) => ({
    user_id: idPorNombre.get(f.usuario),
    month: f.month,
    project: f.project,
    department: f.department,
    etapa: f.etapa,
    area: f.area,
    hours: f.hours,
    description: f.description,
    source: SOURCE,
  }))

  const { error: delErr } = await db.from('horas_historicas').delete().eq('source', SOURCE)
  if (delErr) fail(`no se pudo limpiar la carga anterior: ${delErr.message}`)

  const LOTE = 500
  let insertadas = 0
  for (let i = 0; i < registros.length; i += LOTE) {
    const chunk = registros.slice(i, i + LOTE)
    const { error } = await db.from('horas_historicas').insert(chunk)
    if (error) fail(`fallo insertando el lote ${i / LOTE + 1}: ${error.message} (ya se habían insertado ${insertadas})`)
    insertadas += chunk.length
    console.log(`   insertadas ${insertadas}/${registros.length}`)
  }
  console.log(`\n✓ Carga completada: ${insertadas} filas con source="${SOURCE}".`)
}

main().catch((e) => fail(e?.message ?? String(e)))

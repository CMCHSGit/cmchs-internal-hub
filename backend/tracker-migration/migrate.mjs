// The demo tracker's data, from its Realtime Database into Firestore (step 5B,
// STEP-5-PLAN.md). Run by hand at the cutover, and as often as wanted before
// it: it works out the documents with the tracker's own fs-shape.js, compares
// them with what Firestore already has, and writes only the difference, so a
// second run writes nothing. A dry run unless --write. It prints counts only,
// never names.
//
//   cd backend/tracker-migration && npm install
//   node migrate.mjs --from live                     (reads the database)
//   node migrate.mjs --from Demo-Tracker-2026-10-19.json --reports "<folder>"   (the nightly backup)
//   ... --write                                        (actually write; then it checks)
//   ... --check                                        (only the check)
//
// Credentials are never in this repo: HUB_SA is the path to a service-account
// key for the staff schedule's Firebase project (where Firestore is), CHS_SA one
// for chs-equipment (only for --from live). With FIRESTORE_EMULATOR_HOST set,
// it writes to the emulator instead and needs no HUB_SA.
//
// What moves: data (equipment, history, loanMeta), loanDocs, upcomingLoans,
// retired, kitGroups, customDemoTypes, simproConfig, auditLog, and test
// reports (testReports + testReportFiles). What doesn't: config (the admin
// password is not copied anywhere), accountManagers (the team goes into users,
// step 5A), the proxy's sent-reminder markers (returnDueSoonReminders,
// demoReminders, stuckLoanReminders: they stay with it until it moves), _v.
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { COLLECTIONS, SETTINGS_DOC, chunksOf, diffDocs, fromDocs, pack, same, toDocs } from '../../apps/equipment/src/fs-shape.js'
import { nzDate, statusOf } from '../../apps/equipment/src/model.js'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const has = (name) => args.includes(name)
const from = opt('--from'), reportsDir = opt('--reports')
const write = has('--write'), checkOnly = has('--check')
if (!from) { console.error('Say where from: --from live, or --from <Demo-Tracker-….json>'); process.exit(2) }

const RTDB_URL = 'https://chs-equipment-default-rtdb.asia-southeast1.firebasedatabase.app'
const MOVED = ['data', 'loanDocs', 'upcomingLoans', 'retired', 'kitGroups', 'customDemoTypes', 'simproConfig', 'auditLog', 'testReports', 'testReportFiles']
// The proxy's sent-reminder markers stay with it until its reminders move (5B).
const LEFT = ['config', 'accountManagers', 'returnDueSoonReminders', 'demoReminders', 'stuckLoanReminders']
const list = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []).filter((x) => x && typeof x === 'object')

/* ── Firestore (the hub's project, or the emulator) ── */
const hubApp = process.env.FIRESTORE_EMULATOR_HOST
  ? initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'rules-test' }, 'hub')
  : initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.HUB_SA || fail('HUB_SA is not set'), 'utf8'))) }, 'hub')
const fs = getFirestore(hubApp)
function fail(msg) { console.error(msg); process.exit(2) }

/* ── The source ── */
async function readSource() {
  if (from === 'live') {
    const key = JSON.parse(readFileSync(process.env.CHS_SA || fail('CHS_SA is not set'), 'utf8'))
    if (key.project_id !== 'chs-equipment') fail('CHS_SA is not a chs-equipment key')
    const db = getDatabase(initializeApp({ credential: cert(key), databaseURL: RTDB_URL }, 'chs'))
    const tree = {}
    for (const p of MOVED) tree[p] = (await db.ref(p).get()).val()
    const top = Object.keys(await fetchShallow(db))
    return { tree, top, files: (k, id) => tree.testReportFiles?.[k]?.[id] ?? null }
  }
  const tree = JSON.parse(readFileSync(from, 'utf8'))
  // The backup saves each file as <key>--<id>.txt with \ / : * ? " < > | turned
  // into _ (backup/Code.js); try that name, and the raw one for older copies.
  const files = (k, id) => {
    if (!reportsDir) return null
    const raw = `${k}--${id}`
    for (const name of new Set([raw.replace(/[\\/:*?"<>|]/g, '_'), raw])) {
      const f = join(reportsDir, `${name}.txt`)
      if (existsSync(f)) return readFileSync(f, 'utf8')
    }
    return null
  }
  return { tree, top: Object.keys(tree), files }
}
async function fetchShallow(db) {
  // Only the top-level names, not everything under them.
  const token = await db.app.options.credential.getAccessToken()
  const r = await fetch(`${RTDB_URL}/.json?shallow=true&access_token=${token.access_token}`)
  return r.ok ? r.json() : {}
}

/** The source as the tracker's state, with what had to be fixed on the way. */
function stateOf(tree) {
  const d = tree.data || {}
  const fixes = { itemsWithoutId: 0, duplicateItemIds: 0, historyWithoutId: 0, duplicateHistoryIds: 0, retiredWithoutId: 0 }
  const ids = (arr, prefix, noId, dup) => {
    const seen = new Set()
    return list(arr).map((e, i) => {
      let id = e.id
      // From what it holds, so the same entry gets the same id on every run.
      if (!id) { fixes[noId]++; id = `${prefix}_mig_` + createHash('sha1').update(JSON.stringify(e)).digest('hex').slice(0, 12) }
      if (seen.has(id)) { fixes[dup]++; id = `${id}_mig_${i}` }
      seen.add(id)
      return id === e.id ? e : { ...e, id }
    })
  }
  const state = {
    equipment: ids(d.equipment, 'id', 'itemsWithoutId', 'duplicateItemIds'),
    history: ids(d.history, 'h', 'historyWithoutId', 'duplicateHistoryIds'),
    retired: ids(tree.retired, 'r', 'retiredWithoutId', 'retiredWithoutId'),
    loanMeta: d.loanMeta || {}, loanDocs: tree.loanDocs || {}, upcoming: Object.entries(tree.upcomingLoans || {}).filter(([, u]) => u && typeof u === 'object').map(([k, u]) => (u.id ? u : { ...u, id: k })),
    kits: tree.kitGroups || {}, demoTypes: Array.isArray(tree.customDemoTypes) ? tree.customDemoTypes : list(tree.customDemoTypes),
    simproConfig: tree.simproConfig || {},
  }
  return { state, fixes }
}

/* ── What Firestore has now ── */
async function readFirestore() {
  const out = {}
  for (const [name, col] of Object.entries(COLLECTIONS)) {
    const snap = await fs.collection(col).get()
    out[name] = new Map(snap.docs.map((d) => [d.id, d.data()]))
  }
  const s = await fs.doc(SETTINGS_DOC.join('/')).get()
  out.settings = s.exists ? s.data() : null
  return out
}

/** The Equipment view's five counts (statusOf, test loans hidden as on screen). */
function fiveCounts(state, today) {
  const c = { available: 0, booked: 0, 'on-loan': 0, overdue: 0, longterm: 0 }
  for (const e of state.equipment) c[statusOf(e, { today, upcoming: state.upcoming, loanMeta: state.loanMeta, loanDocs: state.loanDocs }).key]++
  return c
}

/* ── Writing, a few hundred at a time ── */
async function writeAll(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    const b = fs.batch()
    for (const w of writes.slice(i, i + 400)) {
      const ref = fs.collection(w.col).doc(w.id)
      if (w.data) b.set(ref, w.data); else b.delete(ref)
    }
    await b.commit()
  }
}

async function migrateAudit(tree) {
  const entries = Object.entries(tree.auditLog || {}).filter(([, e]) => e && typeof e === 'object')
  const have = new Set((await fs.collection('equipmentAudit').select().get()).docs.map((d) => d.id))
  const todo = entries.filter(([id]) => !have.has(id))
  if (write) await writeAll(todo.map(([id, e]) => ({ col: 'equipmentAudit', id, data: pack({ ...e, id: e.id || id }) })))
  return { inSource: entries.length, alreadyThere: entries.length - todo.length, toWrite: todo.length }
}

async function migrateReports(tree, files) {
  let inSource = 0, alreadyThere = 0, toWrite = 0, missingFile = 0
  for (const [key, reports] of Object.entries(tree.testReports || {})) {
    for (const [id, meta] of Object.entries(reports || {})) {
      inSource++
      const ref = fs.collection('loans').doc(key).collection('reports').doc(id)
      if ((await ref.get()).exists) { alreadyThere++; continue }
      const file = files(key, id)
      if (file == null) { missingFile++; continue }
      toWrite++
      if (!write) continue
      const parts = chunksOf(file)
      await ref.set({ filename: meta.filename || 'report', mimeType: meta.mimeType || 'application/octet-stream', size: Number(meta.size) || file.length,
        uploadedAt: meta.uploadedAt || '', uploadedBy: meta.uploadedBy || '', chunks: parts.length })
      for (let i = 0; i < parts.length; i += 4) {
        const b = fs.batch()
        parts.slice(i, i + 4).forEach((c, k) => b.set(ref.collection('chunks').doc(String(i + k)), { data: c }))
        await b.commit()
      }
    }
  }
  return { inSource, alreadyThere, toWrite, missingFile }
}

/** Reads Firestore back and compares it with the source: counts, then every list. */
async function check(state, today) {
  const back = fromDocs(await readFirestore())
  const a = fiveCounts(state, today), b = fiveCounts(back, today)
  const rows = [
    ['equipment', state.equipment.length, back.equipment.length],
    ['history', state.history.length, back.history.length],
    ['retired', state.retired.length, back.retired.length],
    ['loan forms', Object.keys(state.loanDocs).length, Object.keys(back.loanDocs).length],
    ['loan meta', Object.keys(state.loanMeta).length, Object.keys(back.loanMeta).length],
    ['bookings', state.upcoming.length, back.upcoming.length],
    ['kits', Object.keys(state.kits).length, Object.keys(back.kits).length],
    ...Object.keys(a).map((k) => ['Equipment view: ' + k, a[k], b[k]]),
  ]
  const byId = (arr) => new Map(arr.map((x) => [x.id, x]))
  const differing = (x, y) => { let n = 0; for (const [id, v] of x) if (!same(v, y.get(id))) n++; return n }
  rows.push(['items not exactly the same', 0, differing(byId(state.equipment), byId(back.equipment))])
  rows.push(['history entries not the same', 0, differing(byId(state.history), byId(back.history))])
  rows.push(['history out of order', 0, state.history.some((h, i) => back.history[i]?.id !== h.id) ? 1 : 0])
  rows.push(['loan forms not the same', 0, differing(new Map(Object.entries(state.loanDocs)), new Map(Object.entries(back.loanDocs)))])
  rows.push(['loan meta not the same', 0, differing(new Map(Object.entries(state.loanMeta)), new Map(Object.entries(back.loanMeta)))])
  rows.push(['bookings not the same', 0, differing(byId(state.upcoming), byId(back.upcoming))])
  rows.push(['test reports', Object.values(tree.testReports || {}).reduce((n, r) => n + Object.keys(r || {}).length, 0), (await fs.collectionGroup('reports').get()).size])
  rows.push(['audit entries', Object.keys(tree.auditLog || {}).length, (await fs.collection('equipmentAudit').count().get()).data().count])
  console.log('\nCheck (source → Firestore):')
  let bad = 0
  for (const [label, x, y] of rows) { const ok = x === y; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'DIFF'}  ${label}: ${x} → ${y}`) }
  console.log(bad ? `\n${bad} differ: do not switch over.` : '\nEverything matches.')
  return bad
}

/* ── Run ── */
const today = nzDate()
const { tree, top, files } = await readSource()
const { state, fixes } = stateOf(tree)
console.log(`Source: ${from === 'live' ? 'the live database' : 'a backup file'}${write ? '' : checkOnly ? ' (check only)' : ' (dry run: nothing written)'}`)
console.log(`  items ${state.equipment.length}, history ${state.history.length}, retired ${state.retired.length}, loan forms ${Object.keys(state.loanDocs).length}, loan meta ${Object.keys(state.loanMeta).length}, bookings ${state.upcoming.length}, kits ${Object.keys(state.kits).length}`)
// The new rules want an asset number on every item: one without can't be edited after.
const noAssetNo = state.equipment.filter((e) => !String(e.CHSAssetNo || '').trim()).length
if (noAssetNo) console.log(`  WARNING: ${noAssetNo} items have no asset number; give them one in the tracker first`)
const fixed = Object.entries(fixes).filter(([, n]) => n)
if (fixed.length) console.log('  fixed on the way: ' + fixed.map(([k, n]) => `${k} ${n}`).join(', '))
const other = top.filter((p) => !MOVED.includes(p) && !LEFT.includes(p) && p !== '_v')
console.log(`  not moved: ${LEFT.filter((p) => top.includes(p)).join(', ') || 'none'}${other.length ? `; NOT KNOWN, look at these: ${other.join(', ')}` : ''}`)

if (!checkOnly) {
  const before = await readFirestore()
  const after = toDocs(state, { prev: before, today })
  const writes = diffDocs(before, after)
  const count = (pred) => writes.filter(pred).length
  console.log(`\nDocuments to write: ${writes.length} (${Object.values(COLLECTIONS).map((c) => `${c} ${count((w) => w.col === c)}`).join(', ')}, settings ${count((w) => w.col === SETTINGS_DOC[0])})`)
  const deletes = count((w) => !w.data)
  if (deletes) console.log(`  of which deletes: ${deletes} (in Firestore but no longer in the source)`)
  if (write) await writeAll(writes)
  console.log('Audit log:', JSON.stringify(await migrateAudit(tree)))
  console.log('Test reports:', JSON.stringify(await migrateReports(tree, files)))
  if (!write) console.log('\nDry run: nothing written. Add --write to write it.')
}
if (write || checkOnly) process.exitCode = (await check(state, today)) ? 1 : 0

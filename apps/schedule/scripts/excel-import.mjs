#!/usr/bin/env node
/**
 * Automatic Excel → schedule import, run on a PC by Windows Task Scheduler (see EXCEL-IMPORT.md).
 *
 *   node apps/schedule/scripts/excel-import.mjs            what it would change — writes nothing
 *   node apps/schedule/scripts/excel-import.mjs --apply    import for real
 *
 * Options: --config <file> (default %USERPROFILE%\.cmchs\excel-import.json), --force (run even if the
 * workbook hasn't changed), --weeks-back <n>, --max-changes <n> (override the config for one run).
 *
 * The config file (kept on the PC, never in this repo):
 *   { "workbook": "C:\\...\\CMCHS Staff Schedule 2024.xlsx",   the OneDrive-synced copy
 *     "serviceAccount": "C:\\...\\firebase-service-account.json",
 *     "weeksBack": 2,            import from this many weeks ago onwards (0 = this week)
 *     "maxChanges": 150 }        refuse a run that would change more than this many entries
 *
 * Logs (counts only — never names) go to excel-import.log beside the config, and real changes also to the
 * activity log in the hub's Admin settings. Exit code: 0 fine, 2 refused (too many changes), 1 failed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getCurrentWeekStart } from '../src/utils/week.js'
import { readWorkbook, runImport } from './excelImportJob.mjs'

const RECHECK_MS = 60 * 60 * 1000   // even with the workbook unchanged, look again hourly (people sign in, edits in the app)
const LOG_LIMIT = 512 * 1024         // keep the log under half a megabyte
const WEEKS_PER_QUERY = 30           // Firestore's `in` limit
const WRITES_PER_BATCH = 400

// ── arguments and config ──

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const configFile = path.resolve(option('--config') || path.join(os.homedir(), '.cmchs', 'excel-import.json'))
const dir = path.dirname(configFile)
const logFile = path.join(dir, 'excel-import.log')
const stateFile = path.join(dir, 'excel-import-state.json')
const apply = flag('--apply')

function log(line) {
  const text = `${new Date().toLocaleString('sv-SE')} ${apply ? '' : '[dry run] '}${line}` // local time, "2026-10-15 09:54:16"
  console.log(text)
  try {
    fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > LOG_LIMIT) {
      const kept = fs.readFileSync(logFile, 'utf8').slice(-LOG_LIMIT / 2)
      fs.writeFileSync(logFile, kept.slice(kept.indexOf('\n') + 1))
    }
    fs.appendFileSync(logFile, text + '\n')
  } catch { /* logging must never stop the import */ }
}

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }

// ── the database, through firebase-admin ──

function firestoreStore(serviceAccountFile) {
  const key = JSON.parse(fs.readFileSync(serviceAccountFile, 'utf8'))
  const db = getFirestore(initializeApp({ credential: cert(key) }))
  return {
    now: () => FieldValue.serverTimestamp(),
    async loadUsers() {
      return (await db.collection('users').get()).docs.map(d => ({ uid: d.id, ...d.data() }))
    },
    async loadSchedules(weeks) {
      const out = new Map()
      for (let i = 0; i < weeks.length; i += WEEKS_PER_QUERY) {
        const snap = await db.collection('schedules').where('weekStart', 'in', weeks.slice(i, i + WEEKS_PER_QUERY)).get()
        snap.docs.forEach(d => out.set(d.id, d.data()))
      }
      return out
    },
    async loadOnCall(weeks) {
      if (!weeks.length) return new Map()
      const snaps = await db.getAll(...weeks.map(w => db.collection('oncall').doc(w)))
      return new Map(snaps.filter(s => s.exists).map(s => [s.id, s.data()]))
    },
    async commit(ops) {
      for (let i = 0; i < ops.length; i += WRITES_PER_BATCH) {
        const batch = db.batch()
        for (const op of ops.slice(i, i + WRITES_PER_BATCH)) batch.set(db.collection(op.collection).doc(op.id), op.data, { merge: op.merge })
        await batch.commit()
      }
    },
    async logActivity(summary) {
      await db.collection('activity').add({ uid: null, name: 'Excel import (automatic)', email: null, summary, at: FieldValue.serverTimestamp() })
    },
  }
}

// ── one run ──

async function main() {
  const config = readJSON(configFile, null)
  if (!config) throw new Error(`No config at ${configFile} — see apps/schedule/EXCEL-IMPORT.md.`)
  for (const k of ['workbook', 'serviceAccount']) if (!config[k] || !fs.existsSync(config[k])) throw new Error(`"${k}" in the config is missing or the file isn't there.`)

  // Most runs find the workbook as it was: skip them, apart from an hourly look for changes on the app's side.
  const stat = fs.statSync(config.workbook)
  const state = readJSON(stateFile, {})
  const unchanged = state.mtimeMs === stat.mtimeMs && state.size === stat.size
  if (apply && unchanged && !flag('--force') && Date.now() - (state.checkedAt || 0) < RECHECK_MS) return 0

  const weeksBack = Number(option('--weeks-back') ?? config.weeksBack ?? 2)
  const maxChanges = Number(option('--max-changes') ?? config.maxChanges ?? 150)
  const workbook = await readWorkbook(config.workbook)
  const result = await runImport({ workbook, store: firestoreStore(config.serviceAccount), fromWeek: getCurrentWeekStart(-weeksBack), apply, maxChanges })

  if (result.status === 'too-many') {
    log(`REFUSED — ${result.changes} changes is more than the limit of ${maxChanges}. Nothing written. Check the workbook, then run once by hand with --max-changes ${result.changes} if it's right. (${result.summary})`)
    return 2
  }
  log(`${result.status === 'done' ? 'Imported' : result.status === 'nothing' ? 'Up to date' : 'Would import'} — ${result.changes} changes, ${result.writes} documents. ${result.summary}`)
  if (apply) fs.writeFileSync(stateFile, JSON.stringify({ mtimeMs: stat.mtimeMs, size: stat.size, checkedAt: Date.now() }))
  return 0
}

main().then(code => process.exit(code), e => {
  log(`FAILED — ${e.message}`)
  process.exit(1)
})

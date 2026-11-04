#!/usr/bin/env node
/**
 * On-call roster → hub and schedule, run on a PC (see EXCEL-IMPORT.md, "On-call roster").
 *
 *   node apps/schedule/scripts/oncall-sync.mjs            what it would write — changes nothing
 *   node apps/schedule/scripts/oncall-sync.mjs --apply    write for real
 *
 * Reads the OneDrive-synced "Oncall roster.xlsx" and writes it to the hub's On-call roster page and to the schedule's
 * weekly on-call (who is "Name - OnCall" on the Team week). The roster file wins where they disagree.
 *
 * Config (the same file as the import, %USERPROFILE%\.cmchs\excel-import.json), extra keys:
 *   "oncallRoster": "C:\\...\\Oncall Roster and Schedules\\Oncall roster.xlsx"    off unless this is set
 *   "oncallWeeksBack": 2        weeks before this one still set from the file
 *   "oncallRecheckMinutes": 60  an unchanged file is looked at again (the schedule's weeks only) this often
 *
 * Logs (counts only — never names) go to excel-import.log beside the config. Exit code: 0 fine, 1 failed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { reportRun } from './jobStatus.mjs'
import { getCurrentWeekStart } from '../src/utils/week.js'
import { readWorkbook } from './excelImportJob.mjs'
import { runOnCallSync } from './oncallSyncJob.mjs'
import { sheetId } from '../../oncall/src/parse.js'

const LOG_LIMIT = 512 * 1024
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const configFile = path.resolve(option('--config') || path.join(os.homedir(), '.cmchs', 'excel-import.json'))
const dir = path.dirname(configFile)
const logFile = path.join(dir, 'excel-import.log')
const stateFile = path.join(dir, 'oncall-sync-state.json')
const apply = flag('--apply')

let lastLine = ''
let keyFile = null

function log(line) {
  lastLine = line
  const text = `${new Date().toLocaleString('sv-SE')} ${apply ? '' : '[dry run] '}On-call roster: ${line}`
  console.log(text)
  try {
    fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > LOG_LIMIT) {
      const kept = fs.readFileSync(logFile, 'utf8').slice(-LOG_LIMIT / 2)
      fs.writeFileSync(logFile, kept.slice(kept.indexOf('\n') + 1))
    }
    fs.appendFileSync(logFile, text + '\n')
  } catch { /* logging must never stop the run */ }
}

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }

function firestoreStore(serviceAccountFile) {
  const key = JSON.parse(fs.readFileSync(serviceAccountFile, 'utf8'))
  const db = getFirestore(initializeApp({ credential: cert(key) }))
  return {
    async loadUsers() { return (await db.collection('users').get()).docs.map(d => ({ uid: d.id, ...d.data() })) },
    async loadOnCall(weeks) {
      if (!weeks.length) return new Map()
      const out = new Map()
      for (let i = 0; i < weeks.length; i += 100) {
        const snaps = await db.getAll(...weeks.slice(i, i + 100).map(w => db.collection('oncall').doc(w)))
        snaps.filter(s => s.exists).forEach(s => out.set(s.id, s.data()))
      }
      return out
    },
    // What an admin's import on the roster page writes (apps/oncall/src/store.js saveImport).
    async saveHistory({ sheets, engineers }) {
      const batch = db.batch()
      const by = 'Roster sync (automatic)'
      for (const s of sheets) batch.set(db.collection('oncallHistory').doc(sheetId(s.name)), { name: s.name, year: s.year, weeks: s.weeks, extras: s.extras, importedAt: FieldValue.serverTimestamp(), importedBy: by })
      batch.set(db.collection('oncallHistory').doc('engineers'), { names: engineers, importedAt: FieldValue.serverTimestamp(), importedBy: by })
      await batch.commit()
    },
    // What the schedule's own on-call write holds (scheduleStore.js patchOnCall), merged into the week's doc.
    async commitOnCall(writes) {
      const batch = db.batch()
      for (const w of writes) batch.set(db.collection('oncall').doc(w.weekStart), { uid: w.uid, displayName: w.displayName, updatedBy: null, updatedAt: FieldValue.serverTimestamp(), importedFromRoster: true }, { merge: true })
      await batch.commit()
    },
    async logActivity(summary) {
      await db.collection('activity').add({ uid: null, name: 'On-call roster sync (automatic)', email: null, summary, at: FieldValue.serverTimestamp(), app: 'oncall' })
    },
  }
}

async function main() {
  const config = readJSON(configFile, null)
  if (!config) throw new Error(`No config at ${configFile} — see apps/schedule/EXCEL-IMPORT.md.`)
  if (!config.oncallRoster) return 0 // not set up: nothing to do, nothing to report (keyFile stays unset, so no report)
  keyFile = config.serviceAccount
  for (const k of ['oncallRoster', 'serviceAccount']) if (!fs.existsSync(config[k])) throw new Error(`"${k}" in the config is missing or the file isn't there.`)

  const stat = fs.statSync(config.oncallRoster)
  const state = readJSON(stateFile, {})
  const unchanged = state.mtimeMs === stat.mtimeMs && state.size === stat.size
  const recheckMs = Number(config.oncallRecheckMinutes ?? 60) * 60 * 1000
  if (apply && unchanged && !flag('--force') && Date.now() - (state.checkedAt || 0) < recheckMs) { lastLine = 'Nothing to do (the roster file is as it was)'; return 0 }

  const workbook = await readWorkbook(config.oncallRoster)
  const result = await runOnCallSync({
    workbook, store: firestoreStore(config.serviceAccount), apply,
    fromWeek: getCurrentWeekStart(-Number(option('--weeks-back') ?? config.oncallWeeksBack ?? 2)),
    history: !unchanged || flag('--force') || !apply, // the hub's roster page is rewritten only when the file changed
  })
  if (apply) fs.writeFileSync(stateFile, JSON.stringify({ mtimeMs: stat.mtimeMs, size: stat.size, checkedAt: Date.now() }))
  if (result.status === 'nothing') { lastLine = 'Nothing to do (the schedule already matches the roster)'; return 0 } // the usual run: say nothing
  log(`${{ done: 'Wrote', 'dry-run': 'Would write' }[result.status]} — ${result.summary}`)
  return 0
}

// Every real run is reported to Settings → Background jobs; a dry run is not.
async function finish(code) {
  if (apply && keyFile) await reportRun(keyFile, 'oncall-roster', code === 0, lastLine || 'Nothing to do')
  process.exit(code)
}

main().then(finish, async e => {
  log(`FAILED — ${e.message}`)
  await finish(1)
})

#!/usr/bin/env node
/**
 * Automatic app → Excel copy, run on a PC (see EXCEL-IMPORT.md, "Writing back to the Excel").
 *
 *   node apps/schedule/scripts/excel-export.mjs            what it would write — changes nothing
 *   node apps/schedule/scripts/excel-export.mjs --apply    write for real (needs "writeBack": true in the config)
 *
 * It looks at the same weeks as the import (config "weeksBack" onwards) and changes the cells of the OneDrive-synced
 * workbook that the app has entries for and the Excel doesn't contradict (src/utils/excelExportPlan.js). The changes are
 * made in Excel itself by apply-excel-edits.ps1, so formatting is kept and people can keep editing the file.
 *
 * Config (the same file as the import, %USERPROFILE%\.cmchs\excel-import.json), extra keys:
 *   "writeBack": true       off unless this is true
 *   "maxCells": 60          refuse a run that would change more cells than this
 *
 * Logs (counts only — never names) go to excel-import.log beside the config. Exit code: 0 fine, 2 refused, 1 failed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { initializeApp, cert } from 'firebase-admin/app'
import { reportRun } from './jobStatus.mjs'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getCurrentWeekStart } from '../src/utils/week.js'
import { readWorkbook } from './excelImportJob.mjs'
import { runExport } from './excelExportJob.mjs'

const LOG_LIMIT = 512 * 1024
const WEEKS_PER_QUERY = 30
const here = path.dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const configFile = path.resolve(option('--config') || path.join(os.homedir(), '.cmchs', 'excel-import.json'))
const dir = path.dirname(configFile)
const logFile = path.join(dir, 'excel-import.log')
const apply = flag('--apply')

let lastLine = ''
let keyFile = null // the Firebase key from the config, once read: where the run is reported from
let writeBackOn = false // from the config; only a run with write-back switched on is reported

function log(line) {
  lastLine = line
  const text = `${new Date().toLocaleString('sv-SE')} ${apply ? '' : '[dry run] '}Write-back: ${line}`
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
    async loadSchedules(weeks) {
      const out = new Map()
      for (let i = 0; i < weeks.length; i += WEEKS_PER_QUERY) {
        const snap = await db.collection('schedules').where('weekStart', 'in', weeks.slice(i, i + WEEKS_PER_QUERY)).get()
        snap.docs.forEach(d => out.set(d.id, d.data()))
      }
      return out
    },
    // What the Excel says now, remembered the same way the import remembers it, so the import sees nothing new.
    async commitBases(list) {
      const batch = db.batch()
      for (const b of list) batch.set(db.collection('schedules').doc(b.id), { excelBase: { ...b.base, at: FieldValue.serverTimestamp() } }, { merge: true })
      await batch.commit()
    },
    async logActivity(summary) {
      await db.collection('activity').add({ uid: null, name: 'Excel write-back (automatic)', email: null, summary, at: FieldValue.serverTimestamp() })
    },
  }
}

/** Makes the edits in Excel itself (apply-excel-edits.ps1) and reads back what happened to each cell. */
function applyInExcel(workbookFile, edits) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmchs-excel-edits-'))
  const editsFile = path.join(tmp, 'edits.json'), resultFile = path.join(tmp, 'result.json')
  try {
    fs.writeFileSync(editsFile, JSON.stringify(edits.map(({ sheet, row, col, before, text }) => ({ sheet, row, col, before, text }))), 'utf8')
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'apply-excel-edits.ps1'),
      '-Workbook', workbookFile, '-Edits', editsFile, '-Result', resultFile], { encoding: 'utf8', timeout: 5 * 60 * 1000, windowsHide: true })
    if (!fs.existsSync(resultFile)) return { state: `error: Excel didn't answer (${(r.stderr || '').trim().slice(0, 120) || 'exit ' + r.status})`, statuses: [] }
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8').replace(/^﻿/, ''))
    return { state: result.state, statuses: [].concat(result.statuses || []) }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  const config = readJSON(configFile, null)
  if (!config) throw new Error(`No config at ${configFile} — see apps/schedule/EXCEL-IMPORT.md.`)
  keyFile = config.serviceAccount
  writeBackOn = config.writeBack === true
  for (const k of ['workbook', 'serviceAccount']) if (!config[k] || !fs.existsSync(config[k])) throw new Error(`"${k}" in the config is missing or the file isn't there.`)
  if (apply && config.writeBack !== true) return 0 // switched off: the import side still runs

  const weeksBack = Number(option('--weeks-back') ?? config.weeksBack ?? 2)
  const maxCells = Number(option('--max-cells') ?? config.maxCells ?? 60)
  const workbook = await readWorkbook(config.workbook)
  const result = await runExport({
    workbook, store: firestoreStore(config.serviceAccount), fromWeek: getCurrentWeekStart(-weeksBack), apply, maxCells,
    applyEdits: async edits => applyInExcel(config.workbook, edits),
  })

  if (result.status === 'nothing') return 0 // the usual run: say nothing, so the log stays readable
  if (result.status === 'too-many') {
    log(`REFUSED — ${result.cells} cells is more than the limit of ${maxCells}. Nothing written. Look at the dry run, then run once by hand with --max-cells ${result.cells} if it's right.`)
    return 2
  }
  if (option('--edits-out') && result.edits) fs.writeFileSync(option('--edits-out'), JSON.stringify(result.edits), 'utf8') // for trying apply-excel-edits.ps1 on a copy
  if (flag('--show') && result.edits) for (const e of result.edits) console.log(`  week ${e.weekStart}  row ${e.row} col ${e.col}  "${e.before}" -> "${e.text}"`) // no names
  const word = { 'dry-run': 'Would write', done: 'Wrote', partial: 'Wrote some', locked: 'The workbook is open read-only, nothing written', error: 'FAILED' }[result.status]
  log(`${word} — ${result.summary}`)
  return result.status === 'error' ? 1 : 0
}

// Every run is reported to Settings → Background jobs, including the quiet ones (nothing to write), but not
// when write-back is switched off or on a dry run.
async function finish(code) {
  if (apply && writeBackOn) await reportRun(keyFile, 'excel-writeback', code === 0, lastLine || 'Nothing to write')
  process.exit(code)
}

main().then(finish, async e => {
  log(`FAILED — ${e.message}`)
  await finish(1)
})

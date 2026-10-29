// npm test -w apps/schedule — the nightly copy of the hub's activity log to Drive (activityBackup_ in
// backend/apps-script/backup/Code.js), run with made-up Google services: what it reads, what it files, where it stops.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../../../backend/apps-script/backup/Code.js', import.meta.url), 'utf8')
const TZ = 'Pacific/Auckland'

const rest = (v) => (typeof v === 'string' ? { stringValue: v } : { timestampValue: v.toISOString() })
function nz(date, fmt) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-NZ', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((x) => [x.type, x.value]))
  return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute)
}

/** The code with fake Google services. `lines` is the log: [{ id, at: Date, name, email, app, summary }]. */
function world(lines, { refuse = 0 } = {}) {
  const w = { props: {}, queries: [], mails: [], folders: new Map(), files: [], logs: [], errors: [], lines }
  const sheetOf = () => {
    const s = { rows: [] }
    s.getRange = (r, c, nr) => ({
      setValues: (vals) => { vals.forEach((row, i) => { s.rows[r - 1 + i] = row }) },
      setBackground() { return this }, setFontColor() { return this }, setFontWeight() { return this }, nr,
    })
    s.getLastRow = () => s.rows.length
    Object.assign(s, { setName() {}, setFrozenRows() {}, setColumnWidths() {}, setColumnWidth() {} })
    return s
  }
  const folder = (name) => {
    const f = { name, made: [], sheets: new Map() }
    f.createFile = (blob) => { f.made.push(blob); return {} }
    f.getFilesByName = (n) => { const id = f.sheets.get(n); return { hasNext: () => !!id, next: () => ({ getId: () => id }) } }
    return f
  }
  const sheets = new Map() // id -> spreadsheet
  const ctx = vm.createContext({
    console: { log: (m) => w.logs.push(m), error: (...m) => w.errors.push(m.join(' ')) }, Logger: { log: (m) => w.logs.push(m) },
    Session: { getActiveUser: () => ({ getEmail: () => 'admin@cass.co.nz' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => w.props[k] ?? null, setProperty: (k, v) => { w.props[k] = v }, deleteProperty: (k) => { delete w.props[k] } }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    MailApp: { sendEmail: (to, subject, body) => w.mails.push({ to, subject, body }) },
    Utilities: { formatDate: (d, tz, fmt) => nz(d, fmt.replace('HHmm', 'HHmm')).replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/, '$1-$2$3'), newBlob: (content, type, name) => ({ content, type, name }) },
    UrlFetchApp: { fetch: (url, opt) => {
      const body = JSON.parse(opt.payload).structuredQuery
      const [gte, lt] = body.where.compositeFilter.filters.map((f) => Date.parse(f.fieldFilter.value.timestampValue))
      w.queries.push({ gte, lt, offset: body.offset, limit: body.limit })
      if (refuse) return { getResponseCode: () => refuse, getContentText: () => '{}' }
      const hits = w.lines.filter((l) => +l.at >= gte && +l.at < lt).sort((a, b) => a.at - b.at).slice(body.offset, body.offset + body.limit)
      const docs = hits.length ? hits.map((l) => ({ document: { name: 'projects/proj/databases/(default)/documents/activity/' + l.id,
        fields: { uid: rest('u-' + l.id), name: rest(l.name), email: rest(l.email), ...(l.app ? { app: rest(l.app) } : {}), summary: rest(l.summary), at: rest(l.at) } } })) : [{ readTime: 'x' }]
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(docs) }
    } },
    DriveApp: {
      getFoldersByName: (n) => { const f = w.folders.get(n); return { hasNext: () => !!f, next: () => f } },
      createFolder: (n) => { const f = folder(n); w.folders.set(n, f); return f },
      getFileById: (id) => ({ moveTo: (f) => { f.sheets.set(sheets.get(id).name, id) } }),
    },
    SpreadsheetApp: {
      create: (name) => { const s = sheetOf(); const id = 'ss' + sheets.size; const ss = { name, id, s, getId: () => id, getActiveSheet: () => s, getSheets: () => [s] }; sheets.set(id, ss); return ss },
      openById: (id) => sheets.get(id),
    },
  })
  vm.runInContext(code, ctx)
  // The script's own token and project functions replace any given above: put the fakes back.
  vm.runInContext("serviceAccountToken_ = () => 'token'; scheduleProjectId_ = () => 'proj'", ctx)
  w.run = (src) => vm.runInContext(src, ctx)
  w.sheet = (name) => [...sheets.values()].find((x) => x.name === name)
  return w
}

const at = (iso) => new Date(iso)
const plain = (x) => JSON.parse(JSON.stringify(x)) // the fake services' arrays belong to another realm: compare as plain data
const log = [
  { id: 'a1', at: at('2026-10-29T20:05:00Z'), name: 'Bob Sales', email: 'bob@cass.co.nz', app: 'projects', summary: 'Waikato: moved the job later' }, // 30 Oct 09:05 NZ
  { id: 'a2', at: at('2026-10-30T01:00:00Z'), name: 'Ann Admin', email: 'ann@cass.co.nz', app: 'equipment', summary: '=HYPERLINK("http://evil")' },
  { id: 'a3', at: at('2026-11-01T00:00:00Z'), name: 'Ann Admin', email: 'ann@cass.co.nz', summary: 'Saved her week' }, // 1 Nov 13:00 NZ; an old line with no app
]

test('rows: the time in NZ, the tool by name, formulas made text', () => {
  const w = world(log)
  const rows = JSON.parse(JSON.stringify(w.run(`activityRows_(${JSON.stringify(log.map((l) => ({ ...l, atMs: +l.at })))}, '${TZ}')`)))
  assert.deepEqual(rows[0], ['2026-10-30 09:05', 'Bob Sales', 'bob@cass.co.nz', 'Projects', 'Waikato: moved the job later', 'a1'])
  assert.equal(rows[1][4], `'=HYPERLINK("http://evil")`)
  assert.equal(rows[2][3], 'Schedule', "a line with no tool is the schedule's")
})

test('the first run copies everything old enough: a JSON file, a spreadsheet a month, the cursor moved', () => {
  const w = world(log)
  w.run(`Date.now = () => ${+at('2026-11-02T00:00:00Z')}`)
  assert.equal(w.run('activityBackup_()'), 3)
  assert.equal(w.queries[0].gte, 0, 'from the beginning')
  assert.equal(w.queries[0].lt, +at('2026-11-02T00:00:00Z') - 10 * 60 * 1000, 'not the last ten minutes')
  const folder = w.folders.get('CMCHS Hub Activity Log Backups')
  assert.equal(folder.made.length, 1)
  assert.match(folder.made[0].name, /^Hub-Activity-2026-11-02-\d{4}\.json$/)
  const json = JSON.parse(folder.made[0].content)
  assert.equal(json.kind, 'hub-activity-backup')
  assert.deepEqual(json.entries.map((e) => e.id), ['a1', 'a2', 'a3'])
  assert.equal(json.entries[0].uid, 'u-a1', 'exactly as stored, who included')
  const oct = w.sheet('Hub activity log 2026-10'), nov = w.sheet('Hub activity log 2026-11')
  assert.deepEqual(plain(oct.s.rows[0]), ['When (NZ)', 'Who', 'Email', 'Tool', 'What', 'Entry id'])
  assert.deepEqual(plain(oct.s.rows.slice(1).map((r) => r[5])), ['a1', 'a2'])
  assert.deepEqual(plain(nov.s.rows.slice(1).map((r) => [r[3], r[5]])), [['Schedule', 'a3']])
  assert.equal(w.props.ACTIVITY_BACKUP_CURSOR_MS, String(+at('2026-11-02T00:00:00Z') - 10 * 60 * 1000))
})

test('the next night: only what is new, added under the month already there', () => {
  const w = world(log)
  w.run(`Date.now = () => ${+at('2026-10-30T10:00:00Z')}`)
  assert.equal(w.run('activityBackup_()'), 2, 'a3 is in the future of this night')
  const cursor = Number(w.props.ACTIVITY_BACKUP_CURSOR_MS)
  w.lines.push({ id: 'a4', at: at('2026-10-30T11:00:00Z'), name: 'Zed', email: 'z@cass.co.nz', app: 'asks', summary: 'Sent an ask' })
  w.run(`Date.now = () => ${+at('2026-11-02T00:00:00Z')}`)
  assert.equal(w.run('activityBackup_()'), 2, 'a4 and a3, not a1 or a2 again')
  assert.equal(w.queries.at(-1).gte, cursor, 'from where the last run stopped')
  assert.deepEqual(w.sheet('Hub activity log 2026-10').s.rows.slice(1).map((r) => r[5]), ['a1', 'a2', 'a4'], 'appended, not rewritten')
  assert.equal(w.folders.get('CMCHS Hub Activity Log Backups').made.length, 2)
})

test('a quiet night files nothing but moves on; paging asks for the next thousand', () => {
  const w = world([])
  w.run(`Date.now = () => ${+at('2026-11-02T00:00:00Z')}`)
  assert.equal(w.run('activityBackup_()'), 0)
  assert.equal(w.folders.size, 0, 'no folder made for nothing')
  assert.ok(w.props.ACTIVITY_BACKUP_CURSOR_MS)
  const busy = world(Array.from({ length: 1001 }, (_, i) => ({ id: 'b' + i, at: new Date(+at('2026-10-30T00:00:00Z') + i * 1000), name: 'X', email: 'x@cass.co.nz', app: 'asks', summary: 's' + i })))
  busy.run(`Date.now = () => ${+at('2026-11-02T00:00:00Z')}`)
  assert.equal(busy.run('activityBackup_()'), 1001)
  assert.deepEqual(busy.queries.map((q) => q.offset), [0, 1000])
})

test('a refusal emails, files nothing and leaves the cursor, so tomorrow starts from the same place', () => {
  const w = world(log, { refuse: 403 })
  w.run(`Date.now = () => ${+at('2026-11-02T00:00:00Z')}`)
  assert.equal(w.run('activityBackup_()'), -1)
  assert.equal(w.mails.length, 1)
  assert.match(w.mails[0].subject, /Activity Log Backup Failed/)
  assert.equal(w.props.ACTIVITY_BACKUP_CURSOR_MS, undefined)
  assert.equal(w.folders.size, 0)
  assert.ok(!JSON.stringify(w.mails).includes('Bob'), 'no names in the email')
})

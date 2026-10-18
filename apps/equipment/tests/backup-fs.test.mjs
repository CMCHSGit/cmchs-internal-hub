// npm test -w apps/equipment — the nightly backup's side of step 5's cutover: after it, the backup reads
// the tracker from Firestore and turns it back into the old database's tree (read straight out of
// backend/apps-script/backup/Code.js, with Firestore's REST answers made from fs-shape.js's documents).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { chunksOf, toDocs } from '../src/fs-shape.js'

const code = readFileSync(new URL('../../../backend/apps-script/backup/Code.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const grab = (name) => { const i = code.indexOf('function ' + name + '('); assert.ok(i >= 0, name); return code.slice(i, code.indexOf('\n}\n', i) + 3) }

// A plain value as Firestore's REST API gives it.
const rest = (v) => v === null || v === undefined ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'string' ? { stringValue: v }
    : Array.isArray(v) ? { arrayValue: { values: v.map(rest) } } : { mapValue: { fields: fields(v) } }
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rest(v)]))

const item = (id, o = {}) => ({ id, CHSAssetNo: 'A' + id, Model: 'M', Returned: 'Yes', OnLoanTo: '', LoanStartDate: '', LoanEndDate: '', BatchID: '', ...o })
const nelson = 'loandoc_' + encodeURIComponent('Nelson|||2026-10-25')
const state = {
  equipment: [item('1'), item('2', { Returned: 'No', OnLoanTo: 'Waikato', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-30', BatchID: 'b1' }),
    item('5', { Returned: 'No', OnLoanTo: 'Nelson', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-25' })],
  history: [{ id: 'h2', action: 'Return', chsAssetNo: 'A2' }, { id: 'h1', action: 'Loan', chsAssetNo: 'A1' }],
  loanMeta: { b1: { accountManager: 'Sam' } },
  loanDocs: { b1: { simproJobId: 209677, savedRows: [['A2', 'M', 'x']] }, [nelson]: { accountManager: 'Kiri', savedRows: [] } },
  upcoming: [{ id: 'b3', loanTo: 'Napier', startDate: '2026-11-20', endDate: '2026-12-01', items: [{ id: '1', CHSAssetNo: 'A1' }] }],
  retired: [item('r1', { RetiredReason: 'Sold' })],
  kits: { kit_1: { label: 'TEX20 kit', triggers: ['A1'] } },
  simproConfig: { createJobs: false }, demoTypes: ['Evaluation'],
}
const docs = toDocs(state, { today: '2026-10-19' })
const report = 'data:application/pdf;base64,' + 'x'.repeat(2000000)
const parts = chunksOf(report)
const audit = { e1: { id: 'e1', ts: 1, action: 'retire' } }

function backup({ cutover }) {
  const byPath = {
    'settings/equipmentCutover': cutover && { source: cutover },
    'settings/equipment': docs.settings,
    [`loans/${encodeURIComponent(nelson)}/reports/rep1`]: { filename: 'r.pdf', size: report.length, chunks: parts.length },
  }
  const collections = { equipment: docs.equipment, equipmentHistory: docs.history, retiredEquipment: docs.retired, loans: docs.loans, equipmentKits: docs.kits, equipmentAudit: new Map(Object.entries(audit)) }
  const answer = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) })
  const ctx = vm.createContext({
    serviceAccountToken_: () => 'token', scheduleProjectId_: () => 'p',
    // Plain documents, as readCollection_ gives them (fs-shape's packed ones, through JSON as REST would).
    readCollection_: (token, name) => Object.fromEntries([...(collections[name] || new Map())].map(([id, d]) => [id, JSON.parse(JSON.stringify(d))])),
    UrlFetchApp: { fetch: (url, opt = {}) => {
      const path = url.replace(/^.*\/documents\/?/, '')
      if (path === ':runQuery') return answer(200, [
        { document: { name: `projects/p/databases/(default)/documents/loans/${nelson}/reports/rep1`, fields: fields({ filename: 'r.pdf', size: report.length, chunks: parts.length }) } },
        { document: { name: 'projects/p/databases/(default)/documents/asks/a1/reports/x', fields: {} } }, { readTime: 'T' }])
      if (path.endsWith('/chunks?pageSize=20')) return answer(200, { documents: parts.map((c, i) => ({ name: url.split('?')[0].replace(/^.*documents\//, '') + '/' + i, fields: fields({ data: c }) })).reverse() })
      const d = byPath[path]
      return d ? answer(200, { fields: fields(d) }) : answer(404, {})
    } },
  })
  vm.runInContext(['let trackerOnFs_ = null;', ...['trackerOnFirestore_', 'trackerFsBase_', 'fsUnpack_', 'trackerList_', 'trackerTreeFromFirestore_', 'trackerFsReportFile_', 'fsValue_', 'fsFields_'].map(grab)].join('\n')
    + '\nconst DATASTORE_SCOPE = "s";', ctx)
  return ctx
}

test('before the cutover the backup reads the old database; after, Firestore', () => {
  assert.equal(backup({ cutover: null }).trackerOnFirestore_(), false, 'no switch yet')
  assert.equal(backup({ cutover: 'rtdb' }).trackerOnFirestore_(), false)
  assert.equal(backup({ cutover: 'firestore' }).trackerOnFirestore_(), true)
})

test('Firestore turned back into the old tree: what migrate.mjs reads, and the spreadsheet joins', () => {
  const t = JSON.parse(JSON.stringify(backup({ cutover: 'firestore' }).trackerTreeFromFirestore_()))
  assert.deepEqual(t.data.equipment, state.equipment, 'items in their order, without _pos')
  assert.deepEqual(t.data.history, state.history)
  assert.deepEqual(t.data.loanMeta, state.loanMeta)
  assert.deepEqual(t.loanDocs, state.loanDocs, 'a form\'s rows of cells come back as arrays; an old loan keeps its encoded key')
  assert.deepEqual(t.upcomingLoans, { b3: state.upcoming[0] })
  assert.deepEqual(t.retired, state.retired)
  assert.deepEqual(t.kitGroups, state.kits)
  assert.deepEqual(t.customDemoTypes, state.demoTypes)
  assert.deepEqual(t.simproConfig, state.simproConfig)
  assert.deepEqual(t.auditLog, audit)
  assert.deepEqual(t.testReports, { [nelson]: { rep1: { filename: 'r.pdf', size: report.length } } }, 'only the tracker\'s reports, without the chunk count')
})

test('a test report\'s file is put back together from its chunks', () => {
  const b = backup({ cutover: 'firestore' })
  assert.equal(b.trackerFsReportFile_(nelson, 'rep1'), report)
  assert.equal(b.trackerFsReportFile_(nelson, 'gone'), null)
})

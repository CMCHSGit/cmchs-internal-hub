// npm test -w apps/equipment — which loans have test reports (25-Nov-2026): a loan card's Test reports button is
// marked once the loan has any. On Firestore the tracker never knew, so no button was marked except right after an
// upload: store.jsx load() reads `testReports`, and db-paths.js answered only `testReports/<key>`, so the one-part
// path fell through to the state tree, which has no such branch, and gave nothing. Now it is one query over every
// loan's reports (db-firestore.js allReports, fs-shape.js reportsByLoan); model.js reportKeysOf picks the loans.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reportsByLoan } from '../src/fs-shape.js'
import { readinessKey, reportKeysOf } from '../src/model.js'

const batch = 'batch_1760000000000'
const legacy = readinessKey({ loanTo: 'Nelson Hospital', endDate: '2026-10-25' }) // loandoc_…%7C%7C%7C…, as the document id
const meta = (o = {}) => ({ filename: 'N15 electrical safety.pdf', mimeType: 'application/pdf', size: 1200, uploadedAt: '2026-11-20T10:00:00+13:00', uploadedBy: 'Sam', ...o })

test('every loan\'s reports, as the old database laid them out: by loan, then report, without the chunk count', () => {
  const got = reportsByLoan([
    { path: `loans/${batch}/reports/r1`, data: meta({ chunks: 2 }) },
    { path: `loans/${batch}/reports/r2`, data: meta({ filename: 'photo.jpg', chunks: 1 }) },
    { path: `loans/${legacy}/reports/r3`, data: meta({ chunks: 1 }) },
    { path: 'asks/a1/reports/x', data: { note: 'another tool\'s' } },
    { path: 'reports/y', data: {} },
    { path: `loans/${batch}/reports/r1/chunks/0`, data: { data: 'AAAA' } },
  ])
  assert.deepEqual(Object.keys(got).sort(), [batch, legacy].sort(), 'only the tracker\'s loans')
  assert.deepEqual(Object.keys(got[batch]).sort(), ['r1', 'r2'])
  assert.deepEqual(got[batch].r1, meta(), 'the details, without chunks')
  assert.ok(got[legacy].r3, 'a loan from before BatchIDs, by its readiness key as stored')
  assert.deepEqual(reportsByLoan([]), {})
})

test('the loans with reports: one with none left is not marked (Firestore gives {} for it, the old database nothing)', () => {
  assert.deepEqual(reportKeysOf({ [batch]: { r1: meta() }, [legacy]: {}, gone: null }), [batch])
  assert.deepEqual(reportKeysOf(null), [])
  assert.deepEqual(reportKeysOf(undefined), [])
  // store.jsx deleteReport: after the last one goes, the loan's own list comes back {} on Firestore.
  assert.equal(reportKeysOf({ [batch]: {} }).length, 0)
  assert.equal(reportKeysOf({ [batch]: null }).length, 0)
  assert.equal(reportKeysOf({ [batch]: { r2: meta() } }).length, 1)
})

// db-paths.js as the tracker runs it on Firestore, with db-firestore.js's calls stood in for.
async function dbPaths(fs) {
  const src = readFileSync(new URL('../src/db-paths.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const stubbed = src.replace(/^import \{([^}]*)\} from '\.\/db-firestore\.js'$/m, 'const {$1} = globalThis.__equipmentFs')
  assert.notEqual(stubbed, src, 'db-paths.js imports db-firestore.js as expected')
  globalThis.__equipmentFs = fs
  return import('data:text/javascript,' + encodeURIComponent(stubbed) + '%0A//' + Math.random())
}

test('db-paths.js answers testReports (every loan) from the one query, and testReports/<key> (one loan) as before', async () => {
  const tree = reportsByLoan([
    { path: `loans/${batch}/reports/r1`, data: meta({ chunks: 1 }) },
    { path: `loans/${legacy}/reports/r3`, data: meta({ chunks: 1 }) },
  ])
  const state = { equipment: [], history: [], loanMeta: {}, loanDocs: {}, upcoming: [], retired: [], kits: {}, demoTypes: [], simproConfig: {} }
  let queries = 0
  const paths = await dbPaths({
    allReports: async () => { queries++; return tree },
    listReports: async (key) => Object.entries(tree[key] || {}).map(([id, m]) => ({ id, ...m })),
    current: async () => state,
    addAudit: async () => {}, commit: async () => {}, deleteReport: async () => {}, loadAudit: async () => [], reportFile: async () => '', uploadReport: async () => {},
  })
  const all = await paths.read('testReports')
  assert.deepEqual(all.data, tree, 'not null, as it was')
  assert.equal(queries, 1, 'one query')
  // store.jsx load(): the buttons marked are these loans', by readinessKey(g) as LoanActions.jsx looks them up.
  const keys = reportKeysOf(all.data)
  assert.ok(keys.includes(readinessKey({ batchId: batch })))
  assert.ok(keys.includes(readinessKey({ loanTo: 'Nelson Hospital', endDate: '2026-10-25' })))
  assert.ok(!keys.includes('batch_2'))
  // One loan's list (the Test reports window), the path encoded as store.jsx sends it.
  assert.deepEqual(Object.keys((await paths.read('testReports/' + encodeURIComponent(legacy))).data), ['r3'])
  assert.deepEqual((await paths.read('testReports/batch_2')).data, {})
})

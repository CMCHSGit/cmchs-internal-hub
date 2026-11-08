// Parts and repair-history exports, and words that mean the same. Run: node --test apps/knowledge/tests/csv-import.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { alsoMatching, buildRecord, mentioning, parseCsv, partInfo, queryTerms, recordId, rowsToRecords, searchRecords } from '../src/model.js'

const part = (o) => buildRecord('part', o)
const PARTS = [
  part({ partNo: 'P-1', name: 'Main screen', fits: 'A9' }),
  part({ partNo: 'P-2', name: 'Primary display', fits: 'A9' }),
  part({ partNo: 'P-3', name: 'LCD panel', fits: 'N1' }),
  part({ partNo: 'P-4', name: 'Sevoflurane vaporiser base', fits: 'A9' }),
  part({ partNo: 'P-5', name: 'Mainboard', fits: 'N1' }),
  part({ partNo: 'P-6', name: 'Masimo SpO2 board' }),
  part({ partNo: 'P-7', name: 'Nellcor SpO2 board' }),
  part({ partNo: 'P-8', name: 'Battery for ePM 12', fits: 'ePM 12' }),
  part({ partNo: 'P-9', name: 'Battery for ePM 15', fits: 'ePM 15' }),
  part({ partNo: 'P-10', name: 'Battery D60', fits: 'D60' }),
  part({ partNo: 'P-11', name: 'Battery D30', fits: 'D30' }),
]
const find = (q, list = PARTS) => searchRecords('part', list, q).map((r) => r.partNo).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

test('words that mean the same find each other: screen, display, lcd; vaporizer and vaporiser', () => {
  assert.deepEqual(find('screen'), ['P-1', 'P-2', 'P-3'])
  assert.deepEqual(find('lcd'), ['P-1', 'P-2', 'P-3'])
  assert.deepEqual(find('a9 display'), ['P-1', 'P-2'])
  assert.deepEqual(find('vaporizer'), ['P-4'])
  assert.deepEqual(find('main board'), ['P-5']) // a phrase, found as "mainboard"
})

test('a kind of a thing is found by the general word, not the other way round', () => {
  assert.deepEqual(find('masimo'), ['P-6'])
  assert.deepEqual(find('spo2'), ['P-6', 'P-7']) // both are SpO2 boards
  assert.deepEqual(find('epm 12'), ['P-8'])
  assert.deepEqual(find('epm'), ['P-8', 'P-9'])
  assert.deepEqual(find('d60 battery'), ['P-10'])
  assert.deepEqual(find('defib battery').length, 2) // "defib" is the general word for both
})

test('a word that is itself in the record ranks above one found only by its synonym', () => {
  assert.equal(searchRecords('part', PARTS, 'display')[0].partNo, 'P-2')
  assert.equal(searchRecords('part', PARTS, 'screen')[0].partNo, 'P-1')
})

test('what a question is also matched with is listed, and unknown words are left alone', () => {
  assert.ok(alsoMatching('a9 screen').includes('display'))
  assert.deepEqual(alsoMatching('zebrafish gasket'), [])
  assert.deepEqual(queryTerms('zebrafish').map((t) => t.alts), [['zebrafish']])
  // own groups can be given, which is how a list is tested without the team's
  assert.deepEqual(find('gizmo', [part({ partNo: 'G', name: 'Widget' })]), [])
  assert.deepEqual(searchRecords('part', [part({ partNo: 'G', name: 'Widget' })], 'gizmo', [['x', 'part term', ['gizmo', 'widget'], []]]).map((r) => r.partNo), ['G'])
})

const PARTS_CSV = [
  'pn,part_name,category,equipment,keywords,status,superseded_by,supersedes,conflict_confidence,conflict_ids,conflict_note,name_confidence,first_seen,last_seen,date_basis,jobs_count,job_refs,pn_variants_seen,typical_faults,search_text',
  '115-027548-00,N1 CO2 Module,CO2 module,N1,co2; battery; pm kit,Active,,115-048090-00,Confirmed,C01,C01 (Confirmed): 115-048090-00 = Superseded.,High,2021-09-20,2025-05-01,explicit,4,206710; 201287,115-0275480-00 (x2) | 115027548-00 (x1),CO2 module error | CO2 not working,zzsearchtext',
  '115-048090-00,Old CO2 Module,CO2 module,N1,,Superseded,115-027548-00,,Confirmed,C01,,Low,2020-10-01,2020-10-01,estimated,1,201288,,,',
].join('\n')

test('a parts list keeps its status, replacement, warning, faults and jobs as notes, and typo spellings as other names', () => {
  const { records, skipped } = rowsToRecords('part', parseCsv(PARTS_CSV))
  assert.equal(records.length, 2)
  assert.equal(skipped, 0)
  const [a, b] = records
  assert.equal(a.name, 'N1 CO2 Module')
  assert.deepEqual(a.fits, ['N1'])
  assert.deepEqual(a.aliases, ['115-0275480-00', '115027548-00']) // the (x2) counts are gone
  assert.equal(a.notes, [
    'Status: Active', 'Replaces: 115-048090-00', 'Note: C01 (Confirmed): 115-048090-00 = Superseded.', 'Category: CO2 module',
    'Typical faults: CO2 module error; CO2 not working', 'Seen: 2021-09-20 to 2025-05-01, 4 jobs', 'Used on jobs: 206710; 201287',
  ].join('\n'))
  const info = partInfo(a.notes)
  assert.deepEqual([info.status, info.replaces, info.jobs], ['Active', ['115-048090-00'], ['206710', '201287']])
  assert.match(info.rest, /^Category: CO2 module\nTypical faults/)
  assert.deepEqual(partInfo(b.notes).replacedBy, ['115-027548-00'])
  assert.match(b.notes, /Name confidence: Low/)
  // the generated keywords and search text are not copied (the synonym list does that job), so a part is not found by words it never had
  assert.ok(!a.search.includes('zzsearchtext'))
  assert.deepEqual(find('pm kit', records), [])
  assert.deepEqual(find('superseded', records).length, 2) // in one's status and in the other's note
  assert.deepEqual(find('1150275480', records), ['115-027548-00']) // a typed-wrong number still finds it
  assert.equal(recordId('part', a), recordId('part', { ...a, name: 'Renamed' }))
})

const JOBS_CSV = [
  'job_no,date,date_basis,equipment,job_type,stage_status,fault_summary,description,work_done,notes,parts_pns,parts_named,serials',
  '209948,2026-11-02,estimated,A9,Repair / fault,Progress / Job : In Progress,A9 FiCO2 not reading 0,"FiCO2 not reading 0, meaning CO2 is recirculating.",Likely caused by improper re-assembly.,Likely caused by improper re-assembly. / Sending a CO2 bypass. / PN: 115-108618-00,115-108618-00; 115-000001-00,A9 Part Sent (name not recorded),SN123',
  '209949,2026-11-02,estimated,,Repair / fault,Pending / Job : New,Please test docking station,Please test docking station,,,,,',
  '209950,2026-11-03,estimated,VS9,Repair / fault,Done,Exergen fault,Exergen with exposed wires,warranty is five years,,,,',
].join('\n')

test('a repair history: the short fault is the title, the rest is notes without repeating itself, parts are linked', () => {
  const { records } = rowsToRecords('job', parseCsv(JOBS_CSV))
  assert.equal(records.length, 3)
  const [a, b, c] = records
  assert.equal(a.jobNo, '209948')
  assert.equal(a.title, 'A9 FiCO2 not reading 0')
  assert.deepEqual(a.model, ['A9'])
  assert.deepEqual(a.parts, ['115-108618-00', '115-000001-00'])
  assert.equal(a.date, '2026-11-02')
  // description first (it says more than the title), work done is already inside the notes so not said twice, then type, stage, parts named and serials
  assert.equal(a.notes, [
    'FiCO2 not reading 0, meaning CO2 is recirculating.', 'Likely caused by improper re-assembly. / Sending a CO2 bypass. / PN: 115-108618-00', '',
    'Type: Repair / fault', 'Stage: Progress / Job : In Progress', 'Parts named: A9 Part Sent (name not recorded)', 'Serials: SN123',
  ].join('\n'))
  assert.equal(b.notes, 'Type: Repair / fault\nStage: Pending / Job : New') // a description that only repeats the title adds nothing
  assert.match(c.notes, /^Exergen with exposed wires\nWork done: warranty is five years/)
  assert.equal(recordId('job', a), 'j-209948')
  // jobs and the parts they used find each other
  const catalogue = [buildRecord('part', { partNo: '115-108618-00', name: 'CO2 bypass' })]
  assert.equal(mentioning(catalogue[0], records).length, 1)
  assert.deepEqual(find('serial sn123', []).length, 0)
  assert.equal(searchRecords('job', records, 'sn123').length, 1)
  assert.equal(searchRecords('job', records, 'thermometer').length, 1) // "Exergen" is a kind of thermometer
})

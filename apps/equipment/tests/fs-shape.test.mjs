// npm test -w apps/equipment — the tracker's data as Firestore documents and back (fs-shape.js, step 5B).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { chunksOf, CHUNK, diffDocs, fromDocs, pack, positions, toDocs, unpack, writesProblem } from '../src/fs-shape.js'
import { planNewLoan, returnEquipment, retireEquipment } from '../src/model.js'

const today = '2026-10-19'
const item = (id, o = {}) => ({ id, CHSAssetNo: 'A' + id, Model: 'M', Returned: 'Yes', OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', BatchID: '', ...o })
const out = (id, batch, o = {}) => item(id, { Returned: 'No', OnLoanTo: 'Waikato', Location: 'ICU', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-30', BatchID: batch, ...o })

// The shapes the Realtime Database holds today (as db-local.js's sample has them).
function state() {
  return {
    equipment: [item('1'), out('2', 'b1'), out('3', 'b1'), out('4', 'b2', { LoanStartDate: '2026-11-01', LoanEndDate: '2026-11-10', OnLoanTo: 'Hutt' }),
      out('5', '', { OnLoanTo: 'Nelson', LoanEndDate: '2026-10-25' }), item('6', { _transferNote: null, Counted: 'Counted 01/10/2026' })],
    history: [{ id: 'h3', ts: '2026-10-03T09:00:00+12:00', action: 'Loan', chsAssetNo: 'A3', operator: 'Sam' },
      { id: 'h2', ts: '2026-10-02T09:00:00+12:00', action: 'Return', chsAssetNo: 'A2', operator: null },
      { id: 'h1', ts: '2026-10-01T09:00:00+12:00', action: 'Loan', chsAssetNo: 'A1', operator: 'Sam' }],
    loanMeta: { b1: { accountManager: 'Sam', tested: true, testedAt: 'T' }, b3: { accountManager: 'Tama', longTerm: true } },
    loanDocs: {
      b1: { simproJobId: 209677, demoType: 'Clinical Trial', savedRows: [['A2', 'M', 'x'], ['A3', 'M', '']], notesCell: 'Ship it', longTerm: false },
      [('loandoc_' + encodeURIComponent('Nelson|||2026-10-25'))]: { accountManager: 'Kiri', savedRows: [] },
    },
    upcoming: [
      { id: 'b1', loanTo: 'Waikato', location: 'ICU', startDate: '2026-10-01', endDate: '2026-10-30', items: [{ id: '9', CHSAssetNo: 'A9', Model: 'M', SerialNo: 'S9' }] },
      { id: 'b3', loanTo: 'Napier', location: 'CCU', startDate: '2026-11-20', endDate: '2026-12-01', accountManager: 'Tama', items: [{ id: '4', CHSAssetNo: 'A4', Model: 'M', SerialNo: '' }] },
    ],
    retired: [item('r1', { RetiredDate: '2026-09-01', RetiredReason: 'Sold', RetiredNotes: '' })],
    kits: { kit_1: { label: 'TEX20 kit', triggers: ['A1'], accessories: [{ assetNo: 'A6', model: 'Probe' }] } },
    simproConfig: { createJobs: false, windDownFrom: '2026-10-01' },
    demoTypes: ['Evaluation'],
  }
}

test('arrays in arrays are kept in a form Firestore takes, and come back the same', () => {
  const v = { rows: [['a', 'b'], ['c']], plain: [1, 2], deep: [{ x: [[1]] }], gone: undefined }
  const p = pack(v)
  assert.deepEqual(p.rows, [{ _a: ['a', 'b'] }, { _a: ['c'] }])
  assert.equal('gone' in p, false)
  assert.ok(!JSON.stringify(p).includes('[['), 'no array directly in an array')
  const { gone, ...rest } = v
  assert.deepEqual(unpack(p), rest)
})

test('the whole tracker comes back from its documents exactly as it was', () => {
  const s = state()
  const back = fromDocs(toDocs(s, { today }))
  assert.deepEqual(back.equipment, s.equipment)
  assert.deepEqual(back.history, s.history)
  assert.deepEqual(back.retired, s.retired)
  assert.deepEqual(back.loanMeta, s.loanMeta)
  assert.deepEqual(back.loanDocs, s.loanDocs)
  assert.deepEqual(back.upcoming, [...s.upcoming].sort((a, b) => (a.id < b.id ? -1 : 1)))
  assert.deepEqual(back.kits, s.kits)
  assert.deepEqual(back.simproConfig, s.simproConfig)
  assert.deepEqual(back.demoTypes, s.demoTypes)
})

test('each loan says what it is: active, scheduled, booked, and an old one without a BatchID', () => {
  const { loans } = toDocs(state(), { today })
  const b1 = loans.get('b1')
  assert.equal(b1.status, 'active')
  assert.deepEqual(b1.assetNos, ['A2', 'A3'])
  assert.deepEqual(b1.waitingFor.map((i) => i.CHSAssetNo), ['A9'], 'partly out, partly waiting')
  assert.equal(b1.accountManager, 'Sam')
  assert.equal(b1.simproJobId, 209677)
  assert.equal(b1.longTerm, false)
  const b3 = loans.get('b3')
  assert.equal(b3.status, 'booked')
  assert.equal(b3.longTerm, true, 'loanMeta’s long term')
  assert.equal(b3.loanTo, 'Napier')
  const legacy = loans.get('loandoc_' + encodeURIComponent('Nelson|||2026-10-25'))
  assert.equal(legacy.status, 'active')
  assert.deepEqual(legacy.assetNos, ['A5'])
  assert.equal(legacy.accountManager, 'Kiri')
  // b2 has nothing stored, only its item out (starting later): it still has a document.
  assert.equal(loans.get('b2').status, 'scheduled')
  assert.equal(loans.get('b2').loanTo, 'Hutt')
})

test('a new loan writes its items, its loan and its history entries, nothing else', () => {
  const s = state()
  const before = toDocs(s, { today })
  const p = planNewLoan({ equipment: s.equipment, history: s.history, upcoming: s.upcoming, loanMeta: s.loanMeta },
    { loanTo: 'Nelson', location: 'ED', startDate: today, endDate: '2026-10-30', am: 'Sam', email: '' }, ['A1', 'A6'], { batchId: 'b9', today, ts: 'T', operator: 'Sam' })
  const after = toDocs({ ...s, equipment: p.equipment, history: p.history, loanMeta: { ...s.loanMeta, b9: { accountManager: 'Sam' } } }, { prev: before, today })
  const writes = diffDocs(before, after)
  assert.deepEqual(writes.map((w) => `${w.col}/${w.id}`).sort(),
    ['equipment/1', 'equipment/6', 'equipmentHistory/' + p.history[0].id, 'equipmentHistory/' + p.history[1].id, 'loans/b9'].sort())
  assert.equal(after.loans.get('b9').status, 'active')
  assert.equal(writesProblem(writes, before), '')
  // New history goes before the old, and stays there.
  const back = fromDocs(after)
  assert.deepEqual(back.history.map((h) => h.id), p.history.map((h) => h.id))
})

test('a return that empties a loan closes it, keeping what it had; nothing is deleted', () => {
  const s = state()
  const before = toDocs(s, { today })
  const r = returnEquipment(s.equipment, s.history, ['2', '3'], { today, ts: 'T', operator: 'Kiri' })
  const docs = { ...s.loanDocs }; delete docs.b1
  const meta = { ...s.loanMeta }; delete meta.b1
  const ups = s.upcoming.filter((u) => u.id !== 'b1')
  const after = toDocs({ ...s, equipment: r.equipment, history: r.history, loanDocs: docs, loanMeta: meta, upcoming: ups }, { prev: before, today })
  const b1 = after.loans.get('b1')
  assert.equal(b1.status, 'closed')
  assert.equal(b1.meta, undefined)
  assert.equal(unpack(b1.last.form).simproJobId, 209677)
  assert.ok(!diffDocs(before, after).some((w) => w.data === null), 'no deletes')
  assert.equal(fromDocs(after).loanDocs.b1, undefined, 'the tracker sees it gone, as now')
  // Saved again: nothing changes.
  assert.deepEqual(diffDocs(after, toDocs(fromDocs(after), { prev: after, today })), [])
})

test('retiring moves the item between the lists in one set of writes', () => {
  const s = state()
  const before = toDocs(s, { today })
  const r = retireEquipment(s.equipment, '1', { reason: 'Sold', today })
  const after = toDocs({ ...s, equipment: r.equipment, retired: [r.retired, ...s.retired] }, { prev: before, today })
  const w = diffDocs(before, after).map((x) => `${x.col}/${x.id}:${x.data ? 'set' : 'delete'}`)
  assert.deepEqual(w.sort(), ['equipment/1:delete', 'retiredEquipment/1:set'])
  assert.deepEqual(fromDocs(after).retired.map((x) => x.id), ['1', 'r1'], 'newest first')
})

test('changing a history entry is refused before it is sent', () => {
  const s = state()
  const before = toDocs(s, { today })
  const after = toDocs({ ...s, history: [{ ...s.history[0], notes: 'changed' }, ...s.history.slice(1)] }, { prev: before, today })
  assert.match(writesProblem(diffDocs(before, after), before), /can’t be changed/)
})

test('positions: new ones go where they are in the list, old ones stay put', () => {
  const prev = new Map([['a', 0], ['b', 1], ['c', 2]])
  const p = positions([{ id: 'n1' }, { id: 'n2' }, { id: 'a' }, { id: 'x' }, { id: 'b' }, { id: 'c' }, { id: 'z' }], prev)
  const order = [...p.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id)
  assert.deepEqual(order, ['n1', 'n2', 'a', 'x', 'b', 'c', 'z'])
  assert.equal(p.get('a'), 0); assert.equal(p.get('c'), 2)
})

test('a report is cut into chunks a document can hold, and joins back', () => {
  const data = 'data:application/pdf;base64,' + 'Q'.repeat(CHUNK * 2 + 10)
  const parts = chunksOf(data)
  assert.equal(parts.length, 3)
  assert.ok(parts.every((c) => c.length <= CHUNK))
  assert.equal(parts.join(''), data)
})

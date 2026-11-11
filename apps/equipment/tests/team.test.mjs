// npm test -w apps/equipment — the tracker's team from hub records (model.js teamFrom, step 5A).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { teamFrom } from '../src/model.js'

test('the team is the hub people with a tracker role: signed in only, by display name, sorted', () => {
  const users = [
    { uid: 'a', displayName: 'Tama Brown', email: 'tama@x.nz', trackerRole: 'am' },
    { uid: 'b', displayName: 'Kiri Moana', email: 'kiri@x.nz', trackerRole: 'service' },
    { uid: 'c', displayName: 'New Person', email: 'new@x.nz', trackerRole: 'am', pending: true },
    { uid: 'd', displayName: 'No Role', email: 'n@x.nz' },
    { uid: 'e', displayName: 'Odd Role', email: 'o@x.nz', trackerRole: 'boss' },
    { uid: 'f', email: 'nameless@x.nz', trackerRole: 'am' },
  ]
  assert.deepEqual(teamFrom(users).map((m) => [m.uid, m.name, m.role, m.email]),
    [['b', 'Kiri Moana', 'service', 'kiri@x.nz'], ['f', 'nameless@x.nz', 'am', 'nameless@x.nz'], ['a', 'Tama Brown', 'am', 'tama@x.nz']])
  assert.deepEqual(teamFrom(), [])
})

test('someone who switched demo reminders off is marked notify: false; missing means on', () => {
  const t = teamFrom([
    { uid: 'a', displayName: 'Off', trackerRole: 'am', notifications: { demoReminders: false } },
    { uid: 'b', displayName: 'On', trackerRole: 'am', notifications: { scheduleReminder: false } },
  ])
  assert.equal(t.find((m) => m.name === 'Off').notify, false)
  assert.equal('notify' in t.find((m) => m.name === 'On'), false)
})

// Loans keep the name they were made with; the team has hub names (Settings). Matched by name, else the loan's email.
test('a loan finds its account manager by name, else by the email it was made with', async () => {
  const { teamMemberFor, amName, loanSections, overviewOf, yoursOf } = await import('../src/model.js')
  const team = [{ name: 'Jess Broughan', email: 'jessica.broughan@x.nz', role: 'am' }, { name: 'Adam', email: 'adam.k@x.nz', role: 'am' }]
  assert.equal(teamMemberFor('jess broughan ', '', team)?.name, 'Jess Broughan')
  assert.equal(teamMemberFor('Jessica Broughan', 'Jessica.Broughan@x.nz', team)?.name, 'Jess Broughan')
  assert.equal(teamMemberFor('Jessica Broughan', '', team), null)
  assert.equal(amName('Someone Gone', 'gone@x.nz', team), 'Someone Gone') // not on the team: kept as stored
  assert.equal(amName('', '', team), '')

  const today = '2026-11-11'
  const equipment = [{ id: 'e1', CHSAssetNo: '1', OnLoanTo: 'Hosp', Returned: 'No', LoanStartDate: '2026-11-01', LoanEndDate: '2026-11-09', BatchID: 'batch_1', BorrowerEmail: 'jessica.broughan@x.nz' }]
  const upcoming = [{ id: 'batch_2', loanTo: 'Other', startDate: '2026-11-05', endDate: '2026-11-20', accountManager: 'Adam Kingsford', borrowerEmail: 'adam.k@x.nz', items: [{ id: 'e1', CHSAssetNo: '1' }] }]
  const loanMeta = { batch_1: { accountManager: 'Jessica Broughan' } }
  const sections = loanSections({ equipment, upcoming, loanMeta, today, team })
  assert.equal(sections.current[0].am, 'Jess Broughan')
  assert.equal(sections.upcoming[0].am, 'Adam')
  const ov = overviewOf(sections, { equipment, upcoming, loanMeta, today, team })
  assert.equal(yoursOf(ov, 'Jess Broughan').overdue.length, 1)
  assert.equal(yoursOf(ov, 'Adam').stuck.length, 1)
  // Without a team (as before), the stored name stands.
  assert.equal(loanSections({ equipment, upcoming, loanMeta, today }).current[0].am, 'Jessica Broughan')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confOf, inMainViews, isConferenceCategory, withDefaults } from '../src/model.js'

const catById = new Map(withDefaults({}).categories.map((c) => [c.id, c]))

// As the sheet import wrote them (chs-equipment/project-tracker-import.json)
const imported = {
  id: 'conf-09', category: 'events', name: 'NZVA (Vets)', apps: [], eng: [],
  notes: [{ at: '2026-10-15', by: 'Project sheets', text: [
    'Status on the sheet: Confirmed',
    'Type: Conference, Vet',
    'Reps: Jess C; John/Steve/Preston/Jason from Mindray (in the stand column)',
    'Booth: Double',
    'Delivery: Jess to drive equipment down in a truck',
    'Website: https://www.nzvaevents.org.nz/25conf/',
    'Sponsorship: 15000',
  ].join('\n') }],
}

test('the conferences category is found by id or by name', () => {
  assert.ok(isConferenceCategory(catById.get('events')))
  assert.ok(isConferenceCategory({ id: 'x1', name: 'Conferences 2027' }))
  assert.ok(!isConferenceCategory(catById.get('installs')))
  assert.ok(!isConferenceCategory(undefined))
})

test('an imported conference reads its sheet columns from its note', () => {
  const c = confOf(imported)
  assert.equal(c.type, 'Conference')
  assert.equal(c.modality, 'Vet')
  assert.equal(c.booth, 'Double')
  assert.equal(c.website, 'https://www.nzvaevents.org.nz/25conf/')
  assert.equal(c.sponsorship, '15000')
  assert.equal(c.reps, 'Jess C; John/Steve/Preston/Jason from Mindray (in the stand column)')
  assert.equal(c.sheetStatus, 'Confirmed')
})

test('saved values win over the note, and a two-part type keeps its comma', () => {
  const c = confOf({ ...imported, conf: { booth: 'B12', sponsorship: '' } })
  assert.equal(c.booth, 'B12')
  assert.equal(c.sponsorship, '')
  assert.equal(c.type, 'Conference')
  const ws = confOf({ notes: [{ text: 'Status on the sheet: Tentative\nType: Workshop / conference, Ultrasound' }] })
  assert.equal(ws.type, 'Workshop / conference')
  assert.equal(ws.modality, 'Ultrasound')
  assert.deepEqual(confOf({ name: 'Plain job', notes: [{ text: 'Booth: nothing to do with conferences' }] }), {})
})

test('main Table and Timeline: other jobs always, conferences when ticked or, until chosen, when someone is on them', () => {
  assert.ok(inMainViews({ id: 'a', category: 'installs' }, catById, []))
  assert.ok(!inMainViews(imported, catById, []))
  assert.ok(inMainViews({ ...imported, apps: ['s1'] }, catById, []))
  assert.ok(inMainViews(imported, catById, [{ jobId: 'conf-09', staffId: 's1', week: '2026-10-12' }]))
  assert.ok(inMainViews({ ...imported, showInMain: true }, catById, []))
  assert.ok(!inMainViews({ ...imported, apps: ['s1'], showInMain: false }, catById, []))
})

// Sample schedule data for `npm run dev` without a .env (the pretend "Dev
// User"), so the home page's schedule blocks can be worked on. Same shape as
// the Firestore documents. Names and places are the design's placeholders.
// Only ever loaded from a DEV-only branch in today.js; real builds drop it.
const SAMPLE = [
  ['Karen', 'Admin', 'Cass Office'], ['Jan', 'Admin', 'Annual Leave'], ['Fiona', 'Admin', 'Non-Working Day'],
  ['Mark', 'Management', 'Manukau'], ['Preston', 'Management', 'Tauranga'], ['James', 'Management', 'Cass Office'],
  ['Richard', 'Engineers', 'Cass Office', true], ['Mike', 'Engineers', 'Annual Leave'], ['Jonathan', 'Engineers', 'Cass Office'],
  ['Peter', 'Engineers', 'Cass Office'], ['Adam', 'Engineers', 'Palmerston North'], ['Bryan', 'Engineers', 'Remote Support'],
  ['Kenneth', 'Sales', 'Dunedin'], ['Theresa', 'Sales', 'North Shore Hospital'], ['Ciaran', 'Sales', 'Invercargill'],
  ['Paul', 'Application', 'Work from Home'], ['John', 'Application', 'Remote Support'], ['Grant', 'Application', 'Hutt Hospital'],
]

export default function devFixture() {
  const users = SAMPLE.map(([name, team], i) => ({ uid: 'u' + i, displayName: name, team }))
  const schedules = {}
  SAMPLE.forEach(([, , where, calls], i) => {
    schedules['u' + i] = { uid: 'u' + i, days: [0, 1, 2, 3, 4].map(() => ({ location: where, onCall: !!calls })) }
  })
  const later = [8, 9, 10, 6].map((n, i) => ({ weekStart: new Date(Date.now() + (i + 1) * 6048e5).toISOString().slice(0, 10), doc: { uid: 'u' + n, displayName: SAMPLE[n][0] } }))
  return { users, schedules, oncall: { uid: 'u11', displayName: 'Bryan' }, later }
}

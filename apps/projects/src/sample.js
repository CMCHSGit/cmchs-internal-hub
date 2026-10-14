/* Sample jobs for trying the tracker out, from the project team's own sheets.
   Loaded from Settings (or automatically in `npm run dev`), and every record
   carries `sample: true` so "Remove sample data" takes exactly these away.
   The staff names are placeholders: swap in the real team in Settings. */

export const SAMPLE_STAFF = [
  { id: 's-sl', name: 'Sam Lee', initials: 'SL', role: 'Engineering', leave: [{ from: '2026-12-07', to: '2026-12-18' }], sample: true },
  { id: 's-tb', name: 'Tama Brown', initials: 'TB', role: 'Engineering', leave: [], sample: true },
  { id: 's-dw', name: 'Dan Whitfield', initials: 'DW', role: 'Engineering', leave: [{ from: '2026-11-30', to: '2026-12-04' }], sample: true },
  { id: 's-km', name: 'Kiri Moana', initials: 'KM', role: 'Applications', leave: [], sample: true },
  { id: 's-rp', name: 'Rachel Pike', initials: 'RP', role: 'Applications', leave: [], sample: true },
  { id: 's-gh', name: 'Grace Hill', initials: 'GH', role: 'Sales', leave: [], sample: true },
  { id: 's-lw', name: 'Liam Walsh', initials: 'LW', role: 'Sales', leave: [], sample: true },
]

export const SAMPLE_POOL = { A9: 2, A7: 2, N19: 3, ePM12: 7, V200: 2, D60: 2, D30: 3, 'D1 Pro': 2, 'Surgical bed': 2 }

const eq = (model, qty, line = 'Requested') => ({ id: `${model}-${qty}-${line}`.replace(/\s/g, ''), model, qty, line })
const note = (at, by, text) => ({ id: at + by, at, by, text })
const act = (text, owner, due, done = false) => ({ id: text.slice(0, 12).replace(/\W/g, ''), text, owner, due, done })

export const SAMPLE_JOBS = [
  {
    id: 'sample-northland', name: 'Northland telemetry expansion: scoping', category: 'discussion', customer: 'Whangārei Hospital', region: 'Northland',
    status: 'Planning', priority: 'Low', start: '', end: '', eng: [], apps: ['s-gh'], owner: 'Jess Reid',
    lead: { name: 'Clinical engineering manager', contact: '' }, freight: { tracking: '', eta: '', arrived: false },
    equipment: [], actions: [], notes: [note('2026-10-07', 'Jess Reid', 'Raise at Monday meeting: do we quote telemetry and central station together?')],
  },
  {
    id: 'sample-hinz', name: 'HINZ 2026 Auckland conference', category: 'events', customer: 'HINZ', region: 'Auckland',
    status: 'Booked', priority: 'High', start: '2026-11-18', end: '2026-11-19', eng: [], apps: ['s-km', 's-lw', 's-gh'], owner: 'Mike Tan',
    lead: { name: 'Exhibition organiser', contact: '' }, freight: { tracking: '', eta: '2026-11-17', arrived: false },
    equipment: [eq('A9', 1, 'Reserved'), eq('N19', 2, 'Reserved'), eq('ePM12', 2), eq('D60', 1, 'Reserved'), eq('V200', 1, 'Packed')],
    actions: [act('Confirm stand power and network with organiser', 'MT', '2026-10-30')],
    notes: [note('2026-10-13', 'Mike Tan', 'Bring the A9 for the anaesthesia demo. Stand number to come.')],
  },
  {
    id: 'sample-whanganui', name: 'Surgical bed trial Whanganui Hospital', category: 'trials', customer: 'Whanganui Hospital', region: 'Whanganui',
    status: 'Tentative', priority: 'Medium', start: '2026-11-16', end: '2026-12-03', eng: ['s-dw'], apps: ['s-km'], owner: 'Mike Tan',
    lead: { name: 'Theatre nurse manager', contact: '' }, freight: { tracking: '', eta: '', arrived: false },
    equipment: [eq('Surgical bed', 2)],
    actions: [act('Chase PO with Whanganui procurement', 'MT', '2026-10-13')],
    notes: [note('2026-10-13', 'Mike Tan', 'Theatre nurse manager wants to compare with the current beds. PO pending.')],
  },
  {
    id: 'sample-hutt', name: 'Hutt Hospital 6x ePM12 + 1x N19 loan', category: 'trials', customer: 'Hutt Hospital', region: 'Hutt Valley',
    status: 'Waiting', waitingOn: 'Parts', waitingSince: '2026-10-08', priority: 'Medium', start: '2026-10-26', end: '2026-11-20', eng: ['s-tb'], apps: ['s-rp'], owner: 'Jess Reid',
    lead: { name: 'ICU educator', contact: '' }, freight: { tracking: 'DHL 8810 2234 07', eta: '2026-10-30', arrived: false },
    equipment: [eq('ePM12', 6, 'Packed'), eq('N19', 1, 'Packed')],
    actions: [], notes: [note('2026-10-08', 'Jess Reid', 'N19 parts not yet dispatched from the supplier.')],
  },
  {
    id: 'sample-waikato', name: 'Waikato 13x D30 M-IoT data output + remote device mgmt', category: 'installs', customer: 'Waikato Hospital', region: 'Waikato',
    status: 'Waiting', waitingOn: 'Wi-Fi changes', waitingSince: '2026-10-02', priority: 'High', start: '2026-10-05', end: '2026-11-06', eng: ['s-sl', 's-tb'], apps: [], owner: 'Aroha Henare',
    lead: { name: 'Biomedical engineering lead', contact: '' }, freight: { tracking: '', eta: '', arrived: true },
    equipment: [eq('D30', 2, 'At site')],
    actions: [act('Confirm Wi-Fi VLAN change with Waikato IT', 'AH', '2026-10-12')],
    notes: [note('2026-10-02', 'Aroha Henare', 'Training across sites can go ahead; remote device management waits on the Wi-Fi VLAN change.')],
  },
  {
    id: 'sample-southerncross', name: 'Southern Cross North Harbour A9/A7', category: 'installs', customer: 'Southern Cross North Harbour', region: 'North Shore',
    status: 'Planning', priority: 'High', start: '2026-10-29', end: '2026-11-06', eng: ['s-dw'], apps: ['s-km'], owner: 'Jess Reid',
    lead: { name: 'Anaesthetic technician lead', contact: '' }, freight: { tracking: 'MF-208815', eta: '2026-10-20', arrived: false, state: 'Arrived in NZ' },
    equipment: [], actions: [], notes: [note('2026-10-13', 'Jess Reid', 'Theatres 3 and 4. Install before the list restarts on 06-Nov.')],
  },
  {
    id: 'sample-waitakere', name: 'Waitakere Defib x19 D1 Pro etc.', category: 'installs', customer: 'Waitakere Hospital', region: 'Auckland',
    status: 'Shipped', priority: 'High', start: '2026-11-02', end: '2026-12-18', eng: ['s-sl'], apps: ['s-rp', 's-lw'], owner: 'Aroha Henare',
    lead: { name: 'Resuscitation nurse specialist', contact: '' }, freight: { tracking: 'DHL 4471 9920 31', eta: '2026-10-23', arrived: false, state: 'In transit' },
    equipment: [],
    actions: [
      act('Confirm superuser list with resus nurse specialist', 'RP', '2026-10-20'),
      act('Book training rooms for 2 and 9 Nov', 'LW', '2026-10-22'),
      act('Asset-tag 19 units on arrival', 'SL', '2026-10-26'),
      act('Send quote acceptance to procurement', 'AH', '2026-10-02', true),
    ],
    notes: [
      note('2026-10-14', 'Aroha Henare', 'DHL confirms dispatch from Sydney. Units go to Manukau first for asset tagging and configuration.'),
      note('2026-10-09', 'Mike Tan', 'Go-live moved to week of 16-Nov to fit the ward roster. Superuser sessions stay on 2 and 9 Nov.'),
      note('2026-10-01', 'Aroha Henare', 'PO received for 19x D1 Pro and 2x D60.'),
    ],
  },
  {
    id: 'sample-vocera', name: 'Vocera New Dunedin Hospital', category: 'installs', customer: 'New Dunedin Hospital', region: 'Southern',
    status: 'Tested/ready', priority: 'High', start: '2026-10-12', end: '2026-11-20', eng: ['s-tb'], apps: ['s-km'], owner: 'Jess Reid',
    lead: { name: 'Digital health project lead', contact: '' }, freight: { tracking: '', eta: '', arrived: true },
    equipment: [], actions: [act('Book flights for Dunedin go-live', 'JR', '2026-10-14')],
    notes: [note('2026-10-12', 'Jess Reid', 'Ready for go-live. Flights still to book.')],
  },
  // Archived
  {
    id: 'sample-pn', name: 'Palmerston North Hospital 1x V600', category: 'installs', customer: 'Palmerston North Hospital', region: 'MidCentral',
    status: 'Complete', priority: 'Medium', start: '2026-09-21', end: '2026-10-02', eng: ['s-tb'], apps: ['s-km'], owner: 'Jess Reid',
    lead: { name: 'Biomedical engineering', contact: '' }, freight: { tracking: '', eta: '', arrived: true },
    equipment: [{ id: 'D60-loaner', model: 'D60', qty: 1, line: 'At site', note: 'DP-0218 loaner', due: '2026-10-09' }], actions: [],
    notes: [note('2026-10-09', 'Jess Reid', 'Signed off by biomedical engineering. Loaner D60 still on site; return booked.'), note('2026-10-02', 'Tama Brown', 'Go-live complete on the ward. No faults logged.')],
    completedAt: '2026-10-09', archived: true, archivedAt: '2026-10-09',
  },
  {
    id: 'sample-ns', name: 'North Shore ED 4x ePM12 trial', category: 'trials', customer: 'North Shore Hospital', region: 'North Shore',
    status: 'Complete', priority: 'Medium', start: '2026-07-27', end: '2026-08-14', eng: ['s-dw'], apps: ['s-rp'], owner: 'Mike Tan',
    lead: { name: 'ED charge nurse manager', contact: '' }, freight: { tracking: '', eta: '', arrived: true },
    equipment: [eq('ePM12', 3, 'Returned'), { id: 'ePM12-overdue', model: 'ePM12', qty: 1, line: 'At site', note: 'DP-0412', due: '2026-10-02' }], actions: [],
    notes: [note('2026-08-21', 'Mike Tan', 'ED will raise a business case for 12 units next financial year. 3 of 4 units back.')],
    completedAt: '2026-08-21', archived: true, archivedAt: '2026-08-21',
  },
  {
    id: 'sample-wh', name: 'Whangārei Hospital 8x N19 install', category: 'installs', customer: 'Whangārei Hospital', region: 'Northland',
    status: 'Complete', priority: 'Medium', start: '2025-06-09', end: '2025-06-27', eng: ['s-tb', 's-dw'], apps: [], owner: 'Aroha Henare',
    lead: { name: '', contact: '' }, freight: { tracking: '', eta: '', arrived: true }, equipment: [], actions: [],
    notes: [note('2025-06-30', 'Aroha Henare', 'Closed out. Telemetry expansion raised as a separate discussion item.')],
    completedAt: '2025-06-30', archived: true, archivedAt: '2025-07-14',
  },
  {
    id: 'sample-wa9', name: 'Whanganui Hospital A9 anaesthesia trial', category: 'trials', customer: 'Whanganui Hospital', region: 'Whanganui',
    status: 'Complete', priority: 'Medium', start: '2025-02-24', end: '2025-03-07', eng: ['s-sl'], apps: ['s-km'], owner: 'Mike Tan',
    lead: { name: 'Anaesthesia department', contact: '' }, freight: { tracking: '', eta: '', arrived: true },
    equipment: [eq('A9', 2, 'Returned')], actions: [],
    notes: [note('2025-03-14', 'Mike Tan', 'Anaesthetists happy with the A9. Decision expected after budget round.')],
    completedAt: '2025-03-14', archived: true, archivedAt: '2025-03-28',
  },
]

// [jobId, staffId, week (Monday), activity]
const A = [
  ['sample-waikato', 's-sl', '2026-10-12', 'Training'], ['sample-waikato', 's-tb', '2026-10-12', 'Training'],
  ['sample-waikato', 's-sl', '2026-10-19', 'Training'], ['sample-waikato', 's-tb', '2026-10-19', 'Travel'],
  ['sample-waikato', 's-sl', '2026-10-26', 'Training'], ['sample-waikato', 's-sl', '2026-11-02', 'Support'],
  ['sample-hutt', 's-tb', '2026-10-26', 'Install'],
  ['sample-southerncross', 's-km', '2026-10-26', 'Prep'], ['sample-southerncross', 's-dw', '2026-11-02', 'Install'], ['sample-southerncross', 's-km', '2026-11-02', 'Training'],
  ['sample-waitakere', 's-rp', '2026-11-02', 'Superuser training'], ['sample-waitakere', 's-rp', '2026-11-09', 'Superuser training'], ['sample-waitakere', 's-lw', '2026-11-09', 'Training'],
  ['sample-waitakere', 's-rp', '2026-11-16', 'Go-live'], ['sample-waitakere', 's-sl', '2026-11-16', 'Go-live'], ['sample-waitakere', 's-rp', '2026-11-23', 'Support'],
  ['sample-waitakere', 's-lw', '2026-11-30', 'Support'], ['sample-waitakere', 's-rp', '2026-12-07', 'Support'], ['sample-waitakere', 's-rp', '2026-12-14', 'Support'],
  ['sample-vocera', 's-km', '2026-10-12', 'Prep'], ['sample-vocera', 's-km', '2026-10-19', 'Prep'], ['sample-vocera', 's-tb', '2026-11-02', 'Prep'],
  ['sample-vocera', 's-tb', '2026-11-09', 'Go-live'], ['sample-vocera', 's-km', '2026-11-09', 'Go-live'], ['sample-vocera', 's-tb', '2026-11-16', 'Support'],
  ['sample-hinz', 's-gh', '2026-11-09', 'Prep'], ['sample-hinz', 's-gh', '2026-11-16', 'Support'], ['sample-hinz', 's-km', '2026-11-16', 'Support'], ['sample-hinz', 's-lw', '2026-11-16', 'Support'],
  ['sample-whanganui', 's-dw', '2026-11-16', 'Install'], ['sample-whanganui', 's-km', '2026-11-16', 'Training'],
  ['sample-whanganui', 's-dw', '2026-11-23', 'Trial'], ['sample-whanganui', 's-dw', '2026-11-30', 'Trial'],
  ['sample-pn', 's-tb', '2026-09-21', 'Install'], ['sample-pn', 's-tb', '2026-09-28', 'Go-live'], ['sample-pn', 's-km', '2026-09-28', 'Training'],
  ['sample-wa9', 's-sl', '2025-02-24', 'Install'], ['sample-wa9', 's-km', '2025-02-24', 'Training'], ['sample-wa9', 's-km', '2025-03-03', 'Trial'],
]
export const SAMPLE_ASSIGNMENTS = A.map(([jobId, staffId, week, activity], i) => ({ id: `sample-a${i}`, jobId, staffId, week, activity, sample: true }))

export const SAMPLE_COMMENTS = [
  { id: 'sample-c1', jobId: 'sample-waitakere', text: '@Rachel can you check whether ED wants the D60s on the same go-live day?', byName: 'Mike Tan', atMs: Date.parse('2026-10-14T10:12:00+13:00'), sample: true },
  { id: 'sample-c2', jobId: 'sample-waitakere', text: '@Mike ED would like them a week later, 23-Nov. I have added Support to the timeline.', byName: 'Rachel Pike', atMs: Date.parse('2026-10-14T11:40:00+13:00'), sample: true },
]

/* What the demo tracker feed reads in `npm run dev` (backend-local.js), in
   the tracker's own shape: model names as the asset register writes them,
   a loan out now, one overdue, one booked ahead, and probes no pool model
   claims. The asset numbers and hospitals are made up. */
const asset = (no, Model, loan = {}) => ({ id: 'a' + no, CHSAssetNo: String(no), Model, Returned: loan.OnLoanTo ? 'No' : 'Yes', ...loan })
const out = (OnLoanTo, Location, LoanStartDate, LoanEndDate, BatchID) => ({ OnLoanTo, Location, LoanStartDate, LoanEndDate, BatchID })
export const SAMPLE_FEED = {
  equipment: [
    asset(100201, 'A9'), asset(100202, 'A9'), asset(100203, 'A7'), asset(100204, 'A7'), asset(100205, 'A7'),
    asset(100211, 'BeneVision N19', out('Tauranga Hospital', 'ICU', '2026-10-05', '2026-10-30', 'demo-tga')),
    asset(100212, 'BeneVision N19'), asset(100213, 'BeneVision N19'),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => asset(100220 + n, 'ePM 12M')),
    asset(100231, 'VS-900'), asset(100232, 'V200'),
    asset(100241, 'BeneHeart D60', out('Rotorua Hospital', 'ED', '03/09/2026', '25/09/2026', 'demo-rot')),
    asset(100242, 'BeneHeart D60'),
    asset(100251, 'BeneHeart D30'), asset(100252, 'BeneHeart D30'), asset(100253, 'BeneHeart D30'),
    asset(100261, 'BeneHeart D1 Pro'), asset(100262, 'BeneHeart D1 Pro'),
    asset(100166, 'TEX20'), asset(100393, 'SC6-1s'), asset(100168, 'SP5-1s'),
  ],
  upcoming: [
    { id: 'demo-hb', loanTo: 'Hawke’s Bay Hospital', location: 'Theatre', startDate: '2026-11-09', endDate: '2026-11-20', items: [{ id: 'a100203', CHSAssetNo: '100203' }, { id: 'a100204', CHSAssetNo: '100204' }] },
  ],
}

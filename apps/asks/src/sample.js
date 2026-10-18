/* Made-up people and asks for `npm run dev` and the tests. Never in a real build. */

export const SAMPLE_USERS = [
  { uid: 'u-aroha', name: 'Aroha Henare', team: 'Management', role: 'admin', hasPush: true },
  { uid: 'u-mike', name: 'Mike Tan', team: 'Engineers', role: 'user', hasPush: true },
  { uid: 'u-sam', name: 'Sam Patel', team: 'Engineers', role: 'user', hasPush: false },
  { uid: 'u-jess', name: 'Jess Reid', team: 'Sales', role: 'user', hasPush: true },
  { uid: 'u-lee', name: 'Lee Wong', team: 'Application', role: 'user', hasPush: true },
]

const HOUR = 3600000

/** Dates relative to today, so the sample always has something overdue and something due soon. */
export function sampleAsks(now = Date.now()) {
  const day = (n) => {
    const d = new Date(now + n * 86400000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const base = (id, o) => ({
    id, details: '', assignees: [], teams: [], owner: '', ownerName: '', status: 'open', waitingOn: '', urgent: false, due: '',
    doneAtMs: 0, doneBy: '', photoCount: 0, commentCount: 0, lastCommentAtMs: 0, lastCommentBy: '', event: null, ...o,
  })
  const asks = [
    base('s1', {
      title: 'Test the new ventilation mode on the A7 at Middlemore',
      details: 'Firmware 2.4 added the new mode. Can whoever is next on site try it on the theatre 3 machine and note anything odd?',
      createdBy: 'u-lee', createdByName: 'Lee Wong', createdAtMs: now - 26 * HOUR, updatedAtMs: now - 26 * HOUR,
      teams: ['Engineers'], people: ['u-lee'], due: day(3),
      event: { id: 'e1', type: 'created', by: 'u-lee', atMs: now - 26 * HOUR, to: [], teams: [], ref: '' },
    }),
    base('s2', {
      title: 'Raise the BeneVision alarm log issue with Mindray',
      details: 'Customer says the alarm log clears after a power cycle. Ticket number from them would be great.',
      createdBy: 'u-jess', createdByName: 'Jess Reid', createdAtMs: now - 4 * 86400000, updatedAtMs: now - 2 * 86400000,
      assignees: ['u-mike', 'u-sam'], cc: ['u-lee'], people: ['u-jess', 'u-mike', 'u-sam', 'u-lee'], // Lee copied in
      owner: 'u-mike', ownerName: 'Mike Tan', status: 'waiting', waitingOn: 'Mindray', commentCount: 2, lastCommentAtMs: now - 2 * 86400000, lastCommentBy: 'Mike Tan',
      event: { id: 'e2', type: 'comment', by: 'u-mike', atMs: now - 2 * 86400000, to: ['u-jess'], teams: [], ref: 'c2' },
    }),
    base('s3', {
      title: 'Quote for two spare SpO2 cables for Waikato ICU',
      createdBy: 'u-mike', createdByName: 'Mike Tan', createdAtMs: now - 3 * 86400000, updatedAtMs: now - 3 * 86400000,
      assignees: ['u-jess'], people: ['u-mike', 'u-jess'], urgent: true, due: day(-1),
      event: { id: 'e3', type: 'created', by: 'u-mike', atMs: now - 3 * 86400000, to: [], teams: [], ref: '' },
    }),
    base('s4', {
      title: 'Bring the demo infusion pump back from Tauranga',
      createdBy: 'u-aroha', createdByName: 'Aroha Henare', createdAtMs: now - 6 * 86400000, updatedAtMs: now - 20 * HOUR,
      assignees: ['u-sam'], people: ['u-aroha', 'u-sam'], owner: 'u-sam', ownerName: 'Sam Patel', status: 'done', doneAtMs: now - 20 * HOUR, doneBy: 'Sam Patel',
    }),
    base('s5', {
      title: 'Check the loan stock list matches the shelf',
      createdBy: 'u-aroha', createdByName: 'Aroha Henare', createdAtMs: now - 5 * HOUR, updatedAtMs: now - 5 * HOUR,
      assignees: ['u-lee'], teams: ['Sales'], people: ['u-aroha', 'u-lee'], due: day(0),
    }),
  ]
  const comments = [
    { id: 'c1', askId: 's2', uid: 'u-mike', name: 'Mike Tan', text: 'Logged with Mindray support this morning.', atMs: now - 3 * 86400000, mentions: [], photoIds: [] },
    { id: 'c2', askId: 's2', uid: 'u-mike', name: 'Mike Tan', text: '@Jess Reid they want the device serial. Do you have it?', atMs: now - 2 * 86400000, mentions: ['u-jess'], photoIds: [] },
  ]
  return { asks, comments }
}

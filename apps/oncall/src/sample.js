// Made-up weeks for `npm run dev` with no database, so the page can be worked on. Not real people.
const DAY = 86400000
const names = ['Alex', 'Sam', 'Kai', 'Robin']
function year(y, first, count) {
  const weeks = []
  for (let i = 0; i < count; i++) {
    const s = Date.parse(first) + i * 7 * DAY
    const start = new Date(s).toISOString().slice(0, 10), end = new Date(s + 6 * DAY).toISOString().slice(0, 10)
    weeks.push({
      month: new Date(s + 3 * DAY).toLocaleString('en-NZ', { month: 'long', timeZone: 'UTC' }), week: String(i + 1), start, end,
      engineer: names[(i + y) % names.length], holidays: i === 0 ? '1-Jan, 2-Jan' : i === 5 ? '6-Feb' : '', school: '',
      notes: i === 2 ? 'Alex swapped with Sam (week 4)' : i % 9 === 0 ? 'Oncall Allowance Submitted' : '',
    })
  }
  return { name: String(y), year: y, weeks, extras: [] }
}
export const sampleHistory = () => ({
  sheets: [year(2026, '2025-12-29', 53), year(2025, '2024-12-30', 52), year(2024, '2024-01-01', 52)],
  engineers: names, importedAt: Date.parse('2026-10-23T09:00:00+13:00'), importedBy: 'Dev User',
})

/**
 * The app → Excel copy, as data: which cells of the company workbook to change so they say what the app says.
 * Plain functions, no Firebase and no Excel, so they are tested exhaustively; scripts/excelExportJob.mjs reads
 * the two sides and scripts/apply-excel-edits.ps1 makes the changes in Excel itself.
 *
 * The rule is the import's, the other way round (mergeText in excelPlan.js). For every day (and the week's
 * comment) the app holds one text, the Excel two cells (AM and PM). A cell is written only when
 *   - the app has something and it differs from what the Excel reads as, and
 *   - the Excel is blank there, or still says what it said when we last compared (`excelBase`), so nobody has
 *     changed it in the Excel since. If they have, it's left alone and counted: the import brings their change in.
 * Nothing is ever cleared, no person or sheet is ever added, and a day with more than two places in it can't be
 * split into AM and PM, so it's left for a person.
 */
import { squash, combineHalves } from './excelSchedule.js'
import { normalizeSchedule } from './week.js'

const same = (a, b) => squash(a).toLowerCase() === squash(b).toLowerCase()

/** "Starship / Cass Office" → ['Starship', 'Cass Office']; one place → that in both halves; blank → blanks; 3+ places → null. */
export function splitHalves(text) {
  const t = squash(text)
  if (!t) return ['', '']
  const parts = t.split('/').map(squash).filter(Boolean)
  if (parts.length === 1) return [parts[0], parts[0]]
  if (parts.length === 2) return [parts[0], parts[1]]
  return null
}

/**
 * weeks:   Map(weekStart → { sheet, layout, people }) — people from readPeople (with row, halves, commentRow)
 * mapping: Map(nameKey → { kind: 'user', uid } | { kind: 'skip' }) from buildMapping
 * existing: Map(`${weekStart}_${uid}` → the schedule in the app)
 * nameKey: the function that makes the keys (excelPlan.js)
 * → { edits, bases, stats }
 *   edits: [{ sheet, weekStart, id, row, col, before, text }]  one per cell
 *   bases: [{ id, weekStart, uid, base: { days: [5 texts], comments } }]  what the Excel will read as once the edits are in
 */
export function planExport({ weeks, mapping, existing, nameKey }) {
  const edits = [], bases = []
  const stats = { people: 0, days: 0, comments: 0, cells: 0, conflicts: 0, unsplittable: 0 }

  for (const weekStart of [...weeks.keys()].sort()) {
    const { sheet, layout, people } = weeks.get(weekStart)
    const seen = new Set()
    for (const p of people) {
      const target = mapping.get(nameKey(p.name))
      if (!target || target.kind !== 'user' || seen.has(target.uid)) continue
      seen.add(target.uid)
      const id = `${weekStart}_${target.uid}`
      const app = existing.get(id)
      if (!app) continue
      const appDays = normalizeSchedule(app.days)
      const base = app.excelBase || null
      const mine = []
      const newBaseDays = []
      let wrote = false

      for (let i = 0; i < 5; i++) {
        const excel = p.days[i]
        const want = squash(appDays?.[i]?.location)
        newBaseDays.push(squash(base?.days?.[i]) || squash(excel))
        if (!want || same(want, excel)) continue
        const b = base?.days?.[i]
        if (excel && !(b != null && same(excel, b))) { stats.conflicts++; continue } // changed in the Excel: the import's to bring in
        const halves = splitHalves(want)
        if (!halves) { stats.unsplittable++; continue }
        const col = layout.firstDayCol + i
        for (let h = 0; h < 2; h++) {
          if (!same(halves[h], p.halves[i][h])) mine.push({ sheet, weekStart, id, row: p.row + h, col, before: p.halves[i][h], text: halves[h] })
        }
        newBaseDays[i] = combineHalves(halves[0], halves[1])
        stats.days++
        wrote = true
      }

      const wantComment = squash(app.comments)
      let newComment = squash(base?.comments) || squash(p.comment)
      if (wantComment && !same(wantComment, p.comment)) {
        const b = base?.comments
        if (p.comment && !(b != null && same(p.comment, b))) stats.conflicts++
        else {
          const row = p.commentRow
          mine.push({ sheet, weekStart, id, row, col: layout.commentCol, before: p.comment, text: wantComment })
          newComment = wantComment
          stats.comments++
          wrote = true
        }
      }

      if (wrote && mine.length) {
        stats.people++
        edits.push(...mine)
        bases.push({ id, weekStart, uid: target.uid, base: { days: newBaseDays, comments: newComment } })
      }
    }
  }
  stats.cells = edits.length
  return { edits, bases, stats }
}

// The on-call history in Firestore: one document per sheet of the old workbook (oncallHistory/2025,
// oncallHistory/2023-revised ...) and one for the engineers list. Everyone signed in reads it;
// an admin imports it (rules/firestore.rules).
import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../../schedule/src/firebase'
import { sheetId } from './parse.js'
import { renameEngineer } from './roster.js'
import { sampleHistory } from './sample.js'

const COL = 'oncallHistory'

/** { sheets, engineers, importedAt, importedBy }; made-up data when there is no database (npm run dev with no .env). */
export async function loadHistory() {
  if (!db) return sampleHistory()
  const snap = await getDocs(collection(db, COL))
  const sheets = [], out = { sheets, engineers: [], importedAt: null, importedBy: '' }
  for (const d of snap.docs) {
    const x = d.data()
    if (d.id === 'engineers') out.engineers = x.names || []
    else sheets.push({ name: x.name || d.id, year: x.year, weeks: x.weeks || [], extras: x.extras || [] })
    const at = x.importedAt?.toMillis?.()
    if (at && (!out.importedAt || at > out.importedAt)) { out.importedAt = at; out.importedBy = x.importedBy || '' }
  }
  return out
}

/** Writes what parseWorkbook read: a document per sheet, replacing what was there. */
export async function saveImport({ sheets, engineers }, by) {
  if (!db) throw new Error('There is no database to save to here.')
  const batch = writeBatch(db)
  for (const s of sheets) {
    batch.set(doc(db, COL, sheetId(s.name)), { name: s.name, year: s.year, weeks: s.weeks, extras: s.extras, importedAt: serverTimestamp(), importedBy: by })
  }
  batch.set(doc(db, COL, 'engineers'), { names: engineers, importedAt: serverTimestamp(), importedBy: by })
  await batch.commit()
}

// ── Editing (admins; the same rule) ────────────────────────────────────────────────────────────

/** Replaces the week starting `start` on one sheet with `week` (or removes it when week is null). */
export async function saveWeek(sheet, start, week, by) {
  if (!db) throw new Error('There is no database to save to here.')
  const weeks = (sheet.weeks || []).filter(w => w.start !== start)
  if (week) weeks.push(week)
  weeks.sort((a, b) => (a.start < b.start ? -1 : 1))
  const batch = writeBatch(db)
  batch.update(doc(db, COL, sheetId(sheet.name)), { weeks, editedAt: serverTimestamp(), editedBy: by })
  await batch.commit()
}

/**
 * Renames a person wherever they are on call, across every sheet, and saves the engineers list.
 * `renames` is [[from, to]]; `names` the list to keep.
 */
export async function savePeople(sheets, names, renames, by) {
  if (!db) throw new Error('There is no database to save to here.')
  const batch = writeBatch(db)
  for (const s of sheets) {
    let changed = false
    const weeks = (s.weeks || []).map(w => {
      let engineer = w.engineer
      for (const [from, to] of renames) {
        const next = renameEngineer(engineer, from, to)
        if (next !== engineer) { engineer = next; changed = true }
      }
      return engineer === w.engineer ? w : { ...w, engineer }
    })
    if (changed) batch.update(doc(db, COL, sheetId(s.name)), { weeks, editedAt: serverTimestamp(), editedBy: by })
  }
  batch.set(doc(db, COL, 'engineers'), { names, importedAt: serverTimestamp(), importedBy: by })
  await batch.commit()
}

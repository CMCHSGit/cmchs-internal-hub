// The on-call history in Firestore: one document per sheet of the old workbook (oncallHistory/2025,
// oncallHistory/2023-revised ...) and one for the engineers list. Everyone signed in reads it;
// an admin imports it (rules/firestore.rules).
import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../../schedule/src/firebase'
import { sheetId } from './parse.js'
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

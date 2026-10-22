/* The on-call roster workbook (Service's "Oncall roster.xlsx") read into plain weekly records.

   One sheet per year (2017 to 2026, a "2023 Revised" beside "2023") plus a list of engineers. The
   sheets were kept by hand over the years, so the dates can't be trusted as typed:
     - 2017 to 2019 give only day numbers ("31st - 6th"); the months follow from the order.
     - 2021 to 2023 still carry the previous year's dates (their weeks start a day or two apart
       from last year's, 364 days earlier).
     - 2024 has day numbers 1, 8, 15 ... instead of dates, and 2026's first date is a year out.
   So each sheet's first week is worked out (see firstStart) and every week after it is seven days on.
   Nothing here touches the network or the page: sheets in, records out. */

const DAY = 86400000
const iso = ms => new Date(ms).toISOString().slice(0, 10)
const utc = (y, m, d) => Date.UTC(y, m, d)
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

const text = v => (v === null || v === undefined ? '' : v.date ? v.date : String(v).replace(/\s+/g, ' ').trim())

/** A cell as the parser reads it: a date as 'YYYY-MM-DD' in { date }, anything else as text or a number. */
export const dateCell = d => ({ date: d })

function headerMap(row) {
  const map = {}
  row.forEach((c, i) => {
    const h = text(c).toLowerCase()
    if (!h) return
    if (h === 'month') map.month = i
    else if (h === 'week') map.week = i
    else if (h === 'start date') map.start = i
    else if (h === 'end date') map.end = i
    else if (h === 'engineer') map.engineer = i
    else if (h.startsWith('public holidays')) map.holidays = i
    else if (h === 'school holidays') map.school = i
    else if (h === 'notes') map.notes = i
  })
  return map
}

const startsText = c => (c && c.date ? '' : text(c))
const dayNo = s => { const m = /(\d{1,2})/.exec(s); return m ? Number(m[1]) : null }

/** The Monday on or before 1 January of the year. */
function mondayOnOrBeforeNewYear(year) {
  const jan1 = utc(year, 0, 1)
  const dow = new Date(jan1).getUTCDay() // 0 Sunday
  return jan1 - ((dow + 6) % 7) * DAY
}

/** The first week's start (ms), from what the first row says, for a dated sheet. */
export function firstStart(year, firstDate) {
  const s0 = Date.parse(firstDate)
  const lo = utc(year - 1, 11, 25), hi = utc(year, 0, 7)
  const y0 = new Date(s0).getUTCFullYear()
  if (y0 === year - 1 && s0 >= lo && s0 <= hi) return s0 // typed right (2020, 2025)
  if (y0 < year && y0 >= year - 3) {
    // The previous year's sheet copied forward: the same weekday, the first such day in the new year.
    for (let n = 0; n <= 3 * 53; n++) { const c = s0 + n * 7 * DAY; if (c >= utc(year, 0, 1) && c <= hi) return c }
  }
  return mondayOnOrBeforeNewYear(year) // a number instead of a date (2024), or a year out (2026)
}

/**
 * Weeks of one sheet. `rows` is the sheet's cells (arrays, header first); `name` the tab's name.
 * Returns { name, label, year, weeks, extras } where weeks are in order and extras are any rows
 * that aren't a week (kept as text so nothing in the workbook is lost).
 */
export function parseSheet(name, rows) {
  const year = Number(/^(\d{4})/.exec(name)?.[1])
  const h = headerMap(rows[0] || [])
  const weeks = [], extras = []
  let month = '', startMs = null, prevDay = null, textMonth = null, textYear = year
  const dated = rows.slice(1).find(r => r[h.start]?.date)
  const dateFirst = dated ? firstStart(year, dated[h.start].date) : null

  for (const r of rows.slice(1)) {
    const engineer = text(r[h.engineer])
    const week = text(r[h.week])
    if (text(r[h.month])) month = text(r[h.month])
    if (!engineer && !week) {
      const any = r.map(text).filter(Boolean)
      if (any.length) extras.push(any.join(' · '))
      continue
    }
    let start, end
    if (dated) {
      startMs = startMs === null ? dateFirst : startMs + 7 * DAY
      start = iso(startMs); end = iso(startMs + 6 * DAY)
    } else {
      // "31st - 6th": day numbers only, the months run on from January (or the December before).
      const range = startsText(r[h.start]).split('-')
      const sd = dayNo(range[0] || ''), ed = dayNo(range[1] || '')
      if (sd === null) { extras.push([week, engineer].filter(Boolean).join(' · ')); continue }
      if (textMonth === null) { textMonth = sd >= 25 ? 11 : 0; if (textMonth === 11) textYear = year - 1 }
      else if (sd < prevDay) { textMonth += 1; if (textMonth > 11) { textMonth = 0; textYear += 1 } }
      prevDay = sd
      const s = utc(textYear, textMonth, sd)
      const e = ed === null ? s + 6 * DAY : (ed < sd ? utc(textYear, textMonth + 1, ed) : utc(textYear, textMonth, ed))
      start = iso(s); end = iso(e)
    }
    const holidays = text(r[h.holidays]), notes = text(r[h.notes]), school = text(r[h.school])
    const holidayDate = r[h.holidays]?.date // a bare date in this column is a public holiday that week
    weeks.push({
      month: MONTHS.includes(month.toLowerCase()) ? month : month,
      week: week.replace(/^week\s*/i, '').replace(/^0+(?=\d)/, '') || String(weeks.length + 1),
      start, end, engineer,
      holidays: holidayDate ? holidayDate : holidays,
      school, notes,
    })
  }
  const label = name
  return { name, label, year, weeks, extras }
}

/** The whole workbook: { sheets: [parseSheet...], engineers: [names] }. `workbook` is [{ name, rows }]. */
export function parseWorkbook(workbook) {
  const engineers = []
  const sheets = []
  for (const s of workbook) {
    if (/^\d{4}/.test(s.name)) sheets.push(parseSheet(s.name, s.rows))
    else if (/engin+ers/i.test(s.name)) {
      for (const r of s.rows.slice(1)) { const n = text(r[0]); if (n) engineers.push(n) }
    }
  }
  return { sheets, engineers }
}

/** A tab's name as a Firestore document id: "2023 Revised" -> "2023-revised". */
export const sheetId = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** ExcelJS rows into the shape parseWorkbook reads: dates as { date }, formulas as their result. */
export function sheetsFromExcelJS(wb) {
  return wb.worksheets.map(ws => {
    const rows = []
    ws.eachRow({ includeEmpty: false }, (row, i) => {
      const cells = []
      for (let c = 1; c <= 12; c++) {
        let v = row.getCell(c).value
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          if ('result' in v) v = v.result
          else if (v.richText) v = v.richText.map(t => t.text).join('')
          else if (v.text) v = v.text
        }
        if (v instanceof Date) v = dateCell(v.toISOString().slice(0, 10))
        cells.push(v ?? null)
      }
      rows[i - 1] = cells
    })
    return { name: ws.name, rows: Array.from(rows, r => r || []) }
  })
}

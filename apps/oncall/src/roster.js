/* The roster by year, from the imported sheets (parse.js).

   The workbook's sheets overlap: each runs a few weeks into the next year, and 2023 appears twice
   (its revised sheet replaced the first). A week belongs to the year its Thursday falls in and is
   taken from that year's own sheet (the revised one if there is one); another sheet's weeks only
   fill a year that has no sheet of its own. Anything on a sheet that isn't a week (stray labels) is kept as that year's notes. */

const DAY = 86400000

/** The year a week belongs to: where its Thursday falls (so 29 Dec to 4 Jan is the new year's week 1). */
export const yearOfWeek = start => new Date(Date.parse(start) + 3 * DAY).getUTCFullYear()

/** How much a sheet is trusted for its own year: the revised sheet first. */
const rank = sheet => (/revised/i.test(sheet.name) ? 0 : 1)

/** [{ year, weeks, extras, sources }] newest year first. */
export function byYear(sheets) {
  const ordered = [...sheets].sort((a, b) => rank(a) - rank(b))
  const own = new Map() // year -> the sheet that is that year's own (the revised one if there are two)
  for (const sheet of ordered) if (!own.has(sheet.year)) own.set(sheet.year, sheet)
  const years = new Map()
  const add = (y, w, source) => {
    if (!years.has(y)) years.set(y, { year: y, weeks: [], extras: [], sources: new Set(), seen: new Set() })
    const e = years.get(y)
    if (e.seen.has(w.start)) return
    e.seen.add(w.start); e.weeks.push({ ...w, source }); e.sources.add(source)
  }
  // A year's weeks come from its own sheet. Other sheets only fill years that have no sheet of their own.
  for (const sheet of ordered) {
    for (const w of sheet.weeks || []) {
      const y = yearOfWeek(w.start)
      if (own.get(y) === sheet || !own.has(y)) add(y, w, sheet.name)
    }
  }
  for (const sheet of sheets) {
    const e = years.get(sheet.year)
    if (e) for (const x of sheet.extras || []) if (!e.extras.includes(x)) e.extras.push(x)
  }
  return [...years.values()]
    .map(({ seen, ...e }) => ({ ...e, weeks: e.weeks.sort((a, b) => (a.start < b.start ? -1 : 1)), sources: [...e.sources] }))
    .sort((a, b) => b.year - a.year)
}

/** A name as one person: "Sam (Kai)" and " Alex" are Sam and Alex; blank is nobody. */
export const personOf = engineer => String(engineer || '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim()

/** An engineer entry with one person renamed ("Sam (Kai)" with Kai to Kit is "Sam (Kit)"); whole names only. */
export function renameEngineer(engineer, from, to) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return String(engineer).replace(new RegExp('(?<![A-Za-z0-9])' + escaped + '(?![A-Za-z0-9])', 'g'), to)
}

/** Weeks per person in a year: [{ name, weeks, holidayWeeks }], most weeks first. */
export function tally(weeks) {
  const by = new Map()
  for (const w of weeks) {
    const name = personOf(w.engineer)
    if (!name) continue
    const e = by.get(name) || { name, weeks: 0, holidayWeeks: 0 }
    e.weeks += 1
    if (w.holidays) e.holidayWeeks += 1
    by.set(name, e)
  }
  return [...by.values()].sort((a, b) => b.weeks - a.weeks || a.name.localeCompare(b.name))
}

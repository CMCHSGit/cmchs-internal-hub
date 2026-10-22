import { statusOf } from './status.js'
import { holidayOn } from './holidays.js'
import { daysWithCalls, weekDates } from './week.js'

/**
 * "Who's where this week", turned round: each place, with the people there and
 * which days. Built from what the Team week grid reads (people, their week's days
 * with the on-call roster's customer calls folded in) and the same reading of a day's
 * text as everywhere else (statusOf): a day can name several places ("Starship / Cass
 * Office"), each counted on its own. Places are matched by name, so "near" means "at
 * the same place": nothing here knows where a site is on a map.
 *
 * Without `all`, only the places someone is away at (a site or training), not the
 * office, remote support or working from home. Leave, non-working days, public holidays
 * and customer calls are never places.
 */
const AWAY = new Set(['site', 'training'])
const PLACE = new Set([...AWAY, 'office', 'remote', 'wfh'])

const key = name => name.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * @param {{ weekStart: string, users: object[], schedules: object, oncall?: object, names?: Map, all?: boolean }} week
 * @returns {{ key: string, place: string, away: boolean, people: { uid: string, name: string, team: string, days: number[] }[] }[]}
 *   biggest first (most people, then name); each person's `days` are 0 (Mon) to 4 (Fri).
 */
export function placesInWeek({ weekStart, users, schedules, oncall, names = new Map(), all = false }) {
  const holidays = weekDates(weekStart).map(holidayOn)
  const places = new Map()
  for (const u of users) {
    const days = daysWithCalls(schedules[u.uid]?.days, oncall, u.uid)
    days.forEach((day, i) => {
      const seen = new Set() // "Starship / Starship" on a day is one visit
      for (const part of String(day?.location || '').split('/').map(p => p.trim()).filter(Boolean)) {
        const status = statusOf({ location: part }, holidays[i])
        if (!PLACE.has(status) || (!all && !AWAY.has(status)) || seen.has(key(part))) continue
        seen.add(key(part))
        const p = places.get(key(part)) || { key: key(part), place: part, away: AWAY.has(status), people: new Map() }
        const who = p.people.get(u.uid) || { uid: u.uid, name: names.get(u.uid) || u.displayName || '', team: u.team || '', days: [] }
        who.days.push(i)
        p.people.set(u.uid, who)
        places.set(p.key, p)
      }
    })
  }
  return [...places.values()]
    .map(p => ({ ...p, people: [...p.people.values()].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.people.length - a.people.length || a.place.localeCompare(b.place, undefined, { sensitivity: 'base' }))
}

/** The places whose name contains the typed text (every word of it, any order), for the filter box. */
export function filterPlaces(places, query) {
  const words = key(String(query || '')).split(' ').filter(Boolean)
  return words.length ? places.filter(p => words.every(w => p.key.includes(w))) : places
}

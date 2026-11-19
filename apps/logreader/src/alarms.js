/* Alarm records. Mindray devices write one line when an alarm begins and one
   when it ends, in the device's BackendLog:

     <tab><tab>Name<tab>2026-11-13 8:49:13<tab>AlarmPriority_Prompt<tab>Technical<tab>/<tab>Alarm Begin   [AlarmInfoLogManager.cpp:1332]

   The time inside the line is when the alarm started (the same on its Begin and
   End lines), the priority is High / Medium / Low / Prompt / Exclusive and the
   type is Technical or Physiological. Everything is shown as the device logs
   it; the colour names (High = red, Medium = yellow) are the usual convention
   and are not written in the log. */

const RE = /^\s*(.+?)\t(\d{4})-(\d\d)-(\d\d) (\d{1,2}):(\d\d):(\d\d)\tAlarmPriority_(\w+)\t(\w+)\t\/\t(?:Alarm )?(Begin|End)\s*$/

/** The log that holds these lines. */
export const ALARM_FAMILY = 'BackendLog'

export const PRIORITIES = ['High', 'Medium', 'Low', 'Prompt', 'Exclusive']
export const TYPES = ['Physiological', 'Technical']
export const PRIORITY_LABEL = { High: 'High (red)', Medium: 'Medium (yellow)', Low: 'Low', Prompt: 'Prompt', Exclusive: 'Exclusive' }

/** `{ name, start, priority, type, edge }` for an alarm record line, or null. `start` is the alarm's own start time. */
export function parseAlarm(l) {
  if (!l.msg.includes('AlarmPriority_')) return null
  const m = RE.exec(l.msg)
  if (!m) return null
  return {
    name: m[1].trim(),
    start: Date.UTC(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]),
    priority: m[8], type: m[9], edge: m[10],
  }
}

/** A mark for the timeline: `{ kind: 'alarm', label }` or null. */
export function alarmMarker(l) {
  const a = parseAlarm(l)
  return a ? { kind: 'alarm', label: `${a.priority} ${a.type.toLowerCase()} alarm ${a.edge.toLowerCase()}` } : null
}

/**
 * One event per alarm: `{ name, priority, type, start, ended, secs, status, line, endLine }`, in time order.
 * `line` is the Begin line (or the End line if the Begin is in an older log that was not opened).
 * `status` is 'cleared', 'open' (no End in what was opened) or 'noBegin'.
 */
export function alarmEvents(lines) {
  const open = new Map()
  const out = []
  for (const l of lines) {
    if (l.early) continue
    const a = parseAlarm(l)
    if (!a) continue
    const key = `${a.name}|${a.start}|${a.priority}|${a.type}`
    if (a.edge === 'Begin') {
      if (open.has(key)) continue // the same Begin logged twice
      const ev = { name: a.name, priority: a.priority, type: a.type, start: a.start, ended: null, secs: null, status: 'open', line: l, endLine: null }
      open.set(key, ev); out.push(ev)
    } else {
      const ev = open.get(key)
      if (ev) {
        ev.ended = l.t; ev.secs = Math.max(0, (l.t - ev.start) / 1000); ev.status = 'cleared'; ev.endLine = l
        open.delete(key)
      } else {
        out.push({ name: a.name, priority: a.priority, type: a.type, start: a.start, ended: l.t, secs: null, status: 'noBegin', line: l, endLine: l })
      }
    }
  }
  return out.sort((x, y) => x.start - y.start)
}

/** One row per alarm name + priority + type: how often, how long at most, first and last. */
export function alarmSummary(events) {
  const by = new Map()
  for (const e of events) {
    const k = `${e.name}|${e.priority}|${e.type}`
    let s = by.get(k)
    if (!s) by.set(k, s = { name: e.name, priority: e.priority, type: e.type, count: 0, longest: null, first: e.start, last: e.start, line: e.line })
    s.count++
    if (e.secs != null && (s.longest == null || e.secs > s.longest)) s.longest = e.secs
    if (e.start < s.first) { s.first = e.start; s.line = e.line }
    if (e.start > s.last) s.last = e.start
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Events passing the filters. `priorities` / `types`: Sets (empty = any). `text`: part of the name. from/to: times (NaN = open). */
export function filterEvents(events, { priorities, types, text = '', from = NaN, to = NaN } = {}) {
  const q = text.trim().toLowerCase()
  return events.filter(e =>
    (!priorities?.size || priorities.has(e.priority)) &&
    (!types?.size || types.has(e.type)) &&
    (!q || e.name.toLowerCase().includes(q)) &&
    (!Number.isFinite(from) || e.start >= from) &&
    (!Number.isFinite(to) || e.start <= to))
}

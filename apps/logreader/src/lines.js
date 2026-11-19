/* Turns a log file's text into lines the viewer can sort, filter and search.

   The Mindray device logs look like
     MM/DD/YY HH:MM:SS [thread] LEVEL- message [Source.cpp:123]
   (the thread number is missing in some logs). A line that doesn't start with
   a date (a stack trace, a wrapped message) belongs to the line above it.

   Times are the device's own clock, kept as "UTC milliseconds" only so there
   is no time zone or daylight-saving shift: they are always shown as written.
   Until the device's clock is set it writes 01/01/70; those lines are marked
   `early` and take the time of the nearest real line in the same file so they
   stay in place when files are merged. */

const LINE = /^(\d\d)\/(\d\d)\/(\d\d) (\d\d):(\d\d):(\d\d) (?:\[?(\d+)\]? )?(INFO|ERROR|WARN|WARNING|DEBUG|FATAL|TRACE)\s*-\s?(.*)$/
/* The system log (sys.log) is plain syslog: `Oct 14 21:32:54 HOST user.debug Process: message`, with no year. */
const SYSLOG = /^([A-Z][a-z]{2})\s+(\d{1,2}) (\d\d):(\d\d):(\d\d) \S+ ([a-z]+)\.([a-z]+) (.*)$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SYS_LEVEL = { debug: 'DEBUG', info: 'INFO', notice: 'INFO', warn: 'WARN', warning: 'WARN', err: 'ERROR', error: 'ERROR', crit: 'ERROR', alert: 'ERROR', emerg: 'ERROR' }
const SRC =/^(.*?)\s*\[([A-Za-z0-9_.+-]+\.[A-Za-z]+:\d+)\]\s*$/

/** A file name without its rotation suffix: `PrintServerLog.log.2.lzo` → `PrintServerLog`. */
export function familyOf(name) {
  const base = name.split('/').pop()
  return base.replace(/\.lzo$/i, '').replace(/\.\d+$/, '').replace(/\.(log|txt)$/i, '')
}

/** Which rotation a file is: 0 for the live file, 1 for `.1`, and so on. */
export function rotationOf(name) {
  const m = /\.(\d+)(?:\.lzo)?$/i.exec(name.split('/').pop())
  return m ? Number(m[1]) : 0
}

export const LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG']
const level = (s) => s === 'WARNING' ? 'WARN' : s === 'FATAL' ? 'ERROR' : s === 'TRACE' ? 'DEBUG' : s

/** `[{ t, early, lvl, thr, msg, src, file, n }]` for one file's text. `file` is the number the caller gives it. */
export function parseLog(text, file = 0, { ref = Date.now() } = {}) {
  // A syslog line has no year: use the year of `ref` (when the file was written), or the one before for months well after it.
  const refD = new Date(ref)
  const refYear = refD.getUTCFullYear(), refMonth = refD.getUTCMonth()
  const out = []
  let cur = null, start = 0
  const len = text.length
  while (start < len) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = len
    let line = text.slice(start, end)
    if (line.endsWith('\r')) line = line.slice(0, -1)
    start = end + 1
    const m = LINE.exec(line)
    const sy = m ? null : SYSLOG.exec(line)
    if (sy && MONTHS.includes(sy[1])) {
      const mon = MONTHS.indexOf(sy[1])
      cur = {
        t: Date.UTC(mon > refMonth + 1 ? refYear - 1 : refYear, mon, +sy[2], +sy[3], +sy[4], +sy[5]),
        early: false, lvl: SYS_LEVEL[sy[7]] || 'INFO', thr: '', msg: sy[8], src: '', file, n: out.length + 1,
      }
      out.push(cur)
    } else if (m) {
      const yy = +m[3]
      const year = yy >= 70 && yy < 100 ? 1900 + yy : 2000 + yy
      const s = SRC.exec(m[9])
      cur = {
        t: Date.UTC(year, +m[1] - 1, +m[2], +m[4], +m[5], +m[6]),
        early: year < 2000,
        lvl: level(m[8]),
        thr: m[7] || '',
        msg: s ? s[1] : m[9],
        src: s ? s[2] : '',
        file,
        n: out.length + 1,
      }
      out.push(cur)
    } else if (cur) {
      if (line.trim()) cur.msg += '\n' + line
    } else if (line.trim()) {
      // text before the first dated line: keep it, dated by the first real line below
      cur = { t: NaN, early: false, lvl: 'INFO', thr: '', msg: line, src: '', file, n: out.length + 1 }
      out.push(cur)
    }
  }
  fillTimes(out)
  return out
}

/** Early (1970) and undated lines take the time of the real line before them, or after them at the top of a file. */
function fillTimes(lines) {
  let last = NaN
  for (const l of lines) {
    if (l.early || Number.isNaN(l.t)) l.t = last
    else last = l.t
  }
  let next = NaN
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (Number.isNaN(l.t)) l.t = next
    else if (!l.early) next = l.t
  }
}

/** Merge several already-parsed files into one list in time order (files keep their own order at equal times). */
export function mergeLines(lists) {
  const all = lists.flat()
  const idx = new Map(all.map((l, i) => [l, i]))
  return all.sort((a, b) => (a.t - b.t) || (a.file - b.file) || (idx.get(a) - idx.get(b)))
}

const pad = (n, w = 2) => String(n).padStart(w, '0')

/** `2026-11-12 09:22:06` for a time from parseLog. */
export function fmtTime(t) {
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** The inverse of the above for a "2026-11-12T09:22" box (or with seconds); NaN if it isn't one. */
export function parseLocalInput(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d))?$/.exec((s || '').trim())
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN
}

/** The value for a datetime-local box. */
export const toLocalInput = (t) => Number.isFinite(t) ? fmtTime(t).replace(' ', 'T') : ''

/** A CSV cell (quotes doubled; a leading = + - @ is padded so a spreadsheet doesn't run it as a formula). */
export function csvCell(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/* What the Log Reader knows about Mindray defibrillators (BeneHeart). Other
   monitors, ventilators and anaesthesia machines get their own file next to
   this one and a line in profiles.js: a profile says which log families to
   open first, which lines to mark on the timeline, and which tables to offer.

   Nothing here is a conclusion about a fault: the shock table lays the times
   side by side so a person can see for themselves. What a "power-off type"
   number means is not known, so it is shown as written. */

import { fmtTime } from './lines.js'
import { alarmMarker } from './alarms.js'

const FAMILIES = { backend: 'DefibBackendLog', print: 'PrintServerLog' }

/** Index of the first line with time >= t (lines are in time order). */
export function lowerBound(lines, t) {
  let lo = 0, hi = lines.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].t < t) lo = mid + 1; else hi = mid
  }
  return lo
}

const RE_SHOCK = /StartGuid SaveShockData/
const RE_ENERGY = /sparkEnergy:(\d+)/
const RE_BOOT = /Last power Off type = (\d+)/
const RE_REPORT = /Report::Report:(.+?)\s*$/
const RE_HARDERR = /gHardErr\[2\]\s+(\d+)/
const RE_FLOW = /g_hardwarFlowCtrlCount\[1\]\s+(\d+)/

/** The lines worth a coloured mark on the timeline: `{ kind, label }` or null. */
export function marker(l) {
  const m = l.msg
  if (RE_SHOCK.test(m)) return { kind: 'shock', label: 'Shock saved' }
  const b = RE_BOOT.exec(m)
  if (b) return { kind: 'boot', label: 'Start-up (last power-off type ' + b[1] + ')' }
  if (/^Initialization Finished/.test(m)) return { kind: 'boot', label: 'Print server started' }
  if (/^Recorder_Open/.test(m)) return { kind: 'recorder', label: 'Recorder opened' }
  const r = RE_REPORT.exec(m)
  if (r) return { kind: 'report', label: r[1] }
  return alarmMarker(l)
}

/**
 * One row per saved shock: how long after start-up it came, when the recorder
 * opened, and how long until its report began printing.
 *   `backend` and `print` are the merged, time-ordered lines of the two logs.
 *   opts.slowSecs: a report later than this is "slow"; opts.windowSecs: how long to wait for one.
 */
export function shockTable(backend, print, opts = {}) {
  const slowSecs = opts.slowSecs ?? 5
  const windowSecs = opts.windowSecs ?? 120
  const boots = backend.filter(l => RE_BOOT.test(l.msg) && !l.early)
  const shocks = backend.filter(l => RE_SHOCK.test(l.msg) && !l.early)
  const rows = []
  shocks.forEach((s, i) => {
    // the last start-up before the shock, if it was within a day
    let boot = null
    for (let k = boots.length - 1; k >= 0; k--) if (boots[k].t <= s.t) { boot = boots[k]; break }
    if (boot && s.t - boot.t > 86400e3) boot = null
    const sinceBoot = boot ? (s.t - boot.t) / 1000 : null

    // recorder opened: the first one at or after that start-up (else the latest before the shock)
    let rec = null
    if (boot) {
      for (let k = lowerBound(print, boot.t); k < print.length; k++) {
        if (print[k].t > s.t + windowSecs * 1000) break
        if (/^Recorder_Open/.test(print[k].msg)) { rec = print[k]; break }
      }
    }
    const recorderRel = rec ? (rec.t - s.t) / 1000 : null

    // first report job at or after the shock, within the window
    let rep = null, repName = ''
    const end = s.t + windowSecs * 1000
    for (let k = lowerBound(print, s.t); k < print.length && print[k].t <= end; k++) {
      const m = RE_REPORT.exec(print[k].msg)
      if (m) { rep = print[k]; repName = m[1]; break }
    }
    const delay = rep ? (rep.t - s.t) / 1000 : null

    // problems logged by the print server while waiting
    let errors = 0
    const stop = rep ? rep.t : s.t + 60e3
    for (let k = lowerBound(print, s.t); k < print.length && print[k].t <= stop; k++) if (print[k].lvl === 'ERROR') errors++

    // the recorder's own counters, printed near the end of each report
    let hardErr = null, flow = null
    if (rep) {
      for (let k = lowerBound(print, rep.t); k < print.length && print[k].t <= rep.t + 60e3; k++) {
        const a = RE_HARDERR.exec(print[k].msg), f = RE_FLOW.exec(print[k].msg)
        if (a && hardErr == null) hardErr = +a[1]
        if (f && flow == null) flow = +f[1]
        if (hardErr != null && flow != null) break
      }
    }

    const next = shocks[i + 1]
    const nextIn = next && next.t - s.t <= windowSecs * 1000 ? (next.t - s.t) / 1000 : null
    const status = delay == null ? 'none' : delay > slowSecs ? 'slow' : 'ok'
    const energy = RE_ENERGY.exec(s.msg)
    const type = boot ? RE_BOOT.exec(boot.msg)[1] : null
    rows.push({
      t: s.t, line: s, status, shockTime: fmtTime(s.t), energy: energy ? +energy[1] : null,
      sinceBoot, bootType: type, recorderRel, delay, report: repName, errors, hardErr, flow, nextIn,
    })
  })
  return rows
}

export const SHOCK_COLUMNS = [
  { key: 'shockTime', label: 'Shock saved' },
  { key: 'energy', label: 'Spark energy (raw)' },
  { key: 'sinceBoot', label: 'Secs since start-up' },
  { key: 'bootType', label: 'Power-off type' },
  { key: 'recorderRel', label: 'Recorder opened (secs from shock)' },
  { key: 'delay', label: 'Secs to report' },
  { key: 'report', label: 'Report' },
  { key: 'errors', label: 'Print log errors' },
  { key: 'hardErr', label: 'gHardErr[2]' },
  { key: 'flow', label: 'FlowCtrl[1]' },
  { key: 'nextIn', label: 'Next shock in (secs)' },
  { key: 'status', label: 'Result' },
]

export const defib = {
  id: 'defib',
  name: 'Defibrillator',
  /** True if the files look like a BeneHeart defibrillator export. */
  detect: (families) => families.includes(FAMILIES.backend) || families.includes('DefibFrontendLog'),
  /** Opened together at first. */
  firstFamilies: [FAMILIES.backend, FAMILIES.print],
  families: FAMILIES,
  marker,
  markerKinds: {
    shock: 'Shock', boot: 'Start-up', recorder: 'Recorder', report: 'Report', alarm: 'Alarm',
  },
}

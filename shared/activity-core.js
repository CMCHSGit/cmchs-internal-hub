// The activity log's plain parts (shared/activity.js writes it; the admin's log page reads it): which tool a
// line came from, the entry that gets written, and filtering and exporting what is read back. No Firebase here,
// so the tests run it outside Vite.

/** The tool each line came from, shown on the log. Keys are the first part of the page's address. */
export const APP_LABELS = {
  hub: 'Hub',
  schedule: 'Schedule',
  oncall: 'On call',
  maintenance: 'Maintenance',
  'service-orders': 'Service orders',
  equipment: 'Equipment',
  projects: 'Projects',
  asks: 'Asks',
  checklists: 'Checklists',
  admin: 'Admin',
  settings: 'Settings',
  'pdf-editor': 'PDF editor',
  simprosync: 'SimproSync',
  ansurtopdf: 'Ansur',
}
export const appLabel = (app) => APP_LABELS[app] || app || 'Hub'

/** "/equipment/" -> "equipment"; the hub's home and its own pages -> "hub". */
export function appOfPath(path) {
  const first = String(path || '').split(/[?#]/)[0].split('/').filter(Boolean)[0] || ''
  return first && first !== 'index.html' && APP_LABELS[first] ? first : 'hub'
}

/** The longest a line may be (the rules allow 500). Longer is cut, not refused. */
export const MAX_SUMMARY = 400

/** The entry that would be written (without its time, which is the server's), or null when nothing should be. */
export function buildEntry(user, who, summary, opts = {}, path = '') {
  const text = String(summary || '').replace(/\s+/g, ' ').trim()
  if (!user?.uid || !text) return null
  const w = who && typeof who === 'object' ? who : {}
  return {
    uid: user.uid,
    name: w.displayName || w.name || user.displayName || user.email || 'Someone',
    email: w.email || user.email || null,
    summary: text.length > MAX_SUMMARY ? text.slice(0, MAX_SUMMARY - 1) + '…' : text,
    app: opts.app || appOfPath(path),
  }
}

/** A line read back: its time in milliseconds (0 while the server's time hasn't come back yet), from a Firestore Timestamp or a plain value. */
export const atMs = (e) => {
  const at = e?.at
  if (!at) return 0
  if (typeof at.toMillis === 'function') return at.toMillis()
  if (typeof at === 'number') return at
  const t = Date.parse(at)
  return Number.isNaN(t) ? 0 : t
}

/** Lines whose tool, person and words match; each filter is ignored when empty. Lines from before tools were recorded count as the schedule's. */
export function filterEntries(entries, { app = '', who = '', text = '' } = {}) {
  const q = text.trim().toLowerCase()
  return entries.filter((e) =>
    (!app || (e.app || 'schedule') === app) &&
    (!who || (e.email || e.name) === who) &&
    (!q || `${e.name || ''} ${e.summary || ''}`.toLowerCase().includes(q)))
}

/** The people in these lines, for a picker: [{ id, name }] by name. */
export function peopleIn(entries) {
  const m = new Map()
  for (const e of entries) { const id = e.email || e.name; if (id && !m.has(id)) m.set(id, e.name || id) }
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** Day and time in New Zealand, for the log and its spreadsheet ("2026-10-30 14:05"). */
export function nzStamp(ms) {
  if (!ms) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

const cell = (v) => {
  let s = String(v ?? '')
  // A cell starting with = + - @ would be run as a formula by Excel: the log holds text people typed.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The lines as a CSV (When, Who, Email, Tool, What), newest first as given. */
export function entriesToCsv(entries) {
  const rows = [['When (NZ)', 'Who', 'Email', 'Tool', 'What']]
    .concat(entries.map((e) => [nzStamp(atMs(e)), e.name || '', e.email || '', appLabel(e.app || 'schedule'), e.summary || '']))
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

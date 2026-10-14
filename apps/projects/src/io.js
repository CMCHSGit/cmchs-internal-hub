/* Import and export. Excel goes through exceljs, loaded only when someone
   asks for it (it is large, and kept out of the service worker's precache by
   scripts/build.mjs). The Excel export has the same two sheets the team kept
   by hand: the job register and the weekly timeline. */

import { fmt, fmtY, isISO, mondayOf, weeksFrom, addDays, jobStaff, todayISO, PRIORITIES } from './model.js'

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function registerRows(s) {
  const initials = (ids) => (ids || []).map((id) => s.staffById.get(id)?.initials).filter(Boolean).join(', ')
  return s.jobs.map((j) => ({
    Job: j.name,
    Category: s.catById.get(j.category)?.name || '',
    Status: j.status,
    'Waiting on': j.status === 'Waiting' ? j.waitingOn || '' : '',
    Priority: j.priority,
    Customer: j.customer,
    Region: j.region,
    Start: j.start,
    End: j.end,
    Engineering: initials(j.eng),
    'Apps / sales': initials(j.apps),
    'Project manager': j.owner || '',
    'Customer lead': [j.lead?.name, j.lead?.contact].filter(Boolean).join(', '),
    Equipment: (j.equipment || []).map((l) => `${l.qty}x ${l.model} (${l.line})`).join('; '),
    Tracking: j.freight?.tracking || '',
    ETA: j.freight?.eta || '',
    Freight: j.freight?.state || '',
    'Open actions': (j.actions || []).filter((a) => !a.done).map((a) => `${a.text}${a.due ? ' (due ' + fmt(a.due) + ')' : ''}`).join('; '),
    'Latest note': [...(j.notes || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]?.text || '',
    Archived: j.archived ? 'Yes' : '',
  }))
}

export function exportCSV(s) {
  const rows = registerRows(s)
  const head = Object.keys(rows[0] || { Job: '' })
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const text = [head.map(q).join(','), ...rows.map((r) => head.map((h) => q(r[h])).join(','))].join('\r\n')
  download(new Blob(['﻿' + text], { type: 'text/csv' }), `Project-tracker-${todayISO()}.csv`)
}

export async function exportXLSX(s) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const reg = wb.addWorksheet('Job register', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] })
  const rows = registerRows(s)
  const head = Object.keys(rows[0] || { Job: '' })
  reg.columns = head.map((h) => ({ header: h, key: h, width: h === 'Job' ? 48 : ['Equipment', 'Open actions', 'Latest note'].includes(h) ? 50 : 16 }))
  for (const r of rows) reg.addRow({ ...r, Start: isISO(r.Start) ? fmtY(r.Start) : '', End: isISO(r.End) ? fmtY(r.End) : '', ETA: isISO(r.ETA) ? fmtY(r.ETA) : '' })
  reg.getRow(1).font = { bold: true }

  // The weekly sheet: active jobs down the side, Mondays across, who and what in each cell.
  const active = s.jobs.filter((j) => !j.archived)
  const dates = active.flatMap((j) => [j.start, j.end]).concat(s.assignments.map((a) => a.week)).filter(isISO).sort()
  const from = mondayOf(dates.find((d) => d >= addDays(todayISO(), -28)) || todayISO())
  const to = dates[dates.length - 1] || addDays(from, 7 * 12)
  const weeks = weeksFrom(from, Math.min(52, Math.max(1, Math.ceil((new Date(to) - new Date(from)) / 6048e5) + 1)))
  const tl = wb.addWorksheet('Weekly timeline', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] })
  tl.columns = [{ header: 'Job', key: 'job', width: 48 }, ...weeks.map((w) => ({ header: fmt(w), key: w, width: 18 }))]
  for (const cat of s.settings.categories) {
    const jobs = active.filter((j) => j.category === cat.id)
    if (!jobs.length) continue
    const g = tl.addRow({ job: cat.name })
    g.font = { bold: true }
    for (const j of jobs) {
      const row = { job: j.name }
      for (const w of weeks) {
        row[w] = s.assignments.filter((a) => a.jobId === j.id && a.week === w)
          .map((a) => `${s.staffById.get(a.staffId)?.initials || '?'} ${a.activity}`).join(', ')
      }
      tl.addRow(row)
    }
  }
  tl.getRow(1).font = { bold: true }
  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Project-tracker-${todayISO()}.xlsx`)
}

// ── import ──
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
const HEADERS = [
  ['name', ['job', 'jobname', 'name', 'project', 'projectname', 'description']],
  ['customer', ['customer', 'hospital', 'site', 'customerhospital', 'account']],
  ['region', ['region', 'dhb', 'area', 'location']],
  ['category', ['category', 'group', 'type']],
  ['status', ['status', 'stage']],
  ['priority', ['priority']],
  ['start', ['start', 'startdate', 'plannedstart', 'from']],
  ['end', ['end', 'enddate', 'plannedend', 'to', 'finish']],
  ['waitingOn', ['waitingon', 'waiting']],
  ['tracking', ['tracking', 'trackingnumber', 'freight', 'freighttracking', 'connote']],
  ['notes', ['notes', 'note', 'comments', 'actionpoints']],
  ['owner', ['projectmanager', 'pm', 'owner']],
]

const pad = (n) => String(n).padStart(2, '0')
export function parseDate(raw) {
  if (raw == null || raw === '') return ''
  if (raw instanceof Date && !isNaN(raw)) return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`
  const s = String(raw).trim()
  let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(s)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/.exec(s) // NZ: day first
  if (m) return `${+m[3] < 100 ? +m[3] + 2000 : m[3]}-${pad(m[2])}-${pad(m[1])}`
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-]?(\d{4})?$/.exec(s) // 12-Oct, 12 Oct 2026
  if (m) {
    const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase())
    if (mo >= 0) return `${m[3] || new Date().getFullYear()}-${pad(mo + 1)}-${pad(m[1])}`
  }
  if (/^\d{5}$/.test(s)) return new Date((Number(s) - 25569) * 86400000).toISOString().slice(0, 10)
  return ''
}

function cellText(v) {
  if (v == null) return ''
  if (v instanceof Date) return v
  if (typeof v === 'object') return v.text ?? v.result ?? (v.richText ? v.richText.map((r) => r.text).join('') : '')
  return v
}

async function readRows(file) {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text()
    const rows = []
    let row = [], cur = '', quoted = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') quoted = false
        else cur += c
      } else if (c === '"') quoted = true
      else if (c === ',') { row.push(cur); cur = '' } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++
        row.push(cur); rows.push(row); row = []; cur = ''
      } else cur += c
    }
    if (cur || row.length) { row.push(cur); rows.push(row) }
    return rows.map((r) => r.map((x) => x.replace(/^﻿/, '')))
  }
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  const rows = []
  ws.eachRow({ includeEmpty: false }, (r) => { rows.push((r.values || []).slice(1).map(cellText)) })
  return rows
}

/** Reads a register into job fields. The heading row can be anywhere in the first 10 rows. */
export async function readImportFile(file, settings) {
  const rows = await readRows(file)
  const hIdx = rows.slice(0, 10).findIndex((r) => r.some((c) => HEADERS[0][1].includes(norm(c))))
  if (hIdx < 0) return []
  const head = rows[hIdx].map(norm)
  const col = Object.fromEntries(HEADERS.map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]))
  const cats = settings.categories
  const statuses = settings.statuses.map((x) => x.name)
  const out = []
  for (const r of rows.slice(hIdx + 1)) {
    const get = (k) => (col[k] >= 0 ? r[col[k]] : '')
    const name = String(get('name') ?? '').trim()
    if (!name) continue
    const catRaw = norm(get('category'))
    const cat = cats.find((c) => norm(c.name) === catRaw || (catRaw && norm(c.name).includes(catRaw))) ||
      (/^1/.test(catRaw) ? cats[0] : /^2/.test(catRaw) ? cats[1] : /^3/.test(catRaw) ? cats[2] : /^4/.test(catRaw) ? cats[3] : null)
    const stRaw = String(get('status') ?? '').trim()
    const status = statuses.find((x) => norm(x) === norm(stRaw)) || statuses.find((x) => norm(stRaw).startsWith(norm(x).slice(0, 5))) || 'Planning'
    const prRaw = String(get('priority') ?? '').trim()
    const notes = String(get('notes') ?? '').trim()
    const job = {
      name,
      customer: String(get('customer') ?? '').trim(),
      region: String(get('region') ?? '').trim(),
      status,
      priority: PRIORITIES.find((p) => p.toLowerCase() === prRaw.toLowerCase()) || 'Medium',
      start: parseDate(get('start')),
      end: parseDate(get('end')),
      waitingOn: String(get('waitingOn') ?? '').trim(),
      freight: { tracking: String(get('tracking') ?? '').trim(), eta: '', arrived: false },
      notes: notes ? [{ id: Math.random().toString(36).slice(2, 10), at: todayISO(), by: 'Import', text: notes }] : [],
    }
    if (cat) job.category = cat.id
    const owner = String(get('owner') ?? '').trim()
    if (owner) job.owner = owner
    out.push(job)
  }
  return out
}

export { jobStaff }

/* Maintenance schedule — sign-in gate, then the page.

   Reads the staff schedule's Firebase project, the same sign-in every tool on
   internal.chsnz.co.nz shares, so anyone already signed in at the hub lands
   straight in. Everyone can read; the Engineers and Management teams, plus
   admins, can edit (enforced in firestore.rules, not here — the buttons below
   only reflect that rule, they don't implement it). */

import { onAuthStateChanged, signInWithPopup } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../schedule/src/firebase.js'
import { registerServiceWorker } from '../../shared/register-sw.js'
import {
  PM_TYPES, STATUSES, watchEntries, createEntry, saveEntry, removeEntry,
  createMany, removeMany, formatDue, isOverdue, isDone, yearOf,
} from './store.js'
import { readWorkbook } from './import.js'

registerServiceWorker()

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const EDIT_TEAMS = ['Engineers', 'Management']

let me = null
let canEdit = false
let entries = []
let unwatch = null
let sort = { key: 'due', dir: 1 }
let only = ''            // tile filter: '', 'overdue', 'due90', 'open', 'done'

// ── sign in ───────────────────────────────────────────────────────────────
function gate(msg, showButton = false) {
  $('gateMsg').textContent = msg
  $('signIn').hidden = !showButton
}

$('signIn').addEventListener('click', () => {
  gate('Signing in…')
  signInWithPopup(auth, microsoftProvider).catch((e) => {
    if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') {
      return gate('Sign in to see the maintenance schedule.', true)
    }
    gate('Sign-in did not complete: ' + (e.message || e), true)
  })
})

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    unwatch?.(); unwatch = null
    $('app').hidden = true; $('gate').hidden = false
    return gate('Sign in to see the maintenance schedule.', true)
  }
  me = user
  gate('Loading…')
  try {
    const snap = await getDoc(doc(db, 'users', user.uid))
    const profile = snap.exists() ? snap.data() : {}
    canEdit = profile.role === 'admin' || EDIT_TEAMS.includes(profile.team)
    $('who').textContent = `${profile.displayName || user.displayName || user.email}${canEdit ? '' : ' · read only'}`
    $('addBtn').hidden = !canEdit
    $('importBtn').hidden = !canEdit
    $('clear').hidden = !canEdit
    $('gate').hidden = true
    $('app').hidden = false
    start()
  } catch (e) {
    gate('Could not load your profile: ' + (e.message || e), false)
  }
})

// ── live data ─────────────────────────────────────────────────────────────
function start() {
  if (unwatch) return
  unwatch = watchEntries(
    (list) => { entries = list; render() },
    (err) => {
      // The most likely cause by far is the firestore.rules change not being
      // deployed yet, so say that rather than only printing the raw error.
      msg(err.code === 'permission-denied'
        ? 'Firestore refused to read the maintenance collection. Its security rule may not be deployed yet.'
        : 'Could not load entries: ' + (err.message || err), 'warn')
    },
  )
}

const msg = (text, kind = '') => { $('msg').textContent = text; $('msg').className = 'msg' + (kind ? ' ' + kind : '') }

// ── filtering and sorting ─────────────────────────────────────────────────
const COLUMNS = [
  ['site', 'Site'], ['wards', 'Wards'], ['models', 'Models'], ['due', 'Due'],
  ['pmType', 'PM type'], ['status', 'Status'], ['dateComplete', 'Completed'], ['notes', 'Notes'],
]

const inDays = (e, days) => {
  if (!e.due || isDone(e.status)) return false
  const d = new Date(e.due)
  const limit = new Date(); limit.setDate(limit.getDate() + days)
  return d <= limit && !isOverdue(e)
}

function visible() {
  const q = $('q').value.trim().toLowerCase()
  const year = $('fYear').value
  const site = $('fSite').value
  const status = $('fStatus').value
  const type = $('fType').value

  return entries.filter((e) => {
    if (year && String(yearOf(e)) !== year) return false
    if (site && e.site !== site) return false
    if (status && e.status !== status) return false
    if (type && e.pmType !== type) return false
    if (only === 'overdue' && !isOverdue(e)) return false
    if (only === 'due90' && !inDays(e, 90)) return false
    if (only === 'open' && isDone(e.status)) return false
    if (only === 'done' && !isDone(e.status)) return false
    if (q) {
      const hay = [e.site, e.wards, e.models, e.notes, e.extraNotes, e.pmType, e.status].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }).sort((a, b) => {
    const k = sort.key
    const av = String(a[k] ?? ''), bv = String(b[k] ?? '')
    // Blank due dates sort last whichever way the column is pointing — an
    // entry with no date is not "the earliest".
    if (k === 'due' && (!av || !bv)) return !av && !bv ? 0 : (!av ? 1 : -1)
    return av.localeCompare(bv, undefined, { numeric: true }) * sort.dir
  })
}

// ── render ────────────────────────────────────────────────────────────────
function fillSelect(el, values, label) {
  const keep = el.value
  el.innerHTML = `<option value="">${label}</option>` + values.map((v) => `<option>${esc(v)}</option>`).join('')
  if (values.includes(keep)) el.value = keep
}

function statusPill(e) {
  if (isOverdue(e)) return '<span class="pill p-over">Overdue</span>'
  // Both completed states read as done; the Biomeds one is tinted differently
  // so it is still obvious at a glance who did the work.
  const cls = { 'In progress': 'p-prog', 'On hold': 'p-hold', 'Completed by Biomeds': 'p-ok-alt' }[e.status] || (isDone(e.status) ? 'p-ok' : 'p-none')
  return `<span class="pill ${cls}">${esc(e.status || 'Not started')}</span>`
}

function renderTiles() {
  const overdue = entries.filter((e) => isOverdue(e)).length
  const soon = entries.filter((e) => inDays(e, 90)).length
  const open = entries.filter((e) => !isDone(e.status)).length
  const done = entries.filter((e) => isDone(e.status)).length
  const tiles = [
    ['overdue', 'bad', overdue, 'Overdue'],
    ['due90', 'warn', soon, 'Due in 90 days'],
    ['open', '', open, 'Outstanding'],
    ['done', 'ok', done, 'Completed'],
    ['', '', entries.length, 'All entries'],
  ]
  $('tiles').innerHTML = tiles.map(([key, cls, n, label]) =>
    `<button class="tile ${cls}${only === key ? ' on' : ''}" data-only="${key}"><b>${n}</b><span>${label}</span></button>`).join('')
  for (const b of $('tiles').querySelectorAll('.tile')) {
    b.addEventListener('click', () => { only = b.dataset.only === only ? '' : b.dataset.only; render() })
  }
}

function render() {
  renderTiles()
  fillSelect($('fYear'), [...new Set(entries.map(yearOf).filter(Boolean))].sort().map(String), 'All years')
  fillSelect($('fSite'), [...new Set(entries.map((e) => e.site).filter(Boolean))].sort(), 'All sites')
  fillSelect($('fStatus'), STATUSES, 'Any status')
  fillSelect($('fType'), PM_TYPES, 'Any PM type')

  $('head').innerHTML = COLUMNS.map(([k, label]) =>
    `<th data-key="${k}">${label}${sort.key === k ? ` <span class="dir">${sort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')
  for (const th of $('head').querySelectorAll('th')) {
    th.addEventListener('click', () => {
      const k = th.dataset.key
      sort = { key: k, dir: sort.key === k ? -sort.dir : 1 }
      render()
    })
  }

  const rows = visible()
  $('count').textContent = `${rows.length} of ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
  $('empty').hidden = rows.length > 0
  $('rows').innerHTML = rows.map((e) => `
    <tr data-id="${esc(e.id)}">
      <td data-label="Site">${esc(e.site)}</td>
      <td data-label="Wards" class="ml">${esc(e.wards)}</td>
      <td data-label="Models" class="ml mono">${esc(e.models)}</td>
      <td data-label="Due">${esc(formatDue(e.due, e.monthOnly))}</td>
      <td data-label="PM type">${esc(e.pmType)}</td>
      <td data-label="Status">${statusPill(e)}</td>
      <td data-label="Completed">${esc(formatDue(e.dateComplete, false))}</td>
      <td data-label="Notes" class="ml">${esc([e.notes, e.extraNotes].filter(Boolean).join('\n'))}</td>
    </tr>`).join('')
  for (const tr of $('rows').querySelectorAll('tr')) {
    tr.addEventListener('click', () => openEdit(entries.find((x) => x.id === tr.dataset.id)))
  }
}

for (const id of ['q', 'fYear', 'fSite', 'fStatus', 'fType']) {
  $(id).addEventListener(id === 'q' ? 'input' : 'change', render)
}

// ── edit ──────────────────────────────────────────────────────────────────
let editing = null

function openEdit(entry) {
  editing = entry || null
  const e = entry || { status: 'Not started' }
  $('editTitle').textContent = entry ? 'Edit entry' : 'New entry'
  $('e-site').value = e.site || ''
  $('e-wards').value = e.wards || ''
  $('e-models').value = e.models || ''
  $('e-due').value = e.due ? e.due.slice(0, 7) : ''
  $('e-complete').value = e.dateComplete || ''
  $('e-notes').value = e.notes || ''
  $('e-extra').value = e.extraNotes || ''
  $('e-type').innerHTML = '<option value=""></option>' + PM_TYPES.map((t) => `<option${t === e.pmType ? ' selected' : ''}>${t}</option>`).join('')
  $('e-status').innerHTML = STATUSES.map((s) => `<option${s === (e.status || 'Not started') ? ' selected' : ''}>${s}</option>`).join('')
  $('del').hidden = !entry || !canEdit
  // Only offered on a saved entry: copying a form you have not written yet
  // is just typing it twice.
  $('copy').hidden = !entry || !canEdit
  $('save').hidden = !canEdit
  $('editMsg').textContent = canEdit ? '' : 'You have read-only access — ask an admin, or the Engineers or Management team, to make changes.'
  $('editMsg').className = 'msg'
  for (const f of ['e-site', 'e-wards', 'e-models', 'e-due', 'e-complete', 'e-notes', 'e-extra', 'e-type', 'e-status']) {
    $(f).disabled = !canEdit
  }
  $('edit').showModal()
}

function collect() {
  const month = $('e-due').value   // YYYY-MM from <input type="month">
  return {
    site: $('e-site').value.trim(),
    wards: $('e-wards').value.trim(),
    models: $('e-models').value.trim(),
    due: month ? `${month}-01` : '',
    // The form only asks for a month, which is how the sheet records most of
    // them. An imported day-level date is preserved unless the month changes.
    monthOnly: editing && editing.due && editing.due.slice(0, 7) === month ? !!editing.monthOnly : true,
    pmType: $('e-type').value,
    status: $('e-status').value,
    dateComplete: $('e-complete').value || '',
    notes: $('e-notes').value.trim(),
    extraNotes: $('e-extra').value.trim(),
  }
}

$('save').addEventListener('click', async () => {
  const data = collect()
  if (!data.site) { $('editMsg').textContent = 'Site is required.'; $('editMsg').className = 'msg warn'; return }
  $('save').disabled = true
  try {
    const who = me.email || me.uid
    if (editing) await saveEntry(editing.id, data, who)
    else await createEntry(data, who)
    $('edit').close()
    msg(editing ? 'Entry updated.' : 'Entry added.', 'ok')
  } catch (err) {
    $('editMsg').textContent = 'Could not save: ' + (err.message || err)
    $('editMsg').className = 'msg warn'
  } finally {
    $('save').disabled = false
  }
})

$('del').addEventListener('click', async () => {
  if (!editing) return
  if (!confirm(`Delete the ${editing.site} entry? This cannot be undone.`)) return
  try {
    await removeEntry(editing.id)
    $('edit').close()
    msg('Entry deleted.', 'ok')
  } catch (err) {
    $('editMsg').textContent = 'Could not delete: ' + (err.message || err)
    $('editMsg').className = 'msg warn'
  }
})

$('clear').addEventListener('click', async () => {
  const rows = visible()
  if (!rows.length) return
  const all = rows.length === entries.length
  const what = all ? `all ${rows.length} entries` : `the ${rows.length} entries currently shown`
  if (!confirm(`Delete ${what}? This cannot be undone.`)) return
  if (!confirm(`Really delete ${rows.length}? Type-check: this is permanent.`)) return
  $('clear').disabled = true
  try {
    await removeMany(rows.map((e) => e.id), (done, total) => msg(`Deleting… ${done} of ${total}`))
    msg(`Deleted ${rows.length} entries.`, 'ok')
  } catch (err) {
    msg('Could not delete: ' + (err.message || err), 'warn')
  } finally {
    $('clear').disabled = false
  }
})

// Roll a PM forward. The spreadsheet did this with a year tab per cycle; here
// it reuses the dialog that is already open — same site, wards and models, a
// year later, not yet done.
//
// Notes are kept deliberately. They are mostly standing context ("not
// charged", "Service Contract - pending!") rather than anything about the
// completed visit, and they are on screen to edit before saving. Status and
// date complete are the two fields that only describe the instance being
// copied, so those reset.
$('copy').addEventListener('click', () => {
  const month = $('e-due').value
  editing = null                       // so Save creates instead of updating
  $('editTitle').textContent = 'New entry, copied'
  if (month) {
    const [y, m] = month.split('-')
    $('e-due').value = `${Number(y) + 1}-${m}`
  }
  $('e-status').value = 'Not started'
  $('e-complete').value = ''
  $('del').hidden = true
  $('copy').hidden = true
  $('editMsg').textContent = month
    ? `Due moved to ${$('e-due').value}. Change anything you need, then Save to create it.`
    : 'The original had no due date — set one, then Save to create it.'
  $('editMsg').className = 'msg'
  $('e-due').focus()
})

$('cancel').addEventListener('click', () => $('edit').close())
$('addBtn').addEventListener('click', () => openEdit(null))

// ── CSV out ───────────────────────────────────────────────────────────────
$('csv').addEventListener('click', () => {
  const head = ['Site', 'Wards', 'Models', 'Due', 'PM type', 'Status', 'Date complete', 'Notes', 'Additional notes']
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  const lines = [head.map(q).join(',')]
  for (const e of visible()) {
    lines.push([e.site, e.wards, e.models, formatDue(e.due, e.monthOnly), e.pmType, e.status, e.dateComplete, e.notes, e.extraNotes].map(q).join(','))
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  a.download = `Maintenance-Schedule-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
})

// ── import ────────────────────────────────────────────────────────────────
let parsedSheets = []

$('importBtn').addEventListener('click', () => {
  parsedSheets = []
  $('impSheets').innerHTML = ''
  $('impMsg').textContent = ''
  $('impMsg').className = 'msg'
  $('impGo').disabled = true
  $('imp').showModal()
})
$('impCancel').addEventListener('click', () => $('imp').close())
$('pick').addEventListener('click', () => $('file').click())

$('file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0]
  if (!file) return
  $('impMsg').textContent = 'Reading…'
  $('impMsg').className = 'msg'
  try {
    parsedSheets = await readWorkbook(file)
    $('impSheets').innerHTML = parsedSheets.map((s, i) => {
      const bits = [`${s.entries.length} entries`]
      if (s.skipped) bits.push(`${s.skipped} blank rows skipped`)
      // Call out unreadable due dates before anything is written. The first
      // import quietly defaulted them all and nobody could tell.
      if (s.unreadable?.length) bits.push(`${s.unreadable.length} due dates unreadable`)
      const missing = ['site', 'dueRaw', 'status'].filter((k) => s.columns?.[k] === undefined)
      if (missing.length) bits.push(`no ${missing.join('/')} column found`)
      const detail = s.error ? s.error : bits.join(', ')
      return `<label class="imp-sheet">
        <input type="checkbox" data-i="${i}" style="width:auto;min-height:0"${s.entries.length ? ' checked' : ' disabled'}>
        <span class="grow"><b>${esc(s.name)}</b><br><span class="count">${esc(detail)}</span></span>
      </label>`
    }).join('')
    const total = parsedSheets.reduce((n, s) => n + s.entries.length, 0)
    $('impMsg').textContent = total ? `${total} entries found across ${parsedSheets.length} sheets.` : 'No entries found — is this the right workbook?'
    $('impMsg').className = 'msg' + (total ? '' : ' warn')
    $('impGo').disabled = !total
    for (const cb of $('impSheets').querySelectorAll('input')) {
      cb.addEventListener('change', () => {
        $('impGo').disabled = ![...$('impSheets').querySelectorAll('input:checked')].length
      })
    }
  } catch (err) {
    $('impMsg').textContent = 'Could not read the file: ' + (err.message || err)
    $('impMsg').className = 'msg warn'
  } finally {
    ev.target.value = '' // so re-picking the same file fires change again
  }
})

$('impGo').addEventListener('click', async () => {
  const picked = [...$('impSheets').querySelectorAll('input:checked')].map((cb) => parsedSheets[+cb.dataset.i])
  const all = picked.flatMap((s) => s.entries)
  if (!all.length) return
  // Importing twice would silently double everything, and nothing here can
  // tell a genuine repeat PM from a duplicate, so this is the one guard.
  if (entries.length && !confirm(`There are already ${entries.length} entries. Import ${all.length} more? Rows that already exist will be duplicated.`)) return

  $('impGo').disabled = true
  try {
    await createMany(all, me.email || me.uid, (done, total) => {
      $('impMsg').textContent = `Importing… ${done} of ${total}`
      $('impMsg').className = 'msg'
    })
    $('impMsg').textContent = `Imported ${all.length} entries.`
    $('impMsg').className = 'msg ok'
    setTimeout(() => $('imp').close(), 900)
  } catch (err) {
    $('impMsg').textContent = 'Import failed: ' + (err.message || err)
    $('impMsg').className = 'msg warn'
  } finally {
    $('impGo').disabled = false
  }
})

// ── pick up a new deploy ──────────────────────────────────────────────────
// A deploy doesn't reach an already-open page on its own: the service worker
// keeps serving the copy it cached, so a newly shipped button can be live and
// invisible at the same time. That is exactly what happened with "Delete
// shown". Reload when a new worker takes over — but never over the top of a
// part-filled form, which is why this waits rather than reloading blindly.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let handled = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A first install also claims the page; that is not an update.
    if (!hadController || handled) return
    handled = true
    if (!$('edit').open && !$('imp').open) return window.location.reload()
    msg('A new version is ready — reload the page when you have finished here.')
  })
}

// Build stamp. The version you are looking at is otherwise invisible, which is
// how a shipped change can sit in front of someone who cannot see it — the
// service worker serves the page it cached until something reloads it. Now it
// can be read off the header, and clicking it forces a fresh copy.
const built = new Date(__BUILT__)
const stamp = document.createElement('button')
stamp.type = 'button'
stamp.style.cssText = 'border:none;background:none;color:inherit;opacity:.55;font:inherit;font-size:12px;padding:0 0 0 8px;min-height:0;cursor:pointer'
stamp.textContent = `v ${built.toISOString().slice(5, 16).replace('T', ' ')}`
stamp.title = `This page was built ${built.toLocaleString()}.\nClick to check for a newer version.`
stamp.addEventListener('click', async () => {
  stamp.textContent = 'checking…'
  try { await (await navigator.serviceWorker?.getRegistration())?.update() } catch { /* offline */ }
  // If a newer worker was found it takes over and the handler below reloads;
  // if not, nothing happens, so say so rather than leaving it hanging.
  setTimeout(() => { stamp.textContent = `v ${built.toISOString().slice(5, 16).replace('T', ' ')} · latest` }, 1500)
})
$('who').after(stamp)

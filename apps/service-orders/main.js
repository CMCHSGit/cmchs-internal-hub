/* Service orders — sign-in gate, then the page.

   Replaces the service order spreadsheet and folds in the Service Order
   Parser: paste a service order, check the fields, save, and it lands in the
   In progress tab instead of on the clipboard. Same sign-in and permissions as
   the Maintenance Schedule — everyone reads; Engineers, Management and admins
   edit (enforced in firestore.rules; the buttons here only reflect it). */

import { onAuthStateChanged, signInWithPopup } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../schedule/src/firebase.js'
import { registerServiceWorker } from '../../shared/register-sw.js'
import {
  STAGES, FIELDS, LATE_DAYS, nextStage, watchOrders, createOrder, saveOrder, removeOrder,
  createMany, formatDate, today, daysWaiting,
} from './store.js'
import { parseServiceOrder, AUTO_FIELDS } from './parse.js'
import { readWorkbook } from './import.js'
import '../../shared/tool-chrome.css'
import { mountToolChrome } from '../../shared/tool-chrome.js'

registerServiceWorker()

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const EDIT_TEAMS = ['Engineers', 'Management']
const EDIT_FIELDS = FIELDS // every field has an e-<field> input

let me = null
let canEdit = false
let orders = []
let unwatch = null
let view = 'In progress'   // a stage, 'late' or 'all'
let sort = { key: 'dateRaised', dir: 1 }

// ── sign in ───────────────────────────────────────────────────────────────
function gate(text, showButton = false) {
  $('gateMsg').textContent = text
  $('signIn').hidden = !showButton
}

$('signIn').addEventListener('click', () => {
  gate('Signing in…')
  signInWithPopup(auth, microsoftProvider).catch((e) => {
    if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') {
      return gate('Sign in to see service orders.', true)
    }
    gate('Sign-in did not complete: ' + (e.message || e), true)
  })
})

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    unwatch?.(); unwatch = null
    $('app').hidden = true; $('gate').hidden = false
    return gate('Sign in to see service orders.', true)
  }
  me = user
  gate('Loading…')
  try {
    const snap = await getDoc(doc(db, 'users', user.uid))
    const profile = snap.exists() ? snap.data() : {}
    canEdit = profile.role === 'admin' || EDIT_TEAMS.includes(profile.team)
    $('who').textContent = `${profile.displayName || user.displayName || user.email}${canEdit ? '' : ' · read only'}`
    for (const b of ['pasteBtn', 'addBtn', 'importBtn']) $(b).hidden = !canEdit
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
  unwatch = watchOrders(
    (list) => { orders = list; render() },
    (err) => {
      msg(err.code === 'permission-denied'
        ? 'Firestore refused to read the serviceOrders collection. Its security rule may not be published yet.'
        : 'Could not load service orders: ' + (err.message || err), 'warn')
    },
  )
}

const msg = (text, kind = '') => { $('msg').textContent = text; $('msg').className = 'msg' + (kind ? ' ' + kind : '') }
const isLate = (o) => (daysWaiting(o) ?? 0) >= LATE_DAYS

// ── filtering and sorting ─────────────────────────────────────────────────
const COLUMNS = [
  ['so', 'S.O'], ['sn', 'SN'], ['partName', 'Part'], ['needReturn', 'Return'], ['site', 'Site'],
  ['notes', 'Notes'], ['jobs', 'Jobs'], ['appliedBy', 'Applied by'], ['dateRaised', 'Raised'], ['receivedDate', 'Received'],
]

function visible() {
  const q = $('q').value.trim().toLowerCase()
  const site = $('fSite').value
  const ret = $('fReturn').value
  return orders.filter((o) => {
    if (view === 'late' ? !isLate(o) : view !== 'all' && o.stage !== view) return false
    if (site && o.site !== site) return false
    if (ret && o.needReturn !== ret) return false
    if (q) {
      const hay = FIELDS.map((k) => o[k]).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }).sort((a, b) => {
    const k = sort.key
    const av = String(a[k] ?? ''), bv = String(b[k] ?? '')
    // Blanks last whichever way the column points — no date isn't "earliest".
    if (!av || !bv) return !av && !bv ? 0 : (!av ? 1 : -1)
    return av.localeCompare(bv, undefined, { numeric: true }) * sort.dir
  })
}

// ── render ────────────────────────────────────────────────────────────────
function fillSelect(el, values, label) {
  const keep = el.value
  el.innerHTML = `<option value="">${label}</option>` + values.map((v) => `<option>${esc(v)}</option>`).join('')
  if (values.includes(keep)) el.value = keep
}

function renderTiles() {
  const tiles = STAGES.map((s) => [s, '', orders.filter((o) => o.stage === s).length, s])
  tiles.push(['late', 'bad', orders.filter(isLate).length, `Waiting ${LATE_DAYS}+ days`])
  tiles.push(['all', '', orders.length, 'All'])
  $('tiles').innerHTML = tiles.map(([key, cls, n, label]) =>
    `<button class="tile ${cls}${view === key ? ' on' : ''}" data-view="${esc(key)}"><b>${n}</b><span>${esc(label)}</span></button>`).join('')
  for (const b of $('tiles').querySelectorAll('.tile')) {
    b.addEventListener('click', () => { view = b.dataset.view; render() })
  }
}

function row(o) {
  const wait = daysWaiting(o)
  const waitPill = wait != null && wait >= LATE_DAYS ? ` <span class="pill p-late">${wait} days</span>` : ''
  const stagePill = view === 'all' || view === 'late' ? `<span class="small"><span class="pill p-stage">${esc(o.stage)}</span></span>` : ''
  const ret = o.needReturn ? `<span class="pill ${o.needReturn === 'YES' ? 'p-yes' : 'p-no'}">${o.needReturn}</span>` : ''
  const more = [o.oldSo && `Old SO ${o.oldSo}`, o.extraNotes].filter(Boolean).join('\n')
  return `
    <tr data-id="${esc(o.id)}">
      <td data-label="S.O"><div>${esc(o.so) || '—'}<span class="small">${esc(o.title)}</span>${stagePill}</div></td>
      <td data-label="SN" class="mono">${esc(o.sn)}</td>
      <td data-label="Part"><div><span class="mono">${esc(o.pn)}</span><span class="small">${esc(o.partName)}</span></div></td>
      <td data-label="Return">${ret}</td>
      <td data-label="Site">${esc(o.site)}</td>
      <td data-label="Notes"><div class="ml">${esc(o.notes)}${more ? `<span class="small ml">${esc(more)}</span>` : ''}</div></td>
      <td data-label="Jobs">${esc(o.jobs)}</td>
      <td data-label="Applied by">${esc(o.appliedBy)}</td>
      <td data-label="Raised">${esc(formatDate(o.dateRaised))}${waitPill}</td>
      <td data-label="Received">${esc(formatDate(o.receivedDate))}</td>
    </tr>`
}

function render() {
  renderTiles()
  const sites = [...new Set(orders.map((o) => o.site).filter(Boolean))].sort()
  fillSelect($('fSite'), sites, 'All sites')
  $('siteList').innerHTML = sites.map((s) => `<option value="${esc(s)}">`).join('')

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
  const scope = view === 'all' ? '' : view === 'late' ? ` waiting ${LATE_DAYS}+ days` : ` in ${view}`
  $('count').textContent = `${rows.length} ${rows.length === 1 ? 'order' : 'orders'}${scope}`
  $('empty').hidden = rows.length > 0
  $('rows').innerHTML = rows.map(row).join('')
  for (const tr of $('rows').querySelectorAll('tr')) {
    tr.addEventListener('click', () => openEdit(orders.find((x) => x.id === tr.dataset.id)))
  }
}

for (const id of ['q', 'fSite', 'fReturn']) $(id).addEventListener(id === 'q' ? 'input' : 'change', render)

// ── edit ──────────────────────────────────────────────────────────────────
let editing = null

/** Where this order goes next. Nothing to send back means no shipping step. */
function nextFor(o) {
  const n = nextStage(o.stage)
  return n === 'Ready for shipping' && o.needReturn === 'NO' ? 'Completed or sent back' : n
}

function editMsg(text, kind = '') { $('editMsg').textContent = text; $('editMsg').className = 'msg' + (kind ? ' ' + kind : '') }

/** `auto` lists the fields the parser filled, so they get highlighted for checking. */
function openEdit(order, prefill = null, auto = []) {
  editing = order || null
  const o = order || { stage: STAGES[0], ...prefill }
  $('editTitle').textContent = order ? `S.O ${order.so || '(no number)'}` : prefill ? 'New from service order' : 'New service order'
  $('e-stage').innerHTML = STAGES.map((s) => `<option>${esc(s)}</option>`).join('')
  for (const f of EDIT_FIELDS) {
    const el = $('e-' + f)
    el.value = o[f] || ''
    el.disabled = !canEdit
    el.classList.toggle('auto', auto.includes(f))
  }
  $('del').hidden = !order || !canEdit
  $('save').hidden = !canEdit
  updateAdvance()

  editMsg('')
  if (!canEdit) editMsg('You have read-only access — ask an admin, or the Engineers or Management team, to make changes.')
  else if (prefill) {
    const dup = o.so && orders.find((x) => x.so === o.so)
    editMsg(dup
      ? `S.O ${o.so} is already in ${dup.stage}. Saving will add a second copy.`
      : `${auto.length} of ${AUTO_FIELDS.length} fields found — green ones came from the service order. Add the Simpro job if there is one.`, dup ? 'warn' : '')
  }
  $('edit').showModal()
}

function updateAdvance() {
  const n = canEdit && editing ? nextFor({ stage: $('e-stage').value, needReturn: $('e-needReturn').value }) : null
  $('advance').hidden = !n
  if (n) $('advance').textContent = `Save and move to ${n} →`
}
$('e-stage').addEventListener('change', updateAdvance)
$('e-needReturn').addEventListener('change', updateAdvance)
for (const f of EDIT_FIELDS) $('e-' + f).addEventListener('input', (ev) => ev.target.classList.remove('auto'))

const collect = () => Object.fromEntries(EDIT_FIELDS.map((f) => [f, $('e-' + f).value.trim()]))

async function save(advance) {
  const data = collect()
  if (!data.so && !data.partName && !data.pn) return editMsg('Give it at least an S.O or a part.', 'warn')
  if (advance) data.stage = nextFor(data)
  // Received is the day it moved to Received, unless someone said otherwise.
  if (data.stage === 'Received' && !data.receivedDate && (!editing || editing.stage !== 'Received')) data.receivedDate = today()
  if (!editing && data.so && orders.some((x) => x.so === data.so) &&
      !confirm(`S.O ${data.so} is already on the list. Add it again anyway?`)) return

  $('save').disabled = $('advance').disabled = true
  try {
    const who = me.email || me.uid
    if (editing) await saveOrder(editing.id, data, who, data.stage !== editing.stage)
    else await createOrder(data, who)
    $('edit').close()
    msg(advance ? `S.O ${data.so} moved to ${data.stage}.` : editing ? 'Saved.' : `S.O ${data.so} added to ${data.stage}.`, 'ok')
  } catch (err) {
    editMsg('Could not save: ' + (err.message || err), 'warn')
  } finally {
    $('save').disabled = $('advance').disabled = false
  }
}

$('save').addEventListener('click', () => save(false))
$('advance').addEventListener('click', () => save(true))
$('cancel').addEventListener('click', () => $('edit').close())
$('addBtn').addEventListener('click', () => openEdit(null))

$('del').addEventListener('click', async () => {
  if (!editing) return
  if (!confirm(`Delete S.O ${editing.so || '(no number)'}? This cannot be undone.`)) return
  try {
    await removeOrder(editing.id)
    $('edit').close()
    msg('Deleted.', 'ok')
  } catch (err) {
    editMsg('Could not delete: ' + (err.message || err), 'warn')
  }
})

// Every pop-up's ✕ (Esc already closes them, natively).
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close())

// ── paste a service order ─────────────────────────────────────────────────
$('pasteBtn').addEventListener('click', () => {
  $('pasteText').value = ''
  $('pasteMsg').textContent = ''
  $('paste').showModal()
  $('pasteText').focus()
})
$('pasteCancel').addEventListener('click', () => $('paste').close())
$('pasteGo').addEventListener('click', () => {
  const text = $('pasteText').value
  if (!text.trim()) { $('pasteMsg').textContent = 'Paste a service order first.'; $('pasteMsg').className = 'msg warn'; return }
  const { order, auto } = parseServiceOrder(text)
  if (!auto.length) {
    $('pasteMsg').textContent = 'Nothing recognisable in that — is it the full service order text?'
    $('pasteMsg').className = 'msg warn'
    return
  }
  $('paste').close()
  openEdit(null, order, auto)
})

// ── CSV out ───────────────────────────────────────────────────────────────
$('csv').addEventListener('click', () => {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  const head = ['Stage', 'S.O', 'SO Title', 'SN', 'PN', 'Part Name', 'Need Return', 'Site', 'Notes', 'Jobs', 'Applied By', 'Date Raised', 'Received Date', 'Old SO', 'Additional Notes']
  const lines = [head.map(q).join(',')]
  for (const o of visible()) {
    lines.push([o.stage, o.so, o.title, o.sn, o.pn, o.partName, o.needReturn, o.site, o.notes, o.jobs, o.appliedBy,
      o.dateRaised, o.receivedDate, o.oldSo, o.extraNotes].map(q).join(','))
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  a.download = `Service-Orders-${today()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
})

// ── import ────────────────────────────────────────────────────────────────
let parsedSheets = []
// The same part on the same S.O is the same row, whichever tab it came from.
const keyOf = (o) => `${o.so}|${o.pn || o.partName}`.toLowerCase()

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
      const detail = s.error || `${s.orders.length} orders → ${s.stage}${s.skipped ? `, ${s.skipped} rows skipped` : ''}`
      return `<label class="imp-sheet">
        <input type="checkbox" data-i="${i}" style="width:auto;min-height:0"${s.orders.length ? ' checked' : ' disabled'}>
        <span class="grow"><b>${esc(s.name)}</b><br><span class="count">${esc(detail)}</span></span>
      </label>`
    }).join('')
    const total = parsedSheets.reduce((n, s) => n + s.orders.length, 0)
    $('impMsg').textContent = total ? `${total} orders found.` : 'No orders found — is this the right workbook?'
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
  const have = new Set(orders.filter((o) => o.so).map(keyOf))
  const all = picked.flatMap((s) => s.orders)
  // Re-importing the workbook should top up, not double everything.
  const fresh = all.filter((o) => !o.so || !have.has(keyOf(o)))
  const dupes = all.length - fresh.length
  if (!fresh.length) {
    $('impMsg').textContent = `All ${all.length} are already here — nothing to import.`
    $('impMsg').className = 'msg'
    return
  }
  if (!confirm(`Import ${fresh.length} orders?${dupes ? ` ${dupes} already here will be skipped.` : ''}`)) return

  $('impGo').disabled = true
  try {
    await createMany(fresh, me.email || me.uid, (done, total) => {
      $('impMsg').textContent = `Importing… ${done} of ${total}`
      $('impMsg').className = 'msg'
    })
    $('impMsg').textContent = `Imported ${fresh.length} orders${dupes ? `, skipped ${dupes} already here` : ''}.`
    $('impMsg').className = 'msg ok'
    setTimeout(() => $('imp').close(), 1200)
  } catch (err) {
    $('impMsg').textContent = 'Import failed: ' + (err.message || err)
    $('impMsg').className = 'msg warn'
  } finally {
    $('impGo').disabled = false
  }
})

// ── pick up a new deploy ──────────────────────────────────────────────────
// The service worker keeps serving the page it cached, so a deploy is
// invisible to an open tab until something reloads it (the same fix as the
// Maintenance Schedule). Reload when a new worker takes over, but never over a
// half-pasted service order or a part-filled form.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let handled = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A first install also claims the page; that is not an update.
    if (!hadController || handled) return
    handled = true
    if (!$('edit').open && !$('imp').open && !$('paste').open) return window.location.reload()
    msg('A new version is ready — reload the page when you have finished here.')
  })
}


// The header, back button and light/dark switch are shared with the other
// tools so they look and behave the same in all of them.
mountToolChrome()
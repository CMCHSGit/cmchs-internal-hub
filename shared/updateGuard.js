// When it is safe to reload the app onto a new version (register-sw.js).
//
// The app updates itself when someone has left it alone for IDLE_MS and each
// time they come back to it, but never from under work in progress: an open
// dialog, a form with something typed into it, a PDF with unsaved edits, a loan
// being made. Those hold the update, and it goes through once they are done.
//
// What counts as "in the middle of something", most explicit first:
//   [data-working] / body.busy   a screen says so (the PDF editor while it has unsaved
//                                edits, a loan or upload being saved, a SimproSync run)
//   an open dialog or drawer     role=dialog / aria-modal / <dialog open>
//   a form field somebody typed  into and hasn't emptied or submitted, for DRAFT_MS
//                                (a search box doesn't count: nothing is lost)

export const IDLE_MS = 10 * 60_000   // no touch, key or scroll for this long = away: update
export const QUIET_MS = 4_000        // never reload within this long of the last touch
export const DRAFT_MS = 2 * 60 * 60_000 // a typed-into field older than this is treated as abandoned

/** A screen says it is working: a run in progress, a loaded file or preview not yet applied, unsaved edits. */
export const workInProgress = (doc = document) => doc.body.classList.contains('busy') || !!doc.querySelector('[data-working]')

/** Reload now? Pure, so it can be tested without a page. */
export function shouldReload({ ready, busy, sinceActiveMs }) {
  return !!ready && !busy && sinceActiveMs >= QUIET_MS
}

/** Ask the server for a newer version now? On coming back, or after IDLE_MS idle (at most once per IDLE_MS). */
export function shouldCheck({ resumed, sinceActiveMs, sinceCheckMs }) {
  if (resumed) return sinceCheckMs >= 15_000
  return sinceActiveMs >= IDLE_MS && sinceCheckMs >= IDLE_MS
}

const isSearchField = el =>
  el.matches('[type="search"],[role="searchbox"],[role="combobox"]') ||
  /search|filter/i.test(`${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''} ${el.name || ''} ${el.id || ''}`)

/** Does this field hold something typed in, that a reload would lose? */
function holdsDraft(el) {
  if (el.isContentEditable) return !!el.textContent.trim()
  const type = (el.type || '').toLowerCase()
  if (type === 'checkbox' || type === 'radio') return !!el.form && el.checked   // only inside a form
  if (el.tagName === 'SELECT') return !!el.form && !!el.value
  if (type === 'file') return !!el.files?.length
  return !!String(el.value ?? '').trim()
}

const visible = el => !el.closest('[aria-hidden="true"],[hidden]') && el.getClientRects().length > 0

/** Starts watching the page. Returns { busy, running, sinceActive }. */
export function startGuard(doc = document, win = window) {
  let lastActive = Date.now()
  const touched = new Map() // field → when it was last typed into

  const active = () => { lastActive = Date.now() }
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) win.addEventListener(ev, active, { capture: true, passive: true })
  doc.addEventListener('scroll', active, { capture: true, passive: true })

  const typed = e => {
    active()
    const el = e.target
    if (!e.isTrusted || !el?.matches?.('input,textarea,select,[contenteditable]') || isSearchField(el)) return
    touched.set(el, Date.now())
  }
  doc.addEventListener('input', typed, true)
  doc.addEventListener('change', typed, true)
  // Submitted or reset: that form's fields are done with.
  const done = e => { for (const el of [...touched.keys()]) if (e.target.contains?.(el)) touched.delete(el) }
  doc.addEventListener('submit', done, true)
  doc.addEventListener('reset', done, true)

  /** A screen that says it is working (a run in progress, unsaved PDF edits). */
  const running = () => workInProgress(doc)

  const dialogOpen = () => [...doc.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]')].some(visible)

  const draftOpen = () => {
    const now = Date.now()
    for (const [el, at] of touched) {
      if (!el.isConnected || now - at > DRAFT_MS) { touched.delete(el); continue }
      if (holdsDraft(el)) return true
    }
    return false
  }

  return {
    running,
    busy: () => running() || dialogOpen() || draftOpen(),
    sinceActive: () => Date.now() - lastActive,
  }
}

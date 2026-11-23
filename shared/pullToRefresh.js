// Swipe down to refresh, for phones (shared/register-sw.js turns it on).
//
// An installed phone app has no refresh button, and iPhones give a home-screen app no
// pull-to-refresh of its own. So: at the very top of a page, drag down, let go past the
// line, and the app reloads onto the newest version (reloadOntoLatest).
//
// It stays out of the way:
//   - only when the page is scrolled to the very top, and the finger did not start inside
//     something scrolled part-way (a list, a table, a dialog), or on a field or a map/canvas;
//   - never from under work in progress (an open dialog, a typed-into form, a run in
//     progress: the same test the quiet update uses, updateGuard.js), so nothing is lost;
//   - a sideways or upward drag, or a second finger, cancels it.
// Mark any area that must keep its own downward drag with data-no-pull.

export const TRIGGER_PX = 72   // pull this far (after resistance) and let go to refresh
export const MAX_PX = 110      // the indicator never goes further than this
const START_PX = 10            // the drag must be clearly downward before it counts

/** How far the indicator shows for a finger that has moved `dy` px down: it gets harder the further you pull. */
export function pullOffset(dy) {
  if (!(dy > START_PX)) return 0
  const d = dy - START_PX
  return Math.min(MAX_PX, d * 0.5)
}

/** Does letting go here refresh? */
export const pulledFarEnough = offset => offset >= TRIGGER_PX

/** May a drag that began at this touch start a pull? Pure, so it can be tested without a page. */
export function canStartPull({ touches = 1, pageScrollTop = 0, scrolledAncestor = false, ignoredTarget = false, busy = false }) {
  return touches === 1 && pageScrollTop <= 0 && !scrolledAncestor && !ignoredTarget && !busy
}

const IGNORED = 'input,textarea,select,canvas,iframe,[contenteditable],[data-no-pull],dialog[open],[role="dialog"],[aria-modal="true"]'

/** Is the touched element, or anything around it, a scroller that is not at its top? */
function inScrolledAncestor(el, doc) {
  for (let n = el; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
    if (n.scrollTop > 0) {
      const oy = getComputedStyle(n).overflowY
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return true
    }
  }
  return false
}

const CSS = `
#ptr{position:fixed;z-index:2147483500;left:50%;top:calc(env(safe-area-inset-top,0px) + var(--shell-header-h,64px));
  width:40px;height:40px;margin-left:-20px;margin-top:-52px;display:grid;place-items:center;border-radius:50%;
  background:#fff;color:#554596;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 4px 14px rgba(0,0,0,.3);
  opacity:0;pointer-events:none;will-change:transform,opacity}
#ptr svg{width:20px;height:20px;transition:transform .12s linear}
#ptr.ptr-back{transition:transform .22s cubic-bezier(.2,.8,.2,1),opacity .22s}
#ptr.ptr-spin svg{animation:ptr-spin .8s linear infinite}
@keyframes ptr-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){#ptr.ptr-back{transition:none}#ptr.ptr-spin svg{animation:none}}
@media print{#ptr{display:none}}`

const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>'

/**
 * Turns it on. `refresh` reloads (reloadOntoLatest); `busy` says "do not, work is in progress" (the update guard's).
 * Returns a function that turns it off again.
 */
export function enablePullToRefresh({ refresh, busy = () => false, doc = document, win = window }) {
  if (!matchMedia('(pointer: coarse)').matches) return () => {}

  let el = null
  const ensure = () => {
    if (el) return el
    const style = doc.createElement('style')
    style.textContent = CSS
    doc.head.appendChild(style)
    el = doc.createElement('div')
    el.id = 'ptr'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.innerHTML = ARROW
    doc.body.appendChild(el)
    return el
  }
  const draw = (offset, ready) => {
    const e = ensure()
    e.classList.remove('ptr-back')
    e.style.opacity = String(Math.min(1, offset / 40))
    e.style.transform = `translateY(${offset}px)`
    e.firstElementChild.style.transform = `rotate(${ready ? 180 : Math.min(180, (offset / TRIGGER_PX) * 180)}deg)`
  }
  const hide = () => {
    if (!el) return
    el.classList.add('ptr-back')
    el.style.opacity = '0'
    el.style.transform = 'translateY(0)'
  }

  let startY = 0
  let startX = 0
  let tracking = false
  let pulling = false
  let offset = 0
  let refreshing = false

  const reset = () => { tracking = false; pulling = false; offset = 0 }
  const top = () => (doc.scrollingElement || doc.documentElement).scrollTop

  const onStart = e => {
    if (refreshing) return
    const target = e.target instanceof Element ? e.target : null
    tracking = canStartPull({
      touches: e.touches.length,
      pageScrollTop: top(),
      scrolledAncestor: target ? inScrolledAncestor(target, doc) : false,
      ignoredTarget: target ? !!target.closest(IGNORED) : false,
      busy: busy(),
    })
    pulling = false
    if (tracking) { startY = e.touches[0].clientY; startX = e.touches[0].clientX }
  }

  const onMove = e => {
    if (!tracking) return
    if (e.touches.length !== 1 || top() > 0) { if (pulling) hide(); reset(); return }
    const dy = e.touches[0].clientY - startY
    const dx = e.touches[0].clientX - startX
    if (!pulling) {
      if (dy < -4) { reset(); return }                    // going up: an ordinary scroll
      if (dy > START_PX && Math.abs(dx) > dy) { reset(); return } // mostly sideways
      if (dy <= START_PX) return
      pulling = true
    }
    offset = pullOffset(dy)
    if (e.cancelable) e.preventDefault()                  // no bounce, no browser refresh on top of ours
    draw(offset, pulledFarEnough(offset))
  }

  const onEnd = () => {
    if (!pulling) { reset(); return }
    const go = pulledFarEnough(offset) && !busy()
    reset()
    if (!go) { hide(); return }
    refreshing = true
    const e = ensure()
    e.classList.add('ptr-back', 'ptr-spin')
    e.style.opacity = '1'
    e.style.transform = `translateY(${TRIGGER_PX * 0.7}px)`
    Promise.resolve(refresh()).catch(() => {}).finally(() => {
      // A reload normally replaces the page first; if it somehow did not, let people pull again.
      setTimeout(() => { refreshing = false; e.classList.remove('ptr-spin'); hide() }, 4000)
    })
  }
  const onCancel = () => { if (pulling) hide(); reset() }

  doc.addEventListener('touchstart', onStart, { passive: true })
  doc.addEventListener('touchmove', onMove, { passive: false })
  doc.addEventListener('touchend', onEnd, { passive: true })
  doc.addEventListener('touchcancel', onCancel, { passive: true })
  return () => {
    doc.removeEventListener('touchstart', onStart)
    doc.removeEventListener('touchmove', onMove)
    doc.removeEventListener('touchend', onEnd)
    doc.removeEventListener('touchcancel', onCancel)
    el?.remove()
  }
}

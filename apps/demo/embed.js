// /demo/embed.js — runs the real demo tracker inside the hub.
//
// /demo/ is NOT a fork of the tracker. apps/demo/build.mjs takes the current
// index.html from the chs-equipment repo on every hub deploy and injects this
// file as the very first script, before any of the tracker's own code. So
// /demo/ is the same app as demo.chsnz.co.nz, on the same live database:
// a loan made in either place shows up in both.
//
// What this file changes, always:
//  - The tracker's team password is skipped: the hub's Microsoft sign-in
//    already let you in. (Its separate admin password for delete / retire /
//    edit still applies.)
//  - Its service worker and push notifications are switched off here. The
//    site has one worker, the hub's, and one push setup, the schedule's.
//    Push for the demo tracker stays on demo.chsnz.co.nz.
//  - Always the desktop layout, phones included (it adapts to narrow
//    screens). The phone layout has its own sign-in that only passes once
//    it has matched you against the team list, loaded after it has already
//    picked a layout.
//
// READ_ONLY = true turns it back into a read-only copy: every write refused
// before it leaves the browser, editing buttons dimmed, a banner. It was
// read-only for its first day (2026-10-08); flip this if it ever needs to be
// again, e.g. while something is being investigated.
(function () {
  'use strict'

  var READ_ONLY = false
  var LIVE = 'https://demo.chsnz.co.nz/'
  var VIEWER = 'Read-only viewer'

  // ── Always: no team password, no second worker, no push, desktop layout ──
  try { sessionStorage.setItem('chs_auth', '1') } catch (e) {}

  // The tracker checks `'serviceWorker' in navigator` before registering its
  // own /sw.js (which here would be the hub's) and before offering push.
  // Removing the property makes both skip themselves. It doesn't uncontrol the
  // page: the hub's worker still serves it inside the installed app.
  try { delete Navigator.prototype.serviceWorker } catch (e) {}

  var realMatchMedia = window.matchMedia.bind(window)
  window.matchMedia = function (q) {
    if (/display-mode:\s*standalone/.test(q)) return realMatchMedia('(width: -1px)') // never matches
    return realMatchMedia(q)
  }
  try { Object.defineProperty(navigator, 'standalone', { value: false }) } catch (e) {}
  try {
    var params = new URLSearchParams(location.search)
    if (params.has('mobile')) {
      params.delete('mobile')
      var qs = params.toString()
      history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash)
    }
  } catch (e) {}

  // "Who are you?" puts your name on the audit log. Read-only had nothing to
  // log, so it answered with a placeholder; with writes on, that placeholder
  // must not end up in the log, so clear it and let the tracker ask.
  try {
    var op = localStorage.getItem('chs_operator')
    if (READ_ONLY && !op) localStorage.setItem('chs_operator', VIEWER)
    if (!READ_ONLY && op === VIEWER) localStorage.removeItem('chs_operator')
  } catch (e) {}

  if (!READ_ONLY) return

  // ── Read-only mode ──────────────────────────────────────────────────────
  // 1. Hard block: any request that could change something (database
  //    PUT/PATCH/POST/DELETE, any call to the Simpro Apps Script proxy) is
  //    refused before it leaves the browser. This is the guarantee.
  var READ_METHODS = { GET: 1, HEAD: 1, OPTIONS: 1 }
  function isWrite(method, url) {
    if (/script\.google\.com|script\.googleusercontent\.com/.test(String(url))) return true
    return !READ_METHODS[String(method || 'GET').toUpperCase()]
  }

  var realFetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input)
    var method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET'
    if (isWrite(method, url)) {
      explain()
      return Promise.reject(new Error('Read-only copy: changes are made at demo.chsnz.co.nz'))
    }
    return realFetch(input, init)
  }
  var xhrOpen = XMLHttpRequest.prototype.open
  var xhrSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__roWrite = isWrite(method, url)
    return xhrOpen.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function () {
    if (this.__roWrite) { explain(); throw new Error('Read-only copy') }
    return xhrSend.apply(this, arguments)
  }
  if (navigator.sendBeacon) navigator.sendBeacon = function () { return false }

  // 2. Editing controls: dimmed, and explained when clicked. Matched against
  //    the inline handler (onclick="saveItem()" etc). Viewing, searching,
  //    sorting, filtering, history, PDFs and exports stay usable.
  var EDIT = new RegExp('\\b(' + [
    'add[A-Z]\\w*', 'confirm\\w*', 'delete\\w*', 'remove\\w*', 'save\\w*', 'submit\\w*',
    'retire\\w*', 'restore\\w*', 'prompt(Add|Edit|Restore)\\w*', 'upload\\w*',
    'confirmImport', 'unlock\\w*', 'handle(FileSelect|RetiredImport)', 'issueLoan\\w*',
    '(return|count|edit)From\\w*', 'proceedFromBasket', 'linkExisting\\w*', 'retry\\w*',
    'reassign\\w*', 'sendLoanDocEmail', 'ma(SaveAll|AddSlot|RemoveSlot)', 'scanForOrphanedLoans',
    'historyMgmtAuth', 'openHistoryMgmt', 'toggle(Readiness|TestMode|SimproJobCreation)',
    'startKitBuilder', 'open(AddItems|AddKitGroup|BatchReturn|CopyLoan|Extend|LongTerm|Reassign|StuckLoan|AMModal|TestPush)\\w*',
    'mp(Book|Confirm|DoConfirm|Reassign|AddItems|AddSelected|EquipmentAddSelected|EquipmentDetailCheck|RequestStocktake|Unlock|SetAMRole|OpenTeamRoles|EnablePush|SubmitTestPush|OpenTestPush|ApplyTestPush|RunSheetAction|ConfirmScanCart)\\w*',
  ].join('|') + ')\\s*\\(')
  // detailAction('history') is a view; every other detailAction edits.
  var DETAIL_EDIT = /detailAction\(\s*'(?!history')/

  function isEditControl(el) {
    var h = el.getAttribute && (el.getAttribute('onclick') || el.getAttribute('onchange') || '')
    return !!h && (EDIT.test(h) || DETAIL_EDIT.test(h))
  }
  function lock(el) {
    if (el.__roChecked) return
    el.__roChecked = true
    if (!isEditControl(el)) return
    el.classList.add('ro-locked')
    el.setAttribute('aria-disabled', 'true')
    el.title = 'Read-only copy: make changes at demo.chsnz.co.nz'
  }
  function mark(root) {
    if (root.matches && root.matches('[onclick],[onchange]')) lock(root)
    var els = root.querySelectorAll ? root.querySelectorAll('[onclick],[onchange]') : []
    for (var i = 0; i < els.length; i++) lock(els[i])
  }

  // Capture phase, so it runs before the inline handler.
  function guard(e) {
    var el = e.target && e.target.closest && e.target.closest('[onclick],[onchange]')
    if (el && isEditControl(el)) { e.preventDefault(); e.stopImmediatePropagation(); explain() }
  }
  document.addEventListener('click', guard, true)
  document.addEventListener('change', guard, true)
  document.addEventListener('submit', function (e) { e.preventDefault(); explain() }, true)

  // Writes the tracker makes on its own (on load, on a timer) are blocked
  // silently; the note only answers something the person just did.
  var lastAction = 0
  function touched() { lastAction = Date.now() }
  document.addEventListener('pointerdown', touched, true)
  document.addEventListener('keydown', touched, true)

  var CSS = '' +
    '.ro-locked{opacity:.4 !important;cursor:not-allowed !important;filter:grayscale(1)}' +
    '#ro-banner{all:initial;display:flex;align-items:center;gap:10px;flex-wrap:wrap;box-sizing:border-box;padding:8px 16px;' +
      'background:#fee7d1;color:#1d1d1d;font:600 14px/1.35 "Source Sans 3","Segoe UI",system-ui,sans-serif;position:relative;z-index:2147482000}' +
    '#ro-banner span{font-weight:400}' +
    '#ro-banner a{color:#554596;font-weight:600;text-decoration:underline}' +
    '#ro-note{all:initial;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483646;max-width:calc(100vw - 32px);' +
      'box-sizing:border-box;background:#1d1d1d;color:#fff;border-radius:10px;padding:12px 16px;box-shadow:0 16px 48px rgba(29,29,29,.2);' +
      'font:400 14px/1.4 "Source Sans 3","Segoe UI",system-ui,sans-serif;opacity:0;transition:opacity 150ms cubic-bezier(.2,.6,.2,1);pointer-events:none}' +
    '#ro-note.on{opacity:1;pointer-events:auto}' +
    '#ro-note a{color:#cac4e3;font-weight:600}'

  var noteTimer = null
  function explain() {
    if (Date.now() - lastAction > 3000) { console.info('[read-only] blocked a background write'); return }
    var note = document.getElementById('ro-note')
    if (!note) {
      if (!document.body) return
      note = document.createElement('div')
      note.id = 'ro-note'
      note.setAttribute('role', 'status')
      note.innerHTML = 'This is a read-only copy. Make changes in the <a href="' + LIVE + '" target="_blank" rel="noopener">demo tracker</a>.'
      document.body.appendChild(note)
    }
    note.classList.add('on')
    clearTimeout(noteTimer)
    noteTimer = setTimeout(function () { note.classList.remove('on') }, 3200)
  }

  function onReady() {
    var style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)

    var banner = document.createElement('div')
    banner.id = 'ro-banner'
    banner.setAttribute('role', 'note')
    banner.innerHTML = 'Read-only copy <span>Live data, nothing can be changed here.</span> ' +
      '<a href="' + LIVE + '" target="_blank" rel="noopener">Open the demo tracker to make changes</a>'
    document.body.prepend(banner)

    // The status pill says "Live — auto-saving"; here it's live but read-only.
    if (typeof window.setSync === 'function') {
      var setSync = window.setSync
      window.setSync = function (state, text) {
        return setSync.call(this, state, typeof text === 'string' ? text.replace('auto-saving', 'read-only') : text)
      }
    }

    // Open on the Database tab, not the Scan / Loan form.
    if (!location.search && !location.hash) {
      var tries = 0
      var toDatabase = setInterval(function () {
        var app = document.getElementById('app')
        if (++tries > 100) return clearInterval(toDatabase)
        var loaded = false
        try { loaded = equipment.length > 0 } catch (e) {} // tracker's global; not declared yet early on
        if (typeof window.switchTab === 'function' && app && app.style.display === 'block' && loaded) {
          clearInterval(toDatabase)
          try { window.switchTab('database') } catch (e) {}
        }
      }, 200)
    }

    mark(document)
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes
        for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) mark(added[j])
      }
    }).observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true })
  else onReady()
})()

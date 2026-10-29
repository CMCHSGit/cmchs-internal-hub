/* The demo tracker's data for the rebuilt screens: what the old tracker
   loads (loadData), kept live the same way (data/_v changes, so read again),
   and changed the same way, because both run on this data side by side until
   the switch (INTEGRATION-PLAN.md step 4).

   Changes go where the old tracker puts them, so each tracker sees the
   other's: equipment and history in /data (updateData, guarded by its ETag);
   testing and dispatch in /loanMeta; bookings in /upcomingLoans; an audit
   entry in /auditLog. Anything outside /data then moves data/_v (touch), the
   one thing every open tracker watches. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { watchUser } from '../../../shared/session.js'
import { logActivity } from '../../../shared/activity.js'
import { PROXY_URL } from '../../../shared/proxy.js'
import { auth } from '../../schedule/src/firebase.js'
import { collection, doc as fsDoc, getDoc, getDocs } from 'firebase/firestore'
import { db as hubDb } from '../../schedule/src/firebase.js'
import { can } from '../../../shared/can.js'
import { cutover, isLocal, loadCutover, onFirestore, read, readOld, watch, watchCutover, write } from './db.js'
import { commit as fsCommit } from './db-firestore.js'
import {
  activateBookings, applyImport, importRetiredRows, kitFromNewAssets, planAddAssets, teamFrom, countEquipment, itemProblem, oldDate, restoreRetired, retireEquipment, saveItemEquipment, deleteLoanEquipment, existingLoanMatch, formDoc, formRows, loanFormHtml, planAddItems, planNewLoan, planTransfer, rowsWithAdded, rowsWithout, DEMO_TYPES, editBooking, editEquipment, extendEquipment, fmtDate, legacyLoanDocKey, loanAM, loanDocKey, memberFor, metaKey, newBatchId, newId, nzDate, nzNow,
  jobNumber, readinessKey, returnEquipment, returnFollowUps, toISO, withReadiness,
} from './model.js'

const Store = createContext(null)
export const useStore = () => useContext(Store)

const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : v && typeof v === 'object' ? Object.values(v).filter(Boolean) : [])
const enc = encodeURIComponent
// The old tracker's EmailJS account for the loan confirmation email (public: it's in that page too).
const EMAILJS = { service: 'service_ig1n6ut', template: 'template_24se0ve', key: 'vMgCBjvQgk-oWs34f' }
// The old tracker's test mode switch, shared through this origin's storage.
const readTestMode = () => { try { return localStorage.getItem('testMode') === '1' } catch { return false } }

export function StoreProvider({ children }) {
  const [state, setState] = useState({ ready: false, error: '' })
  const version = useRef(null) // the data/_v we last loaded or saved
  const latest = useRef(state)
  latest.current = state
  const [user, setUser] = useState(null)
  useEffect(() => watchUser(setUser), [])
  // Their hub record (role, trackerTester: shared/can.js) and everyone's
  // (users.trackerRole: the team, teamFrom). The dev server has neither: there
  // the person is an admin and a tester, so every screen can be tried.
  const [people, setPeople] = useState({ profile: null, users: [] })
  useEffect(() => {
    if (!user) return
    if (!hubDb) { setPeople({ profile: { role: 'admin', trackerTester: true }, users: [] }); return }
    let live = true
    Promise.all([getDoc(fsDoc(hubDb, 'users', user.uid)), getDocs(collection(hubDb, 'users'))])
      .then(([me, all]) => { if (live) setPeople({ profile: me.exists() ? me.data() : null, users: all.docs.map((d) => ({ uid: d.id, ...d.data() })) }) })
      .catch((e) => console.warn('[equipment] hub records not read', e))
    return () => { live = false }
  }, [user])

  // The equipment and bookings first, which is all the lists need to show;
  // the loan forms (the biggest part, for job numbers, demo types and older
  // loans' account managers), the team, kits and retired items follow
  // without holding them up. extrasReady says when they're in.
  // Testing, dispatch and account managers (loanMeta) are kept twice: in
  // /data and at /loanMeta, which the old tracker writes first. Its loadData
  // lays /loanMeta over /data's copy, one loan at a time; so does this.
  const load = useCallback(async () => {
    await loadCutover() // where the data is (db.js): the old database, or Firestore after the cutover
    const extras = Promise.all([read('loanDocs'), readOld('accountManagers').catch(() => ({ data: [] })), read('kitGroups'), read('retired'), read('customDemoTypes'),
      read('testReports').catch(() => ({ data: {} }))]) // which loans have test reports (old: _testReportsKeys): their button shows it
    extras.catch(() => {}) // reported below, once the first part is showing
    try {
      const [data, upcoming, meta] = await Promise.all([read('data'), read('upcomingLoans'), read('loanMeta')])
      const d = data.data || {}
      version.current = d._v || null
      setState((s) => ({
        loanDocs: {}, managers: [], kits: {}, retired: [], extrasReady: false, ...s,
        ready: true, error: '',
        equipment: list(d.equipment), history: list(d.history), loanMeta: { ...(d.loanMeta || {}), ...(meta.data || {}) },
        upcoming: list(upcoming.data), loadedAt: Date.now(), cutover: cutover(),
      }))
    } catch (e) {
      return setState((s) => ({ ...s, error: e.message || String(e) }))
    }
    try {
      const [loanDocs, managers, kits, retired, demoTypes, reports] = await extras
      setState((s) => ({ ...s, loanDocs: loanDocs.data || {}, managers: list(managers.data), kits: kits.data || {}, retired: list(retired.data),
        demoTypes: Array.isArray(demoTypes.data) ? demoTypes.data.filter(Boolean) : [], reportKeys: Object.keys(reports.data || {}), extrasReady: true }))
    } catch (e) {
      setState((s) => ({ ...s, error: 'The loan forms didn’t load: ' + (e.message || e) }))
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Someone saved (here or in the old tracker): the version marker moves, so
  // read everything again, as the old tracker's syncFromFirebase does.
  useEffect(() => watch('data/_v', (v) => {
    if (v && version.current && v !== version.current) load()
  }), [load])

  // The cutover switch moved (an admin, in Manage): a new source means a fresh
  // start on it; read-only just shows (and blocks saves, in db.js).
  useEffect(() => watchCutover((c) => {
    setState((s) => {
      if (s.cutover && s.cutover.source !== c.source) setTimeout(() => location.reload(), 0)
      return { ...s, cutover: c }
    })
  }), [])

  /** Moves data/_v so other open trackers reload (old: bumpRemoteVersion). If
   *  nothing else changed since we loaded, this one needn't reload as well. */
  const touch = useCallback(async () => {
    if (onFirestore()) return // Firestore's listeners tell everyone open
    const { data: was } = await read('data/_v')
    const v = Date.now().toString()
    await write('data/_v', v)
    if (was === version.current) version.current = v
  }, [])

  /**
   * Changes equipment and history: reads /data with its ETag, makes the
   * change on what's there now (so nobody else's change is lost), and writes
   * the whole document only if nothing changed in between, else tries again,
   * up to five times. The old tracker's saveBin merges its own copy instead;
   * the effect is the same, and neither overwrites the other. If the ETag
   * can't be had, nothing is written.
   */
  const updateData = useCallback(async (change) => {
    if (cutover().readOnly) throw new Error('The demo tracker is read-only for a few minutes while its data moves. Try again shortly.')
    // On Firestore: the change run on the state as it is, only the documents it touches written, in one transaction (db-firestore.js).
    if (onFirestore()) {
      const next = await fsCommit((s) => { const r = change({ equipment: s.equipment, history: s.history }); return { equipment: r.equipment, history: r.history } })
      setState((s) => ({ ...s, equipment: next.equipment, history: next.history }))
      return
    }
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { data: remote, etag } = await read('data', { etag: true })
      if (!etag) throw new Error('Could not check for other changes, so nothing was saved. Try again.')
      const cur = remote || {}
      const next = change({ equipment: list(cur.equipment), history: list(cur.history) })
      const v = Date.now().toString()
      const res = await write('data', { ...cur, equipment: next.equipment, history: next.history, _v: v }, { etag })
      if (res.conflict) continue
      version.current = v
      setState((s) => ({ ...s, equipment: next.equipment, history: next.history }))
      return
    }
    throw new Error('Too many changes at once from other people: nothing was saved. Try again.')
  }, [])

  // Who's making changes: their name on the tracker's team, else their sign-in name.
  const team = useMemo(() => teamFrom(state.managers || [], people.users), [state.managers, people.users])
  const me = memberFor(user, team)
  const operator = me?.name || user?.displayName || user?.email || ''

  /** An audit log entry, as the old writeAudit (source 'hub': the old log shows it as Desktop). */
  const audit = useCallback(async (type, summary, detail, op = operator) => {
    const entry = { id: newId(), ts: nzNow(), type, summary, detail: detail || {}, operator: op, source: 'hub' }
    try { await write('auditLog/' + enc(entry.id), entry) } catch (e) { console.warn('[equipment] audit entry not saved', e) }
    logActivity(user, summary, { app: 'equipment' }) // the hub's own log (shared/activity.js), alongside the tracker's
  }, [operator, user])

  /** activateBookings' changes, saved to /upcomingLoans and shown. */
  const applyBookingChanges = useCallback(async (changes) => {
    for (const c of changes) {
      if (c.remove) await write('upcomingLoans/' + enc(c.id), null, { method: 'DELETE' })
      else if (c.entry) await write('upcomingLoans/' + enc(c.id), c.entry)
      else await write(`upcomingLoans/${enc(c.id)}/items`, c.items)
    }
    if (!changes.length) return
    setState((s) => {
      const up = s.upcoming.flatMap((u) => { const c = changes.find((x) => x.id === u.id); return !c ? [u] : c.remove ? [] : [{ ...u, items: c.items }] })
      for (const c of changes) if (c.entry && !up.some((u) => u.id === c.id)) up.push(c.entry)
      return { ...s, upcoming: up }
    })
  }, [])

  // Bookings whose start has come try to start whenever the data loads, as
  // the old tracker's loadData did (activateUpcomingLoans). Otherwise they
  // only got the chance when something was returned, counted or edited, and
  // one waiting on devices that never left (a loan not started yet) never
  // did. Tried on the copy in hand first, so an ordinary load writes nothing.
  const starting = useRef(false)
  useEffect(() => {
    const s = latest.current
    if (!s.ready || !user || starting.current) return
    const today = nzDate()
    if (!activateBookings(s.equipment || [], [], s.upcoming || [], { today, loanMeta: s.loanMeta || {} }).changes.length) return
    starting.current = true
    ;(async () => {
      const ts = nzNow()
      let a = null
      await updateData((d) => { a = activateBookings(d.equipment, d.history, latest.current.upcoming || [], { today, ts, loanMeta: latest.current.loanMeta || {} }); return { equipment: a.equipment, history: a.history } })
      await applyBookingChanges(a.changes)
      for (const [type, summary, detail, op] of a.audits) await audit(type, summary, detail, op)
      await touch()
    })().catch((e) => console.warn('[equipment] due bookings not started', e)).finally(() => { starting.current = false })
  }, [state.loadedAt, state.ready, user, updateData, applyBookingChanges, audit, touch])

  /** Tested / dispatched / no test required, on or off (old: toggleReadiness, confirmReadinessDate). */
  const setReadiness = useCallback(async (g, field, on, at) => {
    const key = readinessKey(g)
    const path = 'loanMeta/' + enc(key)
    // The stored entry as it is now, so someone else's change to the same loan isn't undone.
    const { data: stored } = await read(path)
    const next = withReadiness(stored || latest.current.loanMeta?.[key], field, on, at)
    await write(path, next)
    setState((s) => ({ ...s, loanMeta: { ...s.loanMeta, [key]: next } }))
    await touch()
  }, [touch])

  /**
   * Extend (old: confirmExtendLoan, confirmExtendLoanByKey's booking branch).
   * A booking's end date is changed on the booking. A loan's devices get the
   * new date in /data; a form kept under the old key (no BatchID), which has
   * the end date in it, moves to the new key first, keeping its Simpro job;
   * and the due-soon reminder already sent for the old date is cleared.
   */
  const extendLoan = useCallback(async (g, newDate) => {
    const was = g.endDate // not "oldDate": that's the date function the audit line below needs
    if (g.kind === 'booking') {
      await write(`upcomingLoans/${enc(g.batchId)}/endDate`, newDate)
      setState((s) => ({ ...s, upcoming: s.upcoming.map((u) => (u.id === g.batchId ? { ...u, endDate: newDate } : u)) }))
    } else {
      const from = loanDocKey(g, was), to = loanDocKey(g, newDate)
      if (from !== to) {
        try {
          const { data: doc } = await read('loanDocs/' + enc(from))
          if (doc) {
            await write('loanDocs/' + enc(to), { ...doc, endDate: newDate })
            await write('loanDocs/' + enc(from), null, { method: 'DELETE' })
            setState((s) => { const docs = { ...s.loanDocs, [to]: { ...doc, endDate: newDate } }; delete docs[from]; return { ...s, loanDocs: docs } })
          }
        } catch (e) { console.warn('[equipment] loan form not moved to the new end date', e) }
      }
      await updateData((d) => ({ ...d, equipment: extendEquipment(d.equipment, g, newDate) }))
      try { await write('returnDueSoonReminders/' + enc(g.loanTo + '|||' + was), null, { method: 'DELETE' }) } catch { /* best effort, as the old one */ }
    }
    const items = (g.kind === 'booking' ? g.pending : g.items).map((e) => e.CHSAssetNo)
    await audit('loan_extended', `${g.kind === 'booking' ? 'Upcoming loan' : 'Loan'} for ${g.loanTo} extended from ${oldDate(was)} to ${oldDate(newDate)}`,
      { loanTo: g.loanTo, oldDate: was, newDate, items })
    await touch()
  }, [audit, touch, updateData])

  /** Tells Simpro, through the proxy, with the hub sign-in (old: proxyFetch). Not in test mode or the dev server. */
  const simpro = useCallback(async (body) => {
    if (isLocal || readTestMode()) { console.info('[equipment] Simpro not told here:', body.close ? 'close' : 'update', body.jobId); return false }
    try {
      const idToken = await auth?.currentUser?.getIdToken()
      await fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, mode: 'no-cors', body: JSON.stringify({ ...body, idToken }) })
      return true
    } catch (e) { console.warn('[equipment] Simpro not reached', e); return false }
  }, [])

  /**
   * Closes a loan's Simpro job with a closing note (old: _closeSimproJobWithNote
   * then closeSimproJob): the job's notes get the note added and its items
   * set (none for a return, the devices for a long-term loan), then it's
   * closed. Resolves to the job number, or null if it has none.
   */
  const closeJob = useCallback(async (key, loanTo, note, items = []) => {
    let doc = null
    try { doc = (await read('loanDocs/' + enc(key))).data } catch { /* none */ }
    const jobId = jobNumber(doc?.simproJobId)
    if (!jobId) return null
    const s = latest.current
    await simpro({
      loanTo: loanTo || '', location: doc.location || '', notes: (doc.notesCell ? doc.notesCell + '\n\n' : '') + note,
      shippingDetails: doc.authCell || '', startDate: toISO(doc.startDate || ''), endDate: toISO(doc.endDate || ''),
      accountManager: loanAM({ batchId: key, loanTo, endDate: doc.endDate || '' }, { loanMeta: s.loanMeta, loanDocs: s.loanDocs }),
      contactNumber: doc.contactNumber || '', jobType: doc.jobType || 'Demo',
      items: items.map((e) => ({ CHSAssetNo: e.CHSAssetNo || '', Description: e.Description || e.Model || '', SerialNo: e.SerialNo || e.PartNo || '' })),
      jobId, pdfKey: key,
    })
    if (await simpro({ jobId, close: true })) await audit('simpro_closed', `Simpro job #${jobId} closed${loanTo ? ' — ' + loanTo : ''}`, { loanTo: loanTo || '', jobId })
    return jobId
  }, [simpro, audit])

  /** One loan's stored loanMeta entry changed, keeping whatever else is in it (as setReadiness). */
  const patchMeta = useCallback(async (rawKey, patch) => {
    // A key can't hold . # $ [ ] / (old: saveLoanMeta's _safeMeta): an old loan's customer name with a dot would fail the write.
    const key = metaKey(rawKey)
    const path = 'loanMeta/' + enc(key)
    const { data: stored } = await read(path)
    const next = { ...(stored || latest.current.loanMeta?.[key] || {}), ...patch }
    await write(path, next)
    setState((s) => ({ ...s, loanMeta: { ...s.loanMeta, [key]: next } }))
  }, [])

  /**
   * Return items (old: confirmBatchReturn). The devices are cleared in /data
   * and any booking now able to start takes the ones it was waiting on, in
   * the same save (activateBookings). Then: bookings updated, a loan with
   * nothing left out has its Simpro job closed and its form removed, one with
   * devices still out has the returned ones taken off its form.
   */
  const returnItems = useCallback(async (g, ids) => {
    const today = nzDate(), ts = nzNow()
    let res = null
    await updateData((d) => {
      const r = returnEquipment(d.equipment, d.history, ids, { today, ts, operator })
      if (!r.returned.length) throw new Error('Those devices are already back.')
      const a = activateBookings(r.equipment, r.history, latest.current.upcoming || [], { today, ts, loanMeta: latest.current.loanMeta })
      res = { r, a }
      return { equipment: a.equipment, history: a.history }
    })
    const { r, a } = res
    await applyBookingChanges(a.changes)
    const { close, prune } = returnFollowUps(r.equipment, r.returned)
    for (const c of close) {
      await closeJob(c.key, c.loanTo, `All items returned to office on ${oldDate(today)}.`)
      try { await write('loanDocs/' + enc(c.key), null, { method: 'DELETE' }) } catch { /* the old one doesn't mind either */ }
    }
    for (const p of prune) {
      try {
        const { data: doc } = await read('loanDocs/' + enc(p.key))
        if (!doc) continue
        const gone = new Set(p.assetNos.map((x) => String(x || '').trim().toLowerCase()))
        const keep = (no) => !gone.has(String(no || '').trim().toLowerCase())
        const patch = {}
        if (Array.isArray(doc.savedRows)) patch.savedRows = doc.savedRows.filter((row) => keep(row[0]))
        if (Array.isArray(doc.items)) patch.items = doc.items.filter((i) => keep(i.CHSAssetNo))
        if (Object.keys(patch).length) await write('loanDocs/' + enc(p.key), patch, { method: 'PATCH' })
      } catch { /* as the old one: the form is tidied next time */ }
    }
    if (close.length) setState((s) => { const docs = { ...s.loanDocs }; close.forEach((c) => delete docs[c.key]); return { ...s, loanDocs: docs } })
    for (const [type, summary, detail, op] of a.audits) await audit(type, summary, detail, op)
    const n = r.returned.length
    await audit('items_returned', `${n} item${n !== 1 ? 's' : ''} returned${g.loanTo ? ' from ' + g.loanTo : ''}`, { loanTo: g.loanTo || '', items: r.returned.map((x) => x.CHSAssetNo) })
    await touch()
    return { returned: n, started: a.changes.length }
  }, [audit, closeJob, operator, touch, updateData])

  /**
   * Make long-term (old: convertLoanToLongTerm). A loan from before BatchIDs
   * gets one first (its form moved across, a Converted entry per device). Its
   * Simpro job is closed with the devices still listed; loanMeta and the form
   * say long term; the old due-soon reminder is cleared; the devices lose
   * their end date.
   */
  const makeLongTerm = useCallback(async (g) => {
    const today = nzDate(), ts = nzNow()
    const adopt = !g.batchId
    const batchId = g.batchId || newBatchId(readTestMode())
    if (adopt) {
      const from = legacyLoanDocKey(g.loanTo, g.endDate)
      try {
        const { data: doc } = await read('loanDocs/' + enc(from))
        if (doc) { await write('loanDocs/' + enc(batchId), doc); await write('loanDocs/' + enc(from), null, { method: 'DELETE' }) }
      } catch (e) { console.warn('[equipment] loan form not moved to its new BatchID', e) }
    }
    let closed = null
    try {
      closed = await closeJob(batchId, g.loanTo, `Converted to a long-term loan on ${oldDate(today)} — equipment remains with ${g.am || g.loanTo}. Closing this job; no return date.`, g.items)
    } catch (e) { console.warn('[equipment] Simpro job not closed', e) }
    await patchMeta(batchId, { longTerm: true })
    try {
      await write('loanDocs/' + enc(batchId), { loanTo: g.loanTo, location: g.location || '', longTerm: true, endDate: '', ...(closed ? { simproClosedAt: nzNow() } : {}) }, { method: 'PATCH' })
    } catch (e) { console.warn('[equipment] loan form not marked long term', e) }
    if (g.endDate) { try { await write('returnDueSoonReminders/' + enc(g.loanTo + '|||' + g.endDate), null, { method: 'DELETE' }) } catch { /* best effort */ } }
    const ids = new Set(g.items.map((e) => e.id))
    await updateData((d) => ({
      equipment: d.equipment.map((e) => (e && ids.has(e.id) ? { ...e, LoanEndDate: '', ...(adopt ? { BatchID: batchId } : {}) } : e)),
      history: adopt
        ? [...g.items.map((e) => ({ operator, id: newId(), ts, chsAssetNo: e.CHSAssetNo, model: e.Model, action: 'Converted', loanTo: g.loanTo, location: g.location || '', batchId,
            notes: `${g.loanTo}’s loan adopted into BatchID tracking (predates it) as part of converting to long-term.` })).reverse(), ...d.history]
        : d.history,
    }))
    setState((s) => ({ ...s, loanDocs: { ...s.loanDocs, [batchId]: { ...(s.loanDocs[batchId] || {}), longTerm: true, ...(closed ? { simproClosedAt: nzNow() } : {}) } } }))
    const n = g.items.length
    await audit('loan_longterm_on', `${g.loanTo}’s loan converted to long-term${n ? ` — ${n} item${n !== 1 ? 's' : ''}` : ''}`, { loanTo: g.loanTo, batchId, items: g.items.map((e) => e.CHSAssetNo) })
    await touch()
    return { batchId, closed }
  }, [audit, closeJob, operator, patchMeta, touch, updateData])

  /** Return to active (old: confirmLongTermToActive): an end date again; its closed Simpro job stays closed, on record. */
  const returnToActive = useCallback(async (g, newDate) => {
    if (!g.batchId) throw new Error('This loan has no BatchID, so it can’t be changed. Make it long term again (which gives it one), then try again.')
    await patchMeta(g.batchId, { longTerm: false })
    try { await write('loanDocs/' + enc(g.batchId), { longTerm: false, endDate: newDate }, { method: 'PATCH' }) } catch (e) { console.warn('[equipment] loan form not updated', e) }
    await updateData((d) => ({ ...d, equipment: extendEquipment(d.equipment, g, newDate) }))
    setState((s) => ({ ...s, loanDocs: { ...s.loanDocs, [g.batchId]: { ...(s.loanDocs[g.batchId] || {}), longTerm: false, endDate: newDate } } }))
    await audit('loan_longterm_off', `${g.loanTo}’s long-term loan returned to Active, due ${oldDate(newDate)}`, { loanTo: g.loanTo, batchId: g.batchId, newDate, items: g.items.map((e) => e.CHSAssetNo) })
    await touch()
  }, [audit, patchMeta, touch, updateData])


  /** A demo type typed in that isn't on the list yet joins it (old: addCustomDemoTypeIfNew). */
  const addDemoType = useCallback(async (t) => {
    const v = String(t || '').trim()
    const known = latest.current.demoTypes || []
    if (!v || DEMO_TYPES.includes(v) || known.includes(v)) return
    const next = [...known, v]
    try { await write('customDemoTypes', next); setState((s) => ({ ...s, demoTypes: next })) } catch (e) { console.warn('[equipment] demo type not added to the list', e) }
  }, [])

  /**
   * Edit (old: confirmReassignAM in edit mode). A blank field keeps what it
   * had. A booking is changed on the booking, and if its start has now come
   * it takes any devices that are free (as the old one). A loan's devices
   * are changed in /data. A new account manager goes in loanMeta; contact,
   * notes, shipping and demo type go on the loan form.
   */
  const editLoan = useCallback(async (g, f) => {
    const today = nzDate(), ts = nzNow()
    const docKey = g.kind === 'booking' ? g.batchId : loanDocKey(g)
    let started = null
    if (g.kind === 'booking') {
      const u = latest.current.upcoming.find((x) => x.id === g.batchId)
      if (!u) throw new Error('That booking has gone: someone may have changed it. Reload and try again.')
      const next = editBooking(u, f)
      await write('upcomingLoans/' + enc(u.id), next)
      setState((s) => ({ ...s, upcoming: s.upcoming.map((x) => (x.id === u.id ? next : x)) }))
      if (next.startDate && next.startDate <= today) {
        let a = null
        // All the bookings, not just this one: a loan it takes a device from
        // keeps its claim on its own booking, which has to be found to be kept.
        const all = latest.current.upcoming.map((x) => (x.id === u.id ? next : x))
        await updateData((d) => { a = activateBookings(d.equipment, d.history, all, { today, ts, only: u.id, loanMeta: latest.current.loanMeta }); return { equipment: a.equipment, history: a.history } })
        await applyBookingChanges(a.changes)
        for (const [type, summary, detail, op] of a.audits) await audit(type, summary, detail, op)
        const own = a.changes.find((c) => c.id === u.id)
        started = own ? (own.remove ? 'all' : 'some') : 'none'
      }
    } else {
      await updateData((d) => ({ ...d, equipment: editEquipment(d.equipment, g, f) }))
      if (f.am) for (const k of [...new Set([g.batchId, docKey].filter(Boolean))]) await patchMeta(k, { accountManager: f.am })
    }
    if (docKey) {
      const patch = { contactNumber: f.contact || '', notesCell: f.notes || '', authCell: f.shipping || '', demoType: f.demoType || '', ...(f.am ? { accountManager: f.am } : {}) }
      try {
        await write('loanDocs/' + enc(docKey), patch, { method: 'PATCH' })
        setState((s) => ({ ...s, loanDocs: { ...s.loanDocs, [docKey]: { ...(s.loanDocs[docKey] || {}), ...patch } } }))
      } catch (e) { console.warn('[equipment] loan form not updated', e) }
    }
    if (f.demoType) await addDemoType(f.demoType)
    await audit('loan_edited', `${g.kind === 'booking' ? 'Upcoming loan' : 'Loan'} for ${f.loanTo || g.loanTo} edited`, { loanTo: f.loanTo || g.loanTo, batchId: g.batchId || '' })
    await touch()
    return { started }
  }, [addDemoType, audit, patchMeta, touch, updateData])

  /**
   * Delete, after the admin password (old: _performDeleteLoan,
   * deleteScheduledLoanByKey, deleteUpcomingLoanPrompt). A loan's devices are
   * cleared as returned, each with a Return entry saying an admin deleted it,
   * and its form removed; a booking is removed (nothing was out).
   */
  const deleteLoan = useCallback(async (g) => {
    const n = g.kind === 'booking' ? g.pending.length : g.items.length
    if (g.kind === 'booking') {
      await updateData((d) => ({ ...d, equipment: d.equipment.map((e) => (e && e._upcomingLoanId === g.batchId ? { ...e, _upcomingLoanId: null } : e)) }))
      await write('upcomingLoans/' + enc(g.batchId), null, { method: 'DELETE' })
      setState((s) => ({ ...s, upcoming: s.upcoming.filter((u) => u.id !== g.batchId) }))
      await audit('upcoming_loan_deleted', `Upcoming loan for ${g.loanTo} cancelled — ${n} item${n !== 1 ? 's' : ''} cleared`, { loanTo: g.loanTo, items: g.pending.map((i) => i.CHSAssetNo) })
    } else {
      const ts = nzNow()
      await updateData((d) => deleteLoanEquipment(d.equipment, d.history, g, { ts, operator }))
      const batchIds = [...new Set(g.items.map((e) => e.BatchID).filter(Boolean))]
      for (const b of batchIds) { try { await write('loanDocs/' + enc(b), null, { method: 'DELETE' }) } catch { /* as the old one */ } }
      setState((s) => { const docs = { ...s.loanDocs }; batchIds.forEach((b) => delete docs[b]); return { ...s, loanDocs: docs } })
      const scheduled = g.kind === 'scheduled'
      await audit(scheduled ? 'scheduled_deleted' : 'loan_deleted',
        `${scheduled ? 'Scheduled loan' : 'Loan'} for ${g.loanTo} deleted — ${n} item${n !== 1 ? 's' : ''} ${scheduled ? 'cleared' : 'marked as returned'}`,
        { loanTo: g.loanTo, items: g.items.map((e) => e.CHSAssetNo) })
    }
    await touch()
  }, [audit, operator, touch, updateData])

  /** Bookings changed by a plan written back, and the list here updated. */
  const saveBookings = useCallback(async (nextList, ids) => {
    for (const id of ids) {
      const u = nextList.find((x) => x.id === id)
      await write('upcomingLoans/' + enc(id), u && (u.items || []).length ? u : null, u && (u.items || []).length ? {} : { method: 'DELETE' })
    }
    if (ids.length) setState((s) => ({ ...s, upcoming: nextList.filter((u) => (u.items || []).length) }))
  }, [])

  /**
   * A loan's Simpro job made or brought up to date (old: _submitSimproJob).
   * One being made already (the "pending" marker the old one leaves) is left
   * alone. A new one is made only while job creation is on (Settings, its
   * /simproConfig switch) unless allowCreate. In test mode and the dev server
   * the job number is made up (TEST-…), as the old one does. A new job's
   * number is written to the form by the proxy; this watches for it.
   */
  const submitJob = useCallback(async (key, data, { allowCreate = false } = {}) => {
    let jobId = null
    try { jobId = (await read(`loanDocs/${enc(key)}/simproJobId`)).data } catch { /* none */ }
    if (jobId === 'pending' || (jobId && typeof jobId === 'object')) return { skipped: 'being made' }
    const isNew = !jobId
    if (isNew && !allowCreate) {
      const { data: cfg } = await read('simproConfig')
      if (!(cfg && cfg.createJobs === true)) return { skipped: 'creation off' }
    }
    const label = data.loanTo || ''
    if (isLocal || readTestMode()) {
      // A made-up number for a new job only. (The old one also put one over a
      // real job's number on an update in test mode, losing the real one.)
      const fake = isNew ? 'TEST-' + (100000 + Math.floor(Math.random() * 900000)) : jobId
      if (isNew) {
        await write(`loanDocs/${enc(key)}/simproJobId`, fake)
        setState((s) => ({ ...s, loanDocs: { ...s.loanDocs, [key]: { ...(s.loanDocs[key] || {}), simproJobId: fake } } }))
      }
      await audit(isNew ? 'simpro_created' : 'simpro_updated', `Simpro job ${fake} ${isNew ? 'created' : 'updated'} (TEST MODE) — ${label}`, { loanTo: label, jobId: fake, pdfKey: key })
      return { jobId: fake, created: isNew, test: true }
    }
    if (isNew) await write(`loanDocs/${enc(key)}/simproJobId`, { status: 'pending', ts: Date.now() })
    await simpro({
      loanTo: data.loanTo || '', location: data.location || '', notes: data.notes || '', shippingDetails: data.shippingDetails || '',
      startDate: toISO(data.startDate || ''), endDate: toISO(data.endDate || ''), accountManager: data.accountManager || '', contactNumber: data.contactNumber || '',
      jobType: data.jobType || 'Demo', items: data.items || [], jobId: isNew ? null : jobNumber(jobId), pdfKey: key, allowCreate,
    })
    if (!isNew) {
      await audit('simpro_updated', `Simpro job #${jobNumber(jobId)} updated — ${label}`, { loanTo: label, jobId: jobNumber(jobId), pdfKey: key })
      return { jobId: jobNumber(jobId), created: false }
    }
    // The proxy writes the new number to the form: look for it for 15 seconds, as the old one does.
    ;(async () => {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        try {
          const n = jobNumber((await read(`loanDocs/${enc(key)}/simproJobId`)).data)
          if (n) {
            setState((s) => ({ ...s, loanDocs: { ...s.loanDocs, [key]: { ...(s.loanDocs[key] || {}), simproJobId: n } } }))
            await audit('simpro_created', `Simpro job #${n} created — ${label}`, { loanTo: label, jobId: n, pdfKey: key })
            return
          }
        } catch { /* try again */ }
      }
      await audit('simpro_created', `Simpro job created — ${label} (ID pending)`, { loanTo: label, pdfKey: key })
    })()
    return { created: true, pending: true }
  }, [audit, simpro])

  /**
   * The loan form saved (old: saveLoanDocChanges): the whole form document,
   * keeping what the form doesn't show (formDoc); the devices still on this
   * loan get any changed customer, place or dates; a changed account manager
   * goes in loanMeta; a booking's own details follow. Then, unless told not
   * to, its Simpro job is brought up to date (or made, if creation is on),
   * never for a long-term loan.
   */
  const saveForm = useCallback(async (key, form, info = {}, { simproToo = true } = {}) => {
    const { data: stored } = await read('loanDocs/' + enc(key))
    const doc = formDoc(form, stored || {}, info)
    await write('loanDocs/' + enc(key), doc)
    setState((s) => ({ ...s, loanDocs: { ...s.loanDocs, [key]: doc } }))
    const mine = (e) => e && (form.items || []).some((i) => i.id === e.id || i.CHSAssetNo === e.CHSAssetNo) && (!e.BatchID || e.BatchID === key)
    const set = {
      ...(form.loanTo ? { OnLoanTo: form.loanTo } : {}), ...(form.location ? { Location: form.location } : {}),
      ...(form.startDate ? { LoanStartDate: toISO(form.startDate) } : {}), ...(form.endDate && !doc.longTerm ? { LoanEndDate: toISO(form.endDate) } : {}),
    }
    const differs = (latest.current.equipment || []).some((e) => mine(e) && Object.entries(set).some(([k, v]) => e[k] !== v))
    if (differs) await updateData((d) => ({ ...d, equipment: d.equipment.map((e) => (mine(e) ? { ...e, ...set } : e)) }))
    const batch = form.items?.[0]?.BatchID || (latest.current.equipment || []).find(mine)?.BatchID
    if (form.accountManager && batch && latest.current.loanMeta?.[batch]?.accountManager !== form.accountManager) await patchMeta(batch, { accountManager: form.accountManager })
    const u = (latest.current.upcoming || []).find((x) => x.id === key)
    if (u) {
      const patch = { loanTo: form.loanTo || u.loanTo, location: form.location || u.location, startDate: toISO(form.startDate) || u.startDate, endDate: toISO(form.endDate) || u.endDate, accountManager: form.accountManager || u.accountManager }
      await write('upcomingLoans/' + enc(key), patch, { method: 'PATCH' })
      setState((s) => ({ ...s, upcoming: s.upcoming.map((x) => (x.id === key ? { ...x, ...patch } : x)) }))
    }
    let job = null
    if (simproToo && !doc.longTerm) {
      try {
        job = await submitJob(key, { ...doc, notes: doc.notesCell, shippingDetails: doc.authCell, items: doc.savedRows.map((r) => ({ CHSAssetNo: r[0], Model: r[1], Description: r[2], SerialNo: r[3] })) })
      } catch (e) { console.warn('[equipment] Simpro not updated', e) }
    }
    await touch()
    return { doc, job }
  }, [patchMeta, submitJob, touch, updateData])

  /**
   * The loan form emailed to the account manager (old: sendLoanDocEmail and
   * sendLoanConfirmationEmail), through EmailJS with the old tracker's
   * template and public key. Not sent in test mode or the dev server.
   */
  const emailForm = useCallback(async (form, to, name) => {
    if (!to) throw new Error('There’s no email address to send it to.')
    if (isLocal || readTestMode()) { console.info('[equipment] loan form email not sent here (test mode or dev):', to); return { simulated: true } }
    const token = btoa(encodeURIComponent(form.loanTo + '|||' + (form.endDate || ''))).replace(/=/g, '')
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS.service, template_id: EMAILJS.template, user_id: EMAILJS.key,
        template_params: {
          to_email: to, to_name: name || to, customer_name: form.loanTo || '', customer_location: form.location || '',
          loan_start: oldDate(form.startDate || nzDate()), loan_end: form.longTerm ? 'Long term — no end date' : oldDate(form.endDate || ''),
          loan_form_html: loanFormHtml(form),
          manage_link: 'https://internal.chsnz.co.nz/equipment/#/loans',
          return_link: 'https://internal.chsnz.co.nz/equipment/?return=' + token,
          extend_link: 'https://internal.chsnz.co.nz/equipment/?extend=' + token,
        },
      }),
    })
    if (!res.ok) throw new Error('The email didn’t go: ' + ((await res.text()) || res.status))
    return { sent: true }
  }, [])

  /**
   * A new loan (old: submitBatchLoan / doLoan). Refused if one to the same
   * customer, place and end date exists (add to that instead). Devices go on
   * it or are booked on it (planNewLoan); its account manager and long term
   * go in loanMeta; its loan form is written. If it took devices from
   * another loan ("move to a new loan"), that loan's form and Simpro job lose
   * them. The form is then opened to finish it (LoanForm.jsx): saving it,
   * the email and the Simpro job happen there, as in the old one.
   */
  const createLoan = useCallback(async (f, assetNos, { from = null } = {}) => {
    const today = nzDate(), ts = nzNow(), testMode = readTestMode()
    if (!f.longTerm) {
      const [eqd, upd] = await Promise.all([read('data/equipment'), read('upcomingLoans')])
      if (existingLoanMatch(list(eqd.data), list(upd.data), f, testMode)) {
        throw new Error(`A loan to ${f.loanTo} at ${f.location}, ending ${fmtDate(f.endDate)}, already exists. Open it in Loans and use Add items instead: a second loan with the same details would mix up their forms.`)
      }
    }
    const batchId = newBatchId(testMode)
    let plan = null
    await updateData((d) => {
      plan = planNewLoan({ equipment: d.equipment, history: d.history, upcoming: latest.current.upcoming || [], loanMeta: latest.current.loanMeta || {} }, f, assetNos, { batchId, today, ts, operator })
      if (!plan.loaned.length) throw new Error(plan.skipped.length ? 'Every one of those devices is out on a loan whose dates clash.' : 'None of those asset numbers were found.')
      return { equipment: plan.equipment, history: plan.history }
    })
    await saveBookings(plan.upcoming, plan.changed)
    await patchMeta(batchId, { accountManager: f.am, longTerm: !!f.longTerm })
    const items = plan.loaned.map((e) => ({ CHSAssetNo: e.CHSAssetNo, Model: e.Model, Description: e.Description, SerialNo: e.SerialNo }))
    const doc = { loanTo: f.loanTo, location: f.location, startDate: f.startDate, endDate: f.longTerm ? '' : f.endDate, accountManager: f.am, contactNumber: f.contact || '',
      jobType: f.jobType || 'Demo', demoType: f.demoType || '', island: f.island || '', longTerm: !!f.longTerm, notes: f.notes || '', notesCell: f.notes || '', authCell: f.shipping || '', items }
    try { await write('loanDocs/' + enc(batchId), doc); setState((s) => ({ ...s, loanDocs: { ...s.loanDocs, [batchId]: doc } })) } catch (e) { console.warn('[equipment] loan form not saved', e) }
    if (f.demoType) await addDemoType(f.demoType)
    const n = plan.loaned.length
    await audit('loan_created', `${n} item${n !== 1 ? 's' : ''} loaned to ${f.loanTo}${f.location ? ' — ' + f.location : ''}`,
      { loanTo: f.loanTo, location: f.location, startDate: f.startDate, endDate: f.longTerm ? '' : f.endDate, batchId, items: plan.loaned.map((e) => e.CHSAssetNo) })
    if (from) {
      const taken = new Set(plan.loaned.map((e) => e.CHSAssetNo))
      try {
        const { data: src } = await read('loanDocs/' + enc(from.key))
        if (src?.savedRows) await write(`loanDocs/${enc(from.key)}/savedRows`, rowsWithout(src.savedRows, taken))
        const jobId = jobNumber(src?.simproJobId)
        const remaining = (from.items || []).filter((e) => !taken.has(e.CHSAssetNo))
        if (jobId && remaining.length) {
          const s = latest.current
          await simpro({ loanTo: from.loanTo, location: src.location || '', startDate: toISO(src.startDate || ''), endDate: toISO(src.endDate || ''),
            accountManager: loanAM({ batchId: from.key, loanTo: from.loanTo, endDate: src.endDate || '' }, { loanMeta: s.loanMeta, loanDocs: s.loanDocs }),
            notes: src.notesCell || '', shippingDetails: src.authCell || '', contactNumber: src.contactNumber || '', jobType: src.jobType || 'Demo',
            items: remaining.map((e) => ({ CHSAssetNo: e.CHSAssetNo, Description: e.Description || e.Model || '', SerialNo: e.SerialNo || '' })), jobId, pdfKey: from.key })
          await audit('simpro_updated', `Simpro job #${jobId} updated — items split to new loan for ${f.loanTo}`, { loanTo: from.loanTo, jobId, pdfKey: from.key })
        }
      } catch (e) { console.warn('[equipment] the loan they came from wasn’t tidied', e) }
    }
    await touch()
    return { batchId, loaned: plan.loaned, booked: plan.booked, skipped: plan.skipped, reclaimed: plan.reclaimed, doc }
  }, [addDemoType, audit, operator, patchMeta, saveBookings, simpro, touch, updateData])

  /**
   * Add items (old: _doAddItemsToLoan, _doAddItemsToUpcoming). To a booking:
   * on its waiting list. To a loan: planAddItems, then its loan form gets the
   * new devices (at the bottom of its rows, if it has rows) and is saved,
   * which brings its Simpro job up to date.
   */
  const addItems = useCallback(async (g, assetNos) => {
    const today = nzDate(), ts = nzNow()
    if (g.kind === 'booking') {
      // As the old basket did: the booking's own id, its email; added the same way as to a loan.
      const u = (latest.current.upcoming || []).find((x) => x.id === g.batchId)
      if (!u) throw new Error('That booking has gone. Reload and try again.')
      g = { ...g, items: [], email: u.borrowerEmail || '', am: g.am || u.accountManager || '' }
    }
    const batchId = g.batchId || newBatchId(readTestMode())
    let plan = null
    await updateData((d) => {
      plan = planAddItems({ equipment: d.equipment, history: d.history, upcoming: latest.current.upcoming || [], loanMeta: latest.current.loanMeta || {} }, g, assetNos, { batchId, today, ts, operator })
      if (!plan.added.length) throw new Error('Nothing new to add: they’re not found or already on it.')
      return { equipment: plan.equipment, history: plan.history }
    })
    await saveBookings(plan.upcoming, plan.changed)
    const n = plan.added.length
    await audit('items_added', `${n} item${n !== 1 ? 's' : ''} added to loan — ${g.loanTo}`, { loanTo: g.loanTo, location: g.location, batchId, items: plan.added.map((e) => e.CHSAssetNo) })
    // Its form: the devices now on it, the added ones at the bottom of its rows.
    const { data: doc } = await read('loanDocs/' + enc(batchId))
    const onIt = plan.equipment.filter((e) => e && e.BatchID === batchId && e.Returned !== 'Yes')
    const items = [...onIt.filter((e) => !plan.added.includes(e)), ...plan.added]
    const form = { loanTo: g.loanTo, location: g.location, startDate: g.startDate || today, endDate: g.endDate || '', accountManager: g.am || '', contactNumber: doc?.contactNumber || '',
      items, rows: rowsWithAdded(doc, plan.added) || formRows(null, items).filter((r) => r.some(Boolean)), notes: doc?.notesCell || doc?.notes || '', shipping: doc?.authCell || '' }
    try { await saveForm(batchId, form, { loanTo: g.loanTo, location: g.location, startDate: g.startDate || today, endDate: g.endDate || '', accountManager: g.am || '' }, { simproToo: !g.longTerm }) } catch (e) { console.warn('[equipment] loan form not updated', e) }
    await touch()
    return { added: plan.added, skipped: plan.skipped, reclaimed: plan.reclaimed, moved: plan.moved, booked: plan.booked, batchId }
  }, [audit, operator, saveBookings, saveForm, touch, updateData])

  /**
   * Transfer devices to another loan or booking (old: confirmReassignAM,
   * move). Each side's Simpro job gets a note saying what moved where and its
   * new device list; a loan left with nothing has its job closed. The source
   * form loses the moved rows.
   */
  const transfer = useCallback(async (g, nos, target) => {
    const ts = nzNow(), today = nzDate()
    const targetBatchId = target.kind === 'booking' ? target.batchId : (target.batchId || newBatchId(readTestMode()))
    const srcKey = loanDocKey(g)
    const [srcDoc, tgtDoc] = await Promise.all([read('loanDocs/' + enc(srcKey)).then((r) => r.data).catch(() => null), read('loanDocs/' + enc(targetBatchId)).then((r) => r.data).catch(() => null)])
    let plan = null
    await updateData((d) => {
      plan = planTransfer({ equipment: d.equipment, history: d.history }, g, nos, target, { targetBatchId, ts, operator })
      if (!plan.moved.length) throw new Error('Choose at least one device to move.')
      return { equipment: plan.equipment, history: plan.history }
    })
    const { moved, remaining } = plan
    const list = moved.map((e) => e.CHSAssetNo).join(', ')
    const n = moved.length, nItems = `${n} item${n !== 1 ? 's' : ''}`
    const add = (existing, note) => (existing ? existing + '\n\n' : '') + note
    const s = latest.current
    const srcJob = jobNumber(srcDoc?.simproJobId)
    if (srcJob) {
      await simpro({ loanTo: g.loanTo, location: g.location || '', startDate: toISO(g.startDate || ''), endDate: toISO(g.endDate || ''), accountManager: g.am || '',
        notes: add(srcDoc?.notesCell, `Transferred ${nItems} (${list}) to ${target.loanTo} on ${oldDate(today)}.`), shippingDetails: srcDoc?.authCell || '', contactNumber: srcDoc?.contactNumber || '',
        jobType: srcDoc?.jobType || 'Demo', items: remaining.map((e) => ({ CHSAssetNo: e.CHSAssetNo, Description: e.Description || e.Model || '', SerialNo: e.SerialNo || '' })), jobId: srcJob, pdfKey: srcKey })
      if (remaining.length) await audit('simpro_updated', `Simpro job #${srcJob} updated — items reassigned out`, { loanTo: g.loanTo, jobId: srcJob, pdfKey: srcKey })
      else if (await simpro({ jobId: srcJob, close: true })) await audit('simpro_closed', `Simpro job #${srcJob} closed — ${g.loanTo}`, { loanTo: g.loanTo, jobId: srcJob })
    }
    const tgtJob = jobNumber(tgtDoc?.simproJobId)
    if (tgtJob) {
      const tgtItems = [...(target.kind === 'booking' ? target.pending : target.items), ...moved]
      await simpro({ loanTo: target.loanTo, location: target.location || '', startDate: toISO(target.startDate || ''), endDate: toISO(target.endDate || ''),
        accountManager: target.am || loanAM(target, { loanMeta: s.loanMeta, loanDocs: s.loanDocs }), notes: add(tgtDoc?.notesCell, `Received ${nItems} (${list}) from ${g.loanTo} on ${oldDate(today)}.`),
        shippingDetails: tgtDoc?.authCell || '', contactNumber: tgtDoc?.contactNumber || '', jobType: 'Demo',
        items: tgtItems.map((e) => ({ CHSAssetNo: e.CHSAssetNo, Description: e.Description || e.Model || '', SerialNo: e.SerialNo || '' })), jobId: tgtJob, pdfKey: targetBatchId })
      await audit('simpro_updated', `Simpro job #${tgtJob} updated — items moved in from ${g.loanTo}`, { loanTo: target.loanTo, jobId: tgtJob, pdfKey: targetBatchId })
    }
    if (target.kind === 'booking') {
      const u = (s.upcoming || []).find((x) => x.id === target.batchId)
      if (u) {
        const left = rowsWithout((u.items || []).map((i) => [i.CHSAssetNo, i]), moved.map((e) => e.CHSAssetNo)).map((r) => r[1])
        await saveBookings(s.upcoming.map((x) => (x.id === u.id ? { ...u, items: left } : x)), [u.id])
      }
    }
    if (srcDoc?.savedRows) { try { await write(`loanDocs/${enc(srcKey)}/savedRows`, rowsWithout(srcDoc.savedRows, moved.map((e) => e.CHSAssetNo))) } catch { /* as the old one */ } }
    await audit('loan_reassigned', `${nItems} moved from ${g.loanTo} to ${target.loanTo}`, { from: g.loanTo, to: target.loanTo, items: moved.map((e) => e.CHSAssetNo) })
    await touch()
    return { moved: n }
  }, [audit, operator, saveBookings, simpro, touch, updateData])

  /**
   * Count an item (old: submitCount, submitCountKeepLoan). Counted and
   * returned: its loan cleared, any booking now able to start takes it (in
   * the same save), and a loan left with nothing out has its Simpro job
   * closed (its form kept, as the old count does); one with devices still out
   * has it taken off its form. Or counted where it is, kept on its loan.
   */
  const countItem = useCallback(async (id, { keepOnLoan = false } = {}) => {
    const today = nzDate(), ts = nzNow()
    let res = null
    await updateData((d) => {
      const c = countEquipment(d.equipment, d.history, id, { keepOnLoan, today, ts, operator })
      if (!c) throw new Error('That item isn’t in the equipment list any more.')
      const a = keepOnLoan ? { equipment: c.equipment, history: c.history, changes: [], audits: [] } : activateBookings(c.equipment, c.history, latest.current.upcoming || [], { today, ts, loanMeta: latest.current.loanMeta })
      res = { c, a }
      return { equipment: a.equipment, history: a.history }
    })
    const { c, a } = res
    await applyBookingChanges(a.changes)
    for (const [type, summary, detail, op] of a.audits) await audit(type, summary, detail, op)
    if (!keepOnLoan && c.was.out) {
      const { close, prune } = returnFollowUps(c.equipment, [c.was])
      for (const x of close) await closeJob(x.key, x.loanTo, `All items counted and returned to office on ${oldDate(today)}.`)
      for (const p of prune) {
        try {
          const { data: doc } = await read('loanDocs/' + enc(p.key))
          if (!doc) continue
          const patch = {}
          if (Array.isArray(doc.savedRows)) patch.savedRows = rowsWithout(doc.savedRows, p.assetNos)
          if (Array.isArray(doc.items)) patch.items = doc.items.filter((i) => !p.assetNos.some((n) => String(n).trim().toLowerCase() === String(i.CHSAssetNo || '').trim().toLowerCase()))
          if (Object.keys(patch).length) await write('loanDocs/' + enc(p.key), patch, { method: 'PATCH' })
        } catch { /* tidied next time */ }
      }
    }
    await touch()
    return { item: c.equipment.find((e) => e && e.id === id), was: c.was, started: a.changes.length }
  }, [audit, closeJob, operator, touch, updateData])

  /** An item added or edited (old: saveItem); refused if its asset number is already someone else's. */
  const saveItem = useCallback(async (obj, editingId = null) => {
    let r = null
    await updateData((d) => {
      const problem = itemProblem(d.equipment, obj, editingId)
      if (problem) throw new Error(problem)
      r = saveItemEquipment(d.equipment, d.history, obj, { editingId, ts: nzNow(), operator })
      return { equipment: r.equipment, history: r.history }
    })
    const no = String(obj.CHSAssetNo).trim()
    await audit(editingId ? 'asset_edited' : 'asset_added', `${no}${obj.Model ? ' — ' + obj.Model : ''} ${editingId ? 'updated in' : 'added to'} database`, { assetNo: no, model: obj.Model || '' })
    await touch()
  }, [audit, operator, touch, updateData])

  /** An item deleted for good, after the admin password (old: deleteItem). */
  const deleteItem = useCallback(async (id) => {
    let item = null
    await updateData((d) => { item = d.equipment.find((e) => e && e.id === id); if (!item) throw new Error('That item has already gone.'); return { ...d, equipment: d.equipment.filter((e) => e && e.id !== id) } })
    await audit('asset_deleted', `${item.CHSAssetNo}${item.Model ? ' — ' + item.Model : ''} permanently deleted from database`, { assetNo: item.CHSAssetNo, model: item.Model || '' })
    await touch()
  }, [audit, touch, updateData])

  /** Several ticked items deleted at once (old: deleteFromSelection), one audit entry listing them. */
  const deleteItems = useCallback(async (ids) => {
    const want = new Set(ids)
    let gone = []
    await updateData((d) => { gone = d.equipment.filter((e) => e && want.has(e.id)); if (!gone.length) throw new Error('Those items have already gone.'); return { ...d, equipment: d.equipment.filter((e) => e && !want.has(e.id)) } })
    await audit('asset_deleted', `${gone.length} assets permanently deleted from database`, { items: gone.map((i) => i.CHSAssetNo + (i.Model ? ' — ' + i.Model : '')) })
    await touch()
    return gone.length
  }, [audit, touch, updateData])

  /** The retired list changed: read fresh, changed, written whole (as the old saveRetiredAssets, which writes it whole). */
  const changeRetired = useCallback(async (fn) => {
    const { data } = await read('retired')
    const next = fn(list(data))
    await write('retired', next)
    setState((s) => ({ ...s, retired: next }))
  }, [])

  /** Retire an item (old: confirmRetire): off the equipment list, onto the retired list with why. */
  const retireItem = useCallback(async (id, { reason = '', notes = '' } = {}) => {
    let r = null
    await updateData((d) => { r = retireEquipment(d.equipment, id, { reason, notes, today: nzDate() }); return { ...d, equipment: r.equipment } })
    await changeRetired((l) => [r.retired, ...l])
    const it = r.retired
    await audit('asset_retired', `${it.CHSAssetNo || 'Item'}${it.Model ? ' — ' + it.Model : ''} retired${reason ? ` (${reason})` : ''}`, { assetNo: it.CHSAssetNo, model: it.Model, reason, notes })
    await touch()
  }, [audit, changeRetired, touch, updateData])

  /** Retired items back on the equipment list (old: restoreFromRetiredSelection). */
  const restoreItems = useCallback(async (ids) => {
    let back = []
    await changeRetired((l) => { const r = restoreRetired(l, ids); back = r.back; return r.retired })
    await updateData((d) => ({ ...d, equipment: [...back.filter((b) => !d.equipment.some((e) => e && e.id === b.id)), ...d.equipment] }))
    await touch()
    return back.length
  }, [changeRetired, touch, updateData])

  /** A retired item's why and notes changed (old: saveRetiredEdit). */
  const editRetired = useCallback(async (id, { reason = '', retiredNotes = '', notes = '' }) => {
    let it = null
    await changeRetired((l) => l.map((r) => (r.id === id ? (it = { ...r, RetiredReason: reason, RetiredNotes: retiredNotes.trim(), Notes: notes.trim() }) : r)))
    if (it) await audit('asset_edited', `${it.CHSAssetNo || 'Item'} — retired record updated`, { assetNo: it.CHSAssetNo, reason, retiredNotes: it.RetiredNotes })
    await touch()
  }, [audit, changeRetired, touch])

  /** A spreadsheet of sold / retired items (old: handleRetiredImport): added, or updated by asset number. */
  const importRetired = useCallback(async (rows) => {
    let r = null
    await changeRetired((l) => { r = importRetiredRows(l, rows, { today: nzDate() }); if (!r.added && !r.updated) throw new Error('No rows with an asset number or a model were found.'); return r.retired })
    await touch()
    return { added: r.added, updated: r.updated }
  }, [changeRetired, touch])

  /** Retired items deleted for good, after the admin password (old: deleteFromRetiredSelection). */
  const deleteRetired = useCallback(async (ids) => {
    let gone = []
    await changeRetired((l) => { gone = l.filter((r) => ids.includes(r.id)); return l.filter((r) => !ids.includes(r.id)) })
    for (const r of gone) await audit('retired_asset_deleted', `${r.CHSAssetNo}${r.Model ? ' — ' + r.Model : ''} permanently deleted from Sold / Retired`, { assetNo: r.CHSAssetNo })
    await touch()
    return gone.length
  }, [audit, changeRetired, touch])

  /** A spreadsheet imported (old: confirmImport): known asset numbers updated, new ones added. */
  const importItems = useCallback(async (rows) => {
    let r = null
    await updateData((d) => { r = applyImport(d.equipment, rows); if (!r.added && !r.updated) throw new Error('No rows with a CHS asset number were found.'); return { ...d, equipment: r.equipment } })
    await audit('asset_added', `Import: ${r.added} added, ${r.updated} updated`, { added: r.added, updated: r.updated })
    await touch()
    return { added: r.added, updated: r.updated }
  }, [audit, touch, updateData])

  /** Kits changed: read fresh, changed, written whole (old: saveKitGroups). */
  const changeKits = useCallback(async (fn, auditEntry) => {
    const { data } = await read('kitGroups')
    const next = fn(data && typeof data === 'object' ? data : {})
    await write('kitGroups', next)
    setState((s) => ({ ...s, kits: next }))
    if (auditEntry) await audit(...auditEntry)
    await touch()
  }, [audit, touch])

  /**
   * Several assets added at once, and a kit made from them if asked (old: the Add Assets form, maSaveAll).
   * Everything is checked before anything is saved; then the equipment, then the kit, one audit entry listing them.
   */
  const addAssets = useCallback(async (slots, kit = null) => {
    const first = planAddAssets(latest.current.equipment || [], slots)
    if (first.problem) throw new Error(first.problem)
    if (kit) { const k = kitFromNewAssets(latest.current.kits || {}, first.items, kit); if (k.problem) throw new Error(k.problem) }
    let items = []
    await updateData((d) => { const r = planAddAssets(d.equipment, slots); if (r.problem) throw new Error(r.problem); items = r.items; return { ...d, equipment: [...r.items, ...d.equipment] } })
    let label = ''
    if (kit) await changeKits((k) => { const r = kitFromNewAssets(k, items, kit); if (r.problem) throw new Error(r.problem); label = r.label; return r.kits })
    await audit('asset_added', `${items.length} asset${items.length !== 1 ? 's' : ''} added to database`, { items: items.map((i) => i.CHSAssetNo + (i.Model ? ' — ' + i.Model : '')) })
    await touch()
    return { added: items.length, kit: label }
  }, [audit, changeKits, touch, updateData])

  /** The team read again after a change in Manage, Team (old list and hub records), so every screen sees it. */
  const reloadTeam = useCallback(async () => {
    const [m, all] = await Promise.all([readOld('accountManagers').catch(() => ({ data: null })), hubDb ? getDocs(collection(hubDb, 'users')).catch(() => null) : null])
    if (m.data) setState((s) => ({ ...s, managers: list(m.data) }))
    if (all) setPeople((p) => ({ ...p, users: all.docs.map((d) => ({ uid: d.id, ...d.data() })) }))
  }, [])

  /**
   * A test notification to someone's phones (old: Settings, Test Notifications; Service & Projects only,
   * which the proxy checks). The words are fixed by the proxy, so a test can't put anyone's own text on a colleague's phone.
   */
  const testPush = useCallback(async (amName) => {
    if (isLocal) return { sentTo: amName, devices: 0, simulated: true } // the dev server: nothing is sent
    const idToken = await auth?.currentUser?.getIdToken()
    const r = await fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'testPush', amName, idToken }) })
    const j = await r.json().catch(() => ({ success: false, error: 'No answer from the server.' }))
    if (!j.success) throw new Error(j.error || 'Not sent.')
    return { sentTo: j.sentTo || amName, devices: j.deviceCount || 0 }
  }, [])

  /** Simpro job creation on or off (old: toggleSimproJobCreation), saying who and when. */
  const setJobCreation = useCallback(async (on) => {
    const { data: cfg } = await read('simproConfig')
    const next = { ...(cfg || {}), createJobs: !!on, changedBy: operator || null, changedAt: new Date().toISOString() }
    if (!on && !next.windDownFrom) next.windDownFrom = nzDate()
    await write('simproConfig', next)
    setState((s) => ({ ...s, simproConfig: next }))
    await touch()
    return next
  }, [operator, touch])
  const loadJobConfig = useCallback(async () => {
    const { data } = await read('simproConfig')
    const cfg = { createJobs: data?.createJobs === true, windDownFrom: data?.windDownFrom || null, changedBy: data?.changedBy || null, changedAt: data?.changedAt || null }
    setState((s) => ({ ...s, simproConfig: cfg }))
    return cfg
  }, [])

  /** Test mode on or off, for this browser (old: toggleTestMode; the same localStorage switch, so both trackers agree). */
  const [testMode, setTestModeState] = useState(readTestMode)
  const setTestMode = useCallback((on) => {
    try { localStorage.setItem('testMode', on ? '1' : '0') } catch { /* private mode */ }
    setTestModeState(!!on)
  }, [])

  /* Test reports: files kept with a loan, by its readiness key (old: the test reports modal). */
  const listReports = useCallback(async (key) => {
    const { data } = await read('testReports/' + enc(key))
    return Object.entries(data || {}).map(([id, meta]) => ({ id, ...meta })).sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
  }, [])
  const uploadReport = useCallback(async (key, file, loanTo) => {
    if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is over 8 MB, the most a test report can be.`)
    const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('That file couldn’t be read.')); r.readAsDataURL(file) })
    const id = newId()
    await write(`testReports/${enc(key)}/${id}`, { filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, uploadedAt: nzNow(), uploadedBy: operator || '' })
    await write(`testReportFiles/${enc(key)}/${id}`, dataUrl)
    await audit('test_report_uploaded', `${file.name} uploaded — ${loanTo}`, { key, filename: file.name })
    setState((s) => ({ ...s, reportKeys: [...new Set([...(s.reportKeys || []), key])] }))
    await touch()
  }, [audit, operator, touch])
  const reportFile = useCallback(async (key, id) => (await read(`testReportFiles/${enc(key)}/${id}`)).data, [])
  const deleteReport = useCallback(async (key, report, loanTo) => {
    await write(`testReports/${enc(key)}/${report.id}`, null, { method: 'DELETE' })
    await write(`testReportFiles/${enc(key)}/${report.id}`, null, { method: 'DELETE' })
    await audit('test_report_deleted', `${report.filename || 'Report'} deleted — ${loanTo}`, { key, filename: report.filename || '' })
    try { const { data } = await read('testReports/' + enc(key)); if (!data) setState((s) => ({ ...s, reportKeys: (s.reportKeys || []).filter((k) => k !== key) })) } catch { /* the mark stays until the next load */ }
    await touch()
  }, [audit, touch])

  /** A loan's Simpro job number put right, or cleared if the job's gone (old: promptEditSimproJob). */
  const setJobNumber = useCallback(async (key, jobId, loanTo) => {
    if (jobId == null) {
      await write(`loanDocs/${enc(key)}/simproJobId`, null, { method: 'DELETE' })
      await audit('simpro_updated', `Simpro job number cleared — ${loanTo}`, { loanTo, pdfKey: key })
    } else {
      await write('loanDocs/' + enc(key), { simproJobId: jobId }, { method: 'PATCH' })
      await audit('simpro_updated', `Simpro job #${jobId} manually linked${loanTo ? ' — ' + loanTo : ''}`, { loanTo: loanTo || '', jobId, pdfKey: key })
    }
    setState((s) => { const d = { ...(s.loanDocs[key] || {}) }; if (jobId == null) delete d.simproJobId; else d.simproJobId = jobId; return { ...s, loanDocs: { ...s.loanDocs, [key]: d } } })
    await touch()
  }, [audit, touch])

  /**
   * One device off a loan with no history entry, after the admin password,
   * for putting a mistake right (old: removeDeviceFromLoan): its loan
   * cleared, its row off the loan form, the Simpro job's device list updated.
   */
  const removeFromLoan = useCallback(async (g, item) => {
    await updateData((d) => ({ ...d, equipment: d.equipment.map((e) => (e && e.id === item.id ? { ...e, OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', Returned: 'Yes', BatchID: '', BorrowerEmail: '', _transferNote: null } : e)) }))
    await audit('item_removed', `${item.CHSAssetNo} removed from loan${g.loanTo ? ' to ' + g.loanTo : ''}`, { assetNo: item.CHSAssetNo, loanTo: g.loanTo || '' })
    if (g.batchId) {
      try {
        const { data: doc } = await read('loanDocs/' + enc(g.batchId))
        if (doc) {
          const rows = Array.isArray(doc.savedRows) ? rowsWithout(doc.savedRows, [item.CHSAssetNo])
            : g.items.filter((e) => e.id !== item.id).map((e) => [e.CHSAssetNo || '', e.Model || '', e.Description || e.Model || '', e.SerialNo || '', ''])
          if (Array.isArray(doc.savedRows)) await write('loanDocs/' + enc(g.batchId), { savedRows: rows }, { method: 'PATCH' })
          const jobId = jobNumber(doc.simproJobId)
          if (jobId) await simpro({ loanTo: doc.loanTo || '', location: doc.location || '', notes: doc.notesCell || '', shippingDetails: doc.authCell || '', startDate: toISO(doc.startDate || ''), endDate: toISO(doc.endDate || ''),
            accountManager: doc.accountManager || '', contactNumber: doc.contactNumber || '', jobType: doc.jobType || 'Demo',
            items: rows.filter((r) => r[0]).map((r) => ({ CHSAssetNo: r[0], Description: r[2] || r[1] || '', SerialNo: r[3] || '' })), jobId, pdfKey: g.batchId })
          // As the old one recorded it (old: removeItemFromLoan's simpro_updated).
          if (jobId) await audit('simpro_updated', `Simpro job #${jobId} updated — ${item.CHSAssetNo} removed from ${g.loanTo || 'the loan'}`, { loanTo: g.loanTo || '', jobId, pdfKey: g.batchId })
        }
      } catch (e) { console.warn('[equipment] loan form not updated after removing a device', e) }
    }
    await touch()
  }, [audit, simpro, touch, updateData])

  /** One device off a booking's list, after the admin password (old: removeItemFromUpcomingLoan); a booking left empty goes. */
  const removeFromBooking = useCallback(async (g, assetNo) => {
    const u = (latest.current.upcoming || []).find((x) => x.id === g.batchId)
    if (!u) throw new Error('That booking has gone.')
    const left = (u.items || []).filter((i) => i.CHSAssetNo !== assetNo)
    await updateData((d) => ({ ...d, equipment: d.equipment.map((e) => (e && e.CHSAssetNo === assetNo && e._upcomingLoanId === u.id ? { ...e, _upcomingLoanId: null } : e)) }))
    await saveBookings((latest.current.upcoming || []).map((x) => (x.id === u.id ? { ...u, items: left } : x)), [u.id])
    await audit('upcoming_item_removed', `${assetNo} removed from upcoming loan for ${u.loanTo}${left.length ? '' : ' (loan cancelled — no items left)'}`, { loanTo: u.loanTo, assetNo })
    await touch()
    return { emptied: !left.length }
  }, [audit, saveBookings, touch, updateData])

  /** History entries deleted, after the admin password (old: deleteSelectedHistory). */
  const deleteHistory = useCallback(async (ids) => {
    const gone = new Set(ids)
    await updateData((d) => ({ ...d, history: d.history.filter((h) => !gone.has(h.id)) }))
    await audit('history_deleted', `${ids.length} history entr${ids.length > 1 ? 'ies' : 'y'} deleted`, { ids })
    await touch()
  }, [audit, touch, updateData])

  /** The newest 300 audit entries, newest first (old: loadAudit); read when the log is opened. */
  const loadAudit = useCallback(async () => {
    const { data } = await read('auditLog', { params: { orderBy: '"$key"', limitToLast: 300 } })
    return list(data).sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
  }, [])

  const value = useMemo(() => ({
    ...state, managers: team, today: nzDate(), testMode, setTestMode, reload: load, user, me, operator,
    // What this person may do (step 5A, shared/can.js): in place of the admin password and the two test-mode names.
    profile: people.profile, isAdmin: can(people.profile, 'equipment.admin'), canTestMode: can(people.profile, 'equipment.testMode'),
    updateData, setReadiness, extendLoan, returnItems, makeLongTerm, returnToActive, editLoan, deleteLoan,
    createLoan, saveForm, submitJob, emailForm, addItems, transfer, countItem, loadAudit,
    saveItem, addAssets, deleteItem, deleteItems, retireItem, restoreItems, editRetired, importRetired, deleteRetired, importItems, changeKits, setJobCreation, loadJobConfig, listReports, uploadReport, reportFile, deleteReport,
    setJobNumber, removeFromLoan, removeFromBooking, deleteHistory, testPush, reloadTeam, hubUsers: people.users, audit,
  }), [state, team, people, load, user, me, operator, updateData, setReadiness, extendLoan, returnItems, makeLongTerm, returnToActive, editLoan, deleteLoan,
    createLoan, saveForm, submitJob, emailForm, addItems, transfer, countItem, loadAudit,
    testMode, setTestMode, saveItem, addAssets, deleteItem, deleteItems, retireItem, restoreItems, editRetired, importRetired, deleteRetired, importItems, changeKits, setJobCreation, loadJobConfig, listReports, uploadReport, reportFile, deleteReport,
    setJobNumber, removeFromLoan, removeFromBooking, deleteHistory, testPush, reloadTeam, audit])
  return <Store.Provider value={value}>{children}</Store.Provider>
}

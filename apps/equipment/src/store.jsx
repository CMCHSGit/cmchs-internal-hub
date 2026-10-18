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
import { PROXY_URL } from '../../../shared/proxy.js'
import { auth } from '../../schedule/src/firebase.js'
import { isLocal, read, watch, write } from './db.js'
import {
  activateBookings, extendEquipment, fmtDate, legacyLoanDocKey, loanAM, loanDocKey, memberFor, newBatchId, newId, nzDate, nzNow,
  jobNumber, readinessKey, returnEquipment, returnFollowUps, toISO, withReadiness,
} from './model.js'

const Store = createContext(null)
export const useStore = () => useContext(Store)

const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : v && typeof v === 'object' ? Object.values(v).filter(Boolean) : [])
const enc = encodeURIComponent
// The old tracker's test mode switch, shared through this origin's storage.
const readTestMode = () => { try { return localStorage.getItem('testMode') === '1' } catch { return false } }

export function StoreProvider({ children }) {
  const [state, setState] = useState({ ready: false, error: '' })
  const version = useRef(null) // the data/_v we last loaded or saved
  const latest = useRef(state)
  latest.current = state
  const [user, setUser] = useState(null)
  useEffect(() => watchUser(setUser), [])

  // The equipment and bookings first, which is all the lists need to show;
  // the loan forms (the biggest part, for job numbers, demo types and older
  // loans' account managers), the team, kits and retired items follow
  // without holding them up. extrasReady says when they're in.
  // Testing, dispatch and account managers (loanMeta) are kept twice: in
  // /data and at /loanMeta, which the old tracker writes first. Its loadData
  // lays /loanMeta over /data's copy, one loan at a time; so does this.
  const load = useCallback(async () => {
    const extras = Promise.all([read('loanDocs'), read('accountManagers'), read('kitGroups'), read('retired')])
    extras.catch(() => {}) // reported below, once the first part is showing
    try {
      const [data, upcoming, meta] = await Promise.all([read('data'), read('upcomingLoans'), read('loanMeta')])
      const d = data.data || {}
      version.current = d._v || null
      setState((s) => ({
        loanDocs: {}, managers: [], kits: {}, retired: [], extrasReady: false, ...s,
        ready: true, error: '',
        equipment: list(d.equipment), history: list(d.history), loanMeta: { ...(d.loanMeta || {}), ...(meta.data || {}) },
        upcoming: list(upcoming.data), loadedAt: Date.now(),
      }))
    } catch (e) {
      return setState((s) => ({ ...s, error: e.message || String(e) }))
    }
    try {
      const [loanDocs, managers, kits, retired] = await extras
      setState((s) => ({ ...s, loanDocs: loanDocs.data || {}, managers: list(managers.data), kits: kits.data || {}, retired: list(retired.data), extrasReady: true }))
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

  /** Moves data/_v so other open trackers reload (old: bumpRemoteVersion). If
   *  nothing else changed since we loaded, this one needn't reload as well. */
  const touch = useCallback(async () => {
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
  const me = memberFor(user, state.managers || [])
  const operator = me?.name || user?.displayName || user?.email || ''

  /** An audit log entry, as the old writeAudit (source 'hub': the old log shows it as Desktop). */
  const audit = useCallback(async (type, summary, detail, op = operator) => {
    const entry = { id: newId(), ts: nzNow(), type, summary, detail: detail || {}, operator: op, source: 'hub' }
    try { await write('auditLog/' + enc(entry.id), entry) } catch (e) { console.warn('[equipment] audit entry not saved', e) }
  }, [operator])

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
    const oldDate = g.endDate
    if (g.kind === 'booking') {
      await write(`upcomingLoans/${enc(g.batchId)}/endDate`, newDate)
      setState((s) => ({ ...s, upcoming: s.upcoming.map((u) => (u.id === g.batchId ? { ...u, endDate: newDate } : u)) }))
    } else {
      const from = loanDocKey(g, oldDate), to = loanDocKey(g, newDate)
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
      try { await write('returnDueSoonReminders/' + enc(g.loanTo + '|||' + oldDate), null, { method: 'DELETE' }) } catch { /* best effort, as the old one */ }
    }
    const items = (g.kind === 'booking' ? g.pending : g.items).map((e) => e.CHSAssetNo)
    await audit('loan_extended', `${g.kind === 'booking' ? 'Upcoming loan' : 'Loan'} for ${g.loanTo} extended from ${fmtDate(oldDate)} to ${fmtDate(newDate)}`,
      { loanTo: g.loanTo, oldDate, newDate, items })
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
  const patchMeta = useCallback(async (key, patch) => {
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
      const a = activateBookings(r.equipment, r.history, latest.current.upcoming || [], { today, ts })
      res = { r, a }
      return { equipment: a.equipment, history: a.history }
    })
    const { r, a } = res
    for (const c of a.changes) {
      if (c.remove) await write('upcomingLoans/' + enc(c.id), null, { method: 'DELETE' })
      else await write(`upcomingLoans/${enc(c.id)}/items`, c.items)
    }
    if (a.changes.length) {
      setState((s) => ({ ...s, upcoming: s.upcoming.flatMap((u) => { const c = a.changes.find((x) => x.id === u.id); return !c ? [u] : c.remove ? [] : [{ ...u, items: c.items }] }) }))
    }
    const { close, prune } = returnFollowUps(r.equipment, r.returned)
    for (const c of close) {
      await closeJob(c.key, c.loanTo, `All items returned to office on ${fmtDate(today)}.`)
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
      closed = await closeJob(batchId, g.loanTo, `Converted to a long-term loan on ${fmtDate(today)} — equipment remains with ${g.am || g.loanTo}. Closing this job; no return date.`, g.items)
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
    if (!g.batchId) throw new Error('This loan has no BatchID, so it can’t be changed here. Use the current tracker.')
    await patchMeta(g.batchId, { longTerm: false })
    try { await write('loanDocs/' + enc(g.batchId), { longTerm: false, endDate: newDate }, { method: 'PATCH' }) } catch (e) { console.warn('[equipment] loan form not updated', e) }
    await updateData((d) => ({ ...d, equipment: extendEquipment(d.equipment, g, newDate) }))
    setState((s) => ({ ...s, loanDocs: { ...s.loanDocs, [g.batchId]: { ...(s.loanDocs[g.batchId] || {}), longTerm: false, endDate: newDate } } }))
    await audit('loan_longterm_off', `${g.loanTo}’s long-term loan returned to Active, due ${fmtDate(newDate)}`, { loanTo: g.loanTo, batchId: g.batchId, newDate, items: g.items.map((e) => e.CHSAssetNo) })
    await touch()
  }, [audit, patchMeta, touch, updateData])

  const value = useMemo(() => ({
    ...state, today: nzDate(), testMode: readTestMode(), reload: load, user, me, operator,
    updateData, setReadiness, extendLoan, returnItems, makeLongTerm, returnToActive,
  }), [state, load, user, me, operator, updateData, setReadiness, extendLoan, returnItems, makeLongTerm, returnToActive])
  return <Store.Provider value={value}>{children}</Store.Provider>
}

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
import { read, watch, write } from './db.js'
import { extendEquipment, fmtDate, loanDocKey, memberFor, newId, nzDate, nzNow, readinessKey, withReadiness } from './model.js'

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
  const audit = useCallback(async (type, summary, detail) => {
    const entry = { id: newId(), ts: nzNow(), type, summary, detail: detail || {}, operator, source: 'hub' }
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

  const value = useMemo(() => ({
    ...state, today: nzDate(), testMode: readTestMode(), reload: load, user, me, operator,
    updateData, setReadiness, extendLoan,
  }), [state, load, user, me, operator, updateData, setReadiness, extendLoan])
  return <Store.Provider value={value}>{children}</Store.Provider>
}

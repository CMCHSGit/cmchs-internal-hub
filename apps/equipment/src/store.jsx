/* The demo tracker's data for the rebuilt screens: what the old tracker
   loads (loadData), kept live the same way (data/_v changes, so read again),
   and saved the same way (saveData, below), because both run on this data
   side by side until the switch (INTEGRATION-PLAN.md step 4). */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { read, watch, write } from './db.js'
import { mergeEquipmentAndHistory, nzDate, safeKeys } from './model.js'

const Store = createContext(null)
export const useStore = () => useContext(Store)

const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : v && typeof v === 'object' ? Object.values(v).filter(Boolean) : [])
// The old tracker's test mode switch, shared through this origin's storage.
const readTestMode = () => { try { return localStorage.getItem('testMode') === '1' } catch { return false } }

export function StoreProvider({ children }) {
  const [state, setState] = useState({ ready: false, error: '' })
  const version = useRef(null) // the data/_v we last loaded or saved

  const load = useCallback(async () => {
    try {
      const [data, upcoming, loanDocs, managers, kits, retired] = await Promise.all([
        read('data'), read('upcomingLoans'), read('loanDocs'), read('accountManagers'), read('kitGroups'), read('retired'),
      ])
      const d = data.data || {}
      version.current = d._v || null
      setState({
        ready: true, error: '',
        equipment: list(d.equipment), history: list(d.history), loanMeta: d.loanMeta || {},
        upcoming: list(upcoming.data), loanDocs: loanDocs.data || {},
        managers: list(managers.data), kits: kits.data || {}, retired: list(retired.data),
        loadedAt: Date.now(),
      })
    } catch (e) {
      setState((s) => ({ ...s, error: e.message || String(e) }))
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Someone saved (here or in the old tracker): the version marker moves, so
  // read everything again, as the old tracker's syncFromFirebase does.
  useEffect(() => watch('data/_v', (v) => {
    if (v && version.current && v !== version.current) load()
  }), [load])

  /**
   * Saves equipment and history the way the old tracker's saveBin does: read
   * /data with its ETag, merge with what's there if someone else saved since
   * we loaded (same merge rules), write the whole document only if nothing
   * changed in between, and try again (up to five times) if something did.
   * One deliberate difference: if the ETag can't be fetched, nothing is
   * written, rather than writing without the guard.
   */
  const saveData = useCallback(async ({ equipment, history, loanMeta }) => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { data: remote, etag } = await read('data', { etag: true })
      if (!etag) throw new Error('Could not check for other changes, so nothing was saved. Try again.')
      let toSave = { equipment, history }
      if (remote && remote._v && version.current && remote._v !== version.current) toSave = mergeEquipmentAndHistory(toSave, remote)
      const v = Date.now().toString()
      const res = await write('data', { ...toSave, _v: v, loanMeta: safeKeys(loanMeta) }, { etag })
      if (res.conflict) continue
      version.current = v
      setState((s) => ({ ...s, equipment: toSave.equipment, history: toSave.history, loanMeta }))
      return
    }
    throw new Error('Too many changes at once from other people: nothing was saved. Try again.')
  }, [])

  const value = useMemo(() => ({ ...state, today: nzDate(), testMode: readTestMode(), reload: load, saveData }), [state, load, saveData])
  return <Store.Provider value={value}>{children}</Store.Provider>
}

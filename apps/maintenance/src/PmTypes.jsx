/* Settings → Sections → Maintenance: the PM types a site can be scheduled
   for (it was the "PM types…" dialog on the maintenance page). One per line,
   in the order they're listed. Renaming or removing one doesn't change the
   entries already using it. Engineers, Management and admins edit. */
import { useEffect, useState } from 'react'
import { useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Button, Loading, Toast, useConfirm, useToast } from '../../../shared/ui/index.jsx'
import './maintenance.css'
import { savePmTypes, watchEntries, watchSettings } from '../store.js'
import { EDIT_TEAMS, READ_ONLY } from './App.jsx'

export default function PmTypes() {
  const { user, profile } = useAuth()
  const canEdit = profile?.role === 'admin' || EDIT_TEAMS.includes(profile?.team)
  const [saved, setSaved] = useState(null)
  const [text, setText] = useState('')
  const [used, setUsed] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [toastMsg, toast] = useToast()
  const [confirmDialog, confirm] = useConfirm()

  useEffect(() => {
    try {
      const a = watchSettings((s) => { setSaved(s.pmTypes); setText((t) => t || s.pmTypes.join('\n')) }, (e) => setError(e.message || String(e)))
      const b = watchEntries((list) => setUsed([...new Set(list.map((e) => e.pmType).filter(Boolean))]), () => {})
      return () => { a(); b() }
    } catch (e) { setError(e.message || String(e)) }
  }, [])

  async function save() {
    const unique = [...new Set(text.split('\n').map((t) => t.trim()).filter(Boolean))]
    if (!unique.length) return toast('Keep at least one type')
    // Removing a type doesn't touch entries already using it: say so rather
    // than letting someone think it tidied up after itself.
    const orphaned = used.filter((t) => !unique.includes(t))
    if (orphaned.length && !(await confirm({
      title: 'Some entries use a type that’s going',
      message: `${orphaned.join(', ')} ${orphaned.length === 1 ? 'is' : 'are'} still used by existing entries. Those entries keep their current type.`,
      confirmLabel: 'Save anyway',
    }))) return
    setBusy(true)
    try { await savePmTypes(unique, user.email || user.uid); setText(unique.join('\n')); toast('PM types saved') }
    catch (e) { toast('Not saved: ' + (e.message || e)) }
    finally { setBusy(false) }
  }

  if (error) return <div className="st-body"><Alert tone="critical" title="The PM types didn’t load">{error}</Alert></div>
  if (saved === null) return <div className="st-body"><Loading /></div>
  return (
    <div className="st-body">
      <section className="card st-card">
        <h2 className="st-card-title">PM types</h2>
        <p className="st-note">One per line, in the order you want them listed. Renaming one here doesn’t change the entries already using the old name.</p>
        <textarea className="input mt-types" rows={8} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} aria-label="PM types, one per line" />
        {!canEdit && <p className="st-note">{READ_ONLY}</p>}
        {canEdit && <div><Button onClick={save} disabled={busy || text.trim() === saved.join('\n')}>Save</Button></div>}
      </section>
      {confirmDialog}
      <Toast message={toastMsg} />
    </div>
  )
}

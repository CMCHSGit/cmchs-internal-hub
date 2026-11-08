/* Removing several entries at once: asks first, says how many of what, offers a copy to keep, and past a handful makes the
   person type a word, because it goes for everyone and cannot be undone. Only drawn for editors; the rules are what decide. */
import { useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { Alert, Button, Dialog } from '../../../shared/ui/index.jsx'
import { KINDS } from './model.js'
import { removeRecords } from './store.js'

const TYPE_FROM = 20 // from this many, the word has to be typed

const count = (kind, n) => `${n.toLocaleString('en-NZ')} ${n === 1 ? KINDS[kind].one : KINDS[kind].label.toLowerCase()}`

/** A file of what is about to go, as JSON, so a mistake can be put back by importing it again. */
function saveCopy(groups) {
  const data = Object.fromEntries(Object.entries(groups).map(([k, rows]) => [KINDS[k].col, rows.map(({ search, updatedAt, ...r }) => r)]))
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `knowledge-base-removed-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** groups: { kind: [records] } */
export function BulkRemove({ groups, onClose, onDone }) {
  const kinds = Object.keys(groups).filter((k) => groups[k].length)
  const total = kinds.reduce((n, k) => n + groups[k].length, 0)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const needsWord = total >= TYPE_FROM
  const ready = !needsWord || typed.trim().toLowerCase() === 'remove'

  async function run() {
    setBusy(true); setError('')
    let done = 0
    try {
      for (const k of kinds) { await removeRecords(k, groups[k].map((r) => r.id)); done += groups[k].length }
      onDone(`Removed ${done.toLocaleString('en-NZ')}.`)
    } catch (e) {
      console.error(e)
      setError(e.code === 'permission-denied'
        ? 'You can’t change the knowledge base. An admin can give you the editor switch in Settings → People and access.'
        : `It stopped part-way: ${e.message || e}. What was already removed stays removed; the rest are still here, so run it again.`)
      setBusy(false)
    }
  }

  return (
    <Dialog title={`Remove ${kinds.map((k) => count(k, groups[k].length)).join(', ')}?`} onClose={busy ? () => {} : onClose} width={520}>
      <div className="kb-form">
        <p className="confirm-text">They go for everyone, and this cannot be undone. Importing the same file again would add them back.</p>
        <div><Button variant="ghost" size="sm" iconLeft={<Download size={16} />} onClick={() => saveCopy(groups)}>Save a copy first (JSON)</Button></div>
        {needsWord && (
          <label className="field">
            <span className="field-label">Type “remove” to confirm</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={busy} />
          </label>
        )}
        {error && <Alert tone="critical">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" iconLeft={<Trash2 size={16} />} onClick={run} disabled={busy || !ready}>{busy ? 'Removing…' : `Remove ${total.toLocaleString('en-NZ')}`}</Button>
        </div>
      </div>
    </Dialog>
  )
}

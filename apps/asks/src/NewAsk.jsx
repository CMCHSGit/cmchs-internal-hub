/* Raising an ask (and the asker editing one). Built to be quick on a phone:
   one line for what's needed, who it's for, and send. Everything else is
   optional. */

import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { Alert, Button, Switch } from '../../schedule/src/components/ui'
import { useStore } from './store.jsx'
import { useOnline } from './online.js'
import { CcPicker, Field, Modal, SendToPicker } from './ui.jsx'
import { compressPhoto } from './photos.js'
import { LIMITS } from './model.js'
import { shareWith, watchOwnLists } from '../../checklists/src/store.js'

export default function NewAsk({ ask, prefill = {}, onClose, onSaved }) {
  const s = useStore()
  const editing = !!ask
  const [f, setF] = useState(() => ({
    title: ask?.title || prefill.title || '',
    details: ask?.details || '',
    assignees: ask?.assignees || prefill.assignees || [],
    teams: ask?.teams || prefill.teams || [],
    cc: ask?.cc || prefill.cc || [],
    due: ask?.due || '',
    urgent: !!ask?.urgent,
    checklist: ask?.checklist || prefill.checklist || null,
  }))
  // The checklists this person made: the only ones they can share, so the only ones an ask can attach.
  const [mine, setMine] = useState([])
  useEffect(() => { try { return watchOwnLists(s.me.uid, setMine, () => {}) } catch { return undefined } }, [s.me.uid]) // eslint-disable-line react-hooks/exhaustive-deps
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)
  const online = useOnline()
  const [err, setErr] = useState('')
  const set = (patch) => setF((x) => ({ ...x, ...patch }))

  async function save(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      // The people it goes to are given the checklist too, before the ask is sent, so nobody is told about one they can't open.
      if (f.checklist && mine.some((l) => l.id === f.checklist.id)) {
        await shareWith(f.checklist.id, { people: [...f.assignees, ...f.cc], teams: f.teams }).catch((e) => { throw new Error('The checklist couldn’t be shared, so nothing was sent: ' + (e?.message || e)) })
      }
      if (editing) {
        await s.edit(ask, f)
        onSaved?.(ask.id)
      } else {
        const id = await s.create(f, photos)
        onSaved?.(id)
      }
      onClose()
    } catch (e2) {
      setErr(e2.message || String(e2))
      setBusy(false)
    }
  }

  return (
    <Modal title={editing ? 'Edit ask' : 'New ask'} onClose={onClose} width={600}
      description={editing ? undefined : 'Everyone you send it to gets a notification. The first one to pick it up has it, and you can all see who.'}>
      <form className="ak-form" onSubmit={save}>
        <Field label="What do you need?">
          <input className="input" value={f.title} maxLength={LIMITS.title} onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Test the new alarm settings on the A7 at Middlemore" required />
        </Field>
        <Field label="More detail" hint="Optional. Model, serial, site, who to talk to.">
          <textarea className="input" rows={3} value={f.details} maxLength={LIMITS.details} onChange={(e) => set({ details: e.target.value })} />
        </Field>
        <div className="field">
          <span className="field-label">Send to</span>
          <SendToPicker assignees={f.assignees} teams={f.teams} onChange={set} />
        </div>
        <div className="field">
          <span className="field-label">CC <span className="text-muted ak-label-hint">to keep them in the loop: they’re told when it’s sent and when it’s done</span></span>
          <CcPicker cc={f.cc} exclude={f.assignees} onChange={(cc) => set({ cc })} />
        </div>
        {(mine.length > 0 || f.checklist) && (
          <Field label="Checklist" hint="Optional. Everyone you send this to is given the checklist, so they can tick it off.">
            <select value={f.checklist?.id || ''} onChange={(e) => { const l = mine.find((x) => x.id === e.target.value); set({ checklist: l ? { id: l.id, name: l.name } : null }) }}>
              <option value="">None</option>
              {mine.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              {f.checklist && !mine.some((l) => l.id === f.checklist.id) && <option value={f.checklist.id}>{f.checklist.name}</option>}
            </select>
          </Field>
        )}
        <div className="ak-formrow">
          <Field label="Due" hint="Optional">
            <input className="input" type="date" value={f.due} min={editing ? undefined : s.today} onChange={(e) => set({ due: e.target.value })} />
          </Field>
          <div className="field ak-urgent">
            <span className="field-label">Urgent</span>
            <Switch checked={f.urgent} onChange={(v) => set({ urgent: v })} label={f.urgent ? 'Yes, shows first' : 'No'} />
          </div>
        </div>
        {!editing && <PhotoAdder photos={photos} setPhotos={setPhotos} max={LIMITS.photos} onError={setErr} />}
        {err && <Alert tone="critical" title="Not sent">{err}</Alert>}
        {!online && (
          <Alert tone="warning" title="You’re offline">
            {editing ? 'Changes to an ask can’t be saved until you’re back online.'
              : 'You can still write it. It’s kept on this device and sent as soon as you’re back online, and the people you’ve sent it to are told then. Keep using this phone or browser until it has gone.'}
          </Alert>
        )}
        <div className="ak-formfoot">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || (editing && !online)}>{busy ? 'Saving…' : editing ? 'Save' : online ? 'Send ask' : 'Save to send later'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/** Take or choose photos; shows thumbnails with a remove button. Shrinks each one straight away. */
export function PhotoAdder({ photos, setPhotos, max, onError, compact = false }) {
  const input = useRef(null)
  const [working, setWorking] = useState(false)
  async function add(files) {
    onError?.('')
    setWorking(true)
    try {
      const room = max - photos.length
      const list = [...files].slice(0, room)
      const out = []
      for (const file of list) out.push(await compressPhoto(file))
      setPhotos((p) => [...p, ...out])
      if (files.length > room) onError?.(`Only ${max} photos fit here; the rest were left out.`)
    } catch (e) {
      onError?.(e.message || String(e))
    } finally {
      setWorking(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className={`ak-photoadd${compact ? ' compact' : ''}`}>
      {!compact && <span className="field-label">Photos</span>}
      <div className="ak-thumbs">
        {photos.map((p, i) => (
          <span key={i} className="ak-thumb">
            <img src={p.data} alt={`Photo ${i + 1}`} />
            <button type="button" className="ak-thumb-x" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))}><X size={14} /></button>
          </span>
        ))}
        {photos.length < max && (
          <button type="button" className={compact ? 'icon-btn icon-btn-md' : 'ak-addphoto'} onClick={() => input.current?.click()} disabled={working}
            aria-label="Add a photo" title="Add a photo">
            <Camera size={compact ? 18 : 20} aria-hidden="true" />
            {!compact && <span>{working ? 'Shrinking…' : 'Add photo'}</span>}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files || [])} />
    </div>
  )
}

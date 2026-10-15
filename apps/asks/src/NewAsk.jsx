/* Raising an ask (and the asker editing one). Built to be quick on a phone:
   one line for what's needed, who it's for, and send. Everything else is
   optional. */

import { useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { Alert, Button, Switch } from '../../schedule/src/components/ui'
import { useStore } from './store.jsx'
import { Field, Modal, SendToPicker } from './ui.jsx'
import { compressPhoto } from './photos.js'
import { LIMITS } from './model.js'

export default function NewAsk({ ask, prefill = {}, onClose, onSaved }) {
  const s = useStore()
  const editing = !!ask
  const [f, setF] = useState(() => ({
    title: ask?.title || prefill.title || '',
    details: ask?.details || '',
    assignees: ask?.assignees || prefill.assignees || [],
    teams: ask?.teams || prefill.teams || [],
    due: ask?.due || '',
    urgent: !!ask?.urgent,
  }))
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (patch) => setF((x) => ({ ...x, ...patch }))

  async function save(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
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
        <div className="ak-formfoot">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save' : 'Send ask'}</Button>
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

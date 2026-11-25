/* "From your phone", at the top of the MAC reader tab on the PC: the Device ID and MACs the signed-in person last read on their phone
   (the same tab there sends each read by itself, macInbox-firebase.js). One reading, theirs alone: it stays until they remove it or
   scan another, which replaces it, and it appears here live. Copy takes one value, or all three as lines, to paste where they are wanted. */
import { useEffect, useMemo, useState } from 'react'
import { Copy, Smartphone, Trash2 } from 'lucide-react'
import { Alert, Button, Dialog, Toast, useToast } from '../../../shared/ui/index.jsx'
import { qrSvg } from '../../qr/src/qr.js'
import { copyText } from './clipboard.js'
import { inboxRows, readerLink } from './macInbox.js'
import { clearInbox, watchInbox } from './macInbox-firebase.js'
import { rowsAsText } from './macRead.js'

const when = (ms) => (ms ? new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' }).format(new Date(ms)) : '')

/** The person's inbox, live: watches their one document and shows it. */
export default function MacInbox({ user }) {
  const [reading, setReading] = useState(undefined) // undefined: not heard yet; null: nothing there
  const [error, setError] = useState('')
  const uid = user?.uid

  useEffect(() => {
    setReading(undefined); setError('')
    if (!uid) return undefined
    return watchInbox(uid, setReading, (e) => { setReading(null); setError(e?.code === 'permission-denied' ? 'Your phone’s reads can’t be shown with this account (it needs to be on one of the Test Bench’s teams), or the database rules for the MAC reader aren’t published yet.' : (e?.message || 'Your phone’s reads can’t be shown.')) })
  }, [uid])

  return <MacInboxView reading={reading} error={error} onRemove={() => clearInbox(uid)} />
}

/** What the panel shows for a reading (undefined: not heard yet, null: none): separate from the watching so it can be looked at on its own. */
export function MacInboxView({ reading, error = '', onRemove }) {
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [toast, say] = useToast()
  const rows = useMemo(() => inboxRows(reading), [reading])
  const copy = async (text, what) => say((await copyText(text)) ? `${what} copied` : 'Couldn’t copy: select the value and copy it')
  const remove = async () => { try { await onRemove(); say('Removed') } catch { say('Couldn’t remove it: try again') } }

  return (
    <section className="tb-mac-inbox card" aria-label="From your phone">
      <div className="tb-mac-inbox-head">
        <div>
          <h2 className="tb-mac-inbox-title">From your phone</h2>
          <p className="tb-mac-note">Read a Device ID or MAC in this tab on your phone, signed in as you: it appears here by itself and stays until you remove it or read another.</p>
        </div>
        <Button variant="secondary" size="sm" iconLeft={<Smartphone size={14} aria-hidden="true" />} onClick={() => setPhoneOpen(true)}>Open on your phone</Button>
      </div>

      {error && <Alert tone="warning" title="Not available">{error}</Alert>}

      {reading === undefined && !error && <p className="tb-mac-note">Looking…</p>}
      {reading === null && !error && <p className="tb-mac-note">Nothing from your phone yet.</p>}

      {rows.length > 0 && (
        <>
          <div className="tb-mac-inbox-rows">
            {rows.map((r) => (
              <div key={r.key} className="tb-mac-inbox-row">
                <span className="tb-mac-inbox-label">{r.label}</span>
                <span className="tb-mac-mono tb-mac-inbox-value" data-testid={r.key}>{r.value}</span>
                {r.derived && <span className="tb-mac-note">from the Device ID</span>}
                <Button variant="ghost" size="sm" iconLeft={<Copy size={14} aria-hidden="true" />} aria-label={`Copy ${r.label}`} onClick={() => copy(r.value, r.label)}>Copy</Button>
              </div>
            ))}
          </div>
          <div className="tb-mac-actions">
            <Button iconLeft={<Copy size={15} aria-hidden="true" />} onClick={() => copy(rowsAsText(rows), 'All')}>Copy all</Button>
            <Button variant="ghost" iconLeft={<Trash2 size={15} aria-hidden="true" />} onClick={remove}>Remove</Button>
            {reading?.at ? <span className="tb-mac-note">Read {when(reading.at)}</span> : null}
          </div>
        </>
      )}
      {phoneOpen && <PhoneDialog onClose={() => setPhoneOpen(false)} />}
      <Toast message={toast} />
    </section>
  )
}

/** The QR code (drawn here, nothing sent anywhere) and the link to open this tab on a phone. */
function PhoneDialog({ onClose }) {
  const [toast, say] = useToast()
  const url = useMemo(() => readerLink(location.origin), [])
  const svg = useMemo(() => { try { return qrSvg(url, { level: 'M', px: 5 }) } catch { return '' } }, [url])
  return (
    <Dialog title="Open the MAC reader on your phone" description="Scan this with the phone’s camera, signed in to the hub as you." onClose={onClose} width={420}>
      <div className="tb-mac-qr">
        {svg
          ? <div className="tb-mac-qr-code" role="img" aria-label="QR code that opens the MAC reader on a phone" dangerouslySetInnerHTML={{ __html: svg }} />
          : <p className="tb-mac-note">The QR code couldn’t be drawn: copy the link instead.</p>}
        <p className="tb-mac-note">On the phone, photograph the device’s Maintenance → Device Location screen. What it reads is sent here at once. Keep patient details out of the photo.</p>
        <div className="tb-mac-actions">
          <Button variant="secondary" iconLeft={<Copy size={14} aria-hidden="true" />} onClick={async () => say((await copyText(url)) ? 'Link copied' : 'Couldn’t copy the link')}>Copy link</Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
      <Toast message={toast} />
    </Dialog>
  )
}

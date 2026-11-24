/* A unit's Device ID and MACs on its row (the asset list's and the pending rows'), and the QR code that opens the phone's MAC reader for that
   unit (readings.js phoneLink): scan it on the phone, photograph the device's network screen there, Send to the PC, and the values appear here
   by themselves (readings-firebase.js watchReadings). The LAN MAC is the Device ID without its 4th and 5th bytes (the asset lists' rule), so a
   reading with only a Device ID still gives it. Copy puts the three on the clipboard as lines, to paste where they are wanted. */
import { useMemo, useState } from 'react'
import { Copy, Smartphone } from 'lucide-react'
import { Button, Dialog, Toast, useToast } from '../../../../shared/ui/index.jsx'
import { qrSvg } from '../../../qr/src/qr.js'
import { lanOf, phoneLink } from './readings.js'

const nz = (ms) => (ms ? new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' }).format(new Date(ms)) : '')

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

export default function ReadingCell({ reading, customer, u }) {
  const [open, setOpen] = useState(false)
  const [toast, say] = useToast()
  const lines = reading ? [['Device ID', reading.deviceId], ['LAN MAC', lanOf(reading)], ['WLAN MAC', reading.wlanMac]].filter(([, v]) => v) : []
  const copy = async () => say((await copyText(lines.map(([k, v]) => `${k}: ${v}`).join('\n'))) ? 'Copied' : 'Couldn’t copy')
  return (
    <div className="ne-reading">
      {lines.length > 0 && (
        <div className="ne-reading-vals" title={`Read on a phone${reading.at ? ', ' + nz(reading.at) : ''}`}>
          {lines.map(([k, v]) => <span key={k}><small>{k}</small> <span className="ne-mono">{v}</span></span>)}
        </div>
      )}
      <div className="ne-reading-acts">
        {lines.length > 0 && <Button variant="ghost" size="sm" aria-label={`Copy ${u.serial}’s Device ID and MACs`} iconLeft={<Copy size={14} aria-hidden="true" />} onClick={copy}>Copy</Button>}
        <Button variant="ghost" size="sm" aria-label={`Read ${u.serial}’s MAC on a phone`} iconLeft={<Smartphone size={14} aria-hidden="true" />} onClick={() => setOpen(true)}>{lines.length ? 'Read again' : 'Read on phone'}</Button>
      </div>
      {open && <PhoneDialog customer={customer} u={u} onClose={() => setOpen(false)} />}
      <Toast message={toast} />
    </div>
  )
}

/** The QR code (drawn here, nothing sent anywhere) and the link for the phone. */
function PhoneDialog({ customer, u, onClose }) {
  const [toast, say] = useToast()
  const url = useMemo(() => phoneLink(customer, u, location.origin), [customer, u])
  const svg = useMemo(() => { try { return qrSvg(url, { level: 'M', px: 5 }) } catch { return '' } }, [url])
  return (
    <Dialog title="Read the MAC on a phone" description={`For ${u.serial}${u.model || u.description ? ' · ' + (u.model || u.description) : ''}`} onClose={onClose} width={420}>
      <div className="ne-qr">
        {svg
          ? <div className="ne-qr-code" role="img" aria-label="QR code that opens the MAC reader for this device on a phone" dangerouslySetInnerHTML={{ __html: svg }} />
          : <p className="ne-note">The QR code couldn’t be drawn: copy the link instead.</p>}
        <p className="ne-note">Scan it with the phone’s camera (signed in to the hub there), photograph the device’s Maintenance → Device Location screen, then press <strong>Send to the PC</strong>. The values show on this row.</p>
        <div className="ne-actions">
          <Button variant="secondary" iconLeft={<Copy size={14} aria-hidden="true" />} onClick={async () => say((await copyText(url)) ? 'Link copied' : 'Couldn’t copy the link')}>Copy link</Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
      <Toast message={toast} />
    </Dialog>
  )
}

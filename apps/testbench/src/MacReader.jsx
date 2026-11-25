/* The MAC reader (the Test Bench's MAC reader tab): point the camera at a device's network screen (a Mindray's
   Maintenance > Device Location, or a label) and get its Device ID and MAC addresses as text to copy.

   The camera (or a photo) is read by the browser's own text recognition (ocr.js, tesseract.js in a
   worker): on this phone or PC, nothing is sent anywhere. The rules for picking the addresses out of
   the text are macRead.js. Each result is an editable field, because a misread character (B for 8) is
   the one thing that can't be told from the photo: a value that was put right (O for 0) says "Check",
   and a LAN MAC that doesn't follow the Device ID (the asset lists' rule) says so. */
import { useEffect, useRef, useState } from 'react'
import { Camera, Copy, ImagePlus, RotateCcw } from 'lucide-react'
import { Alert, Badge, Button, Spinner, Toast, useToast } from '../../../shared/ui/index.jsx'
import { closeOcr, readPhoto, toCanvas } from './ocr.js'
import { readRows, readScreenText, rowsAsText } from './macRead.js'
import { copyText } from './clipboard.js'

/** `onSend(values)` (macInbox-firebase.js sendToPc) sends every read to the person's own MAC reader on the PC by itself, and again when they correct a field. */
export default function MacReader({ onSend = null }) {
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const [sent, setSent] = useState('') // '' | 'sending' | 'sent' | 'queued' | 'failed'
  const [sendError, setSendError] = useState('')
  const edited = useRef(false) // a field was corrected by hand since the last send
  const latest = useRef(0) // the newest send: an older one finishing late says nothing
  const [camera, setCamera] = useState(phone) // a phone (a touch screen) starts with the camera on
  const [stage, setStage] = useState('start') // start | reading | done
  const [percent, setPercent] = useState(0)
  const [rows, setRows] = useState([]) // [{ key, label, value, fixed }] (the value can be edited)
  const [lanMatches, setLanMatches] = useState(null)
  const [raw, setRaw] = useState('')
  const [error, setError] = useState('')
  const [picture, setPicture] = useState('') // the photo that was read, to look at beside the result
  const [toast, showToast] = useToast()
  const fields = useRef({})
  const slow = useRef(null)
  const [slowNote, setSlowNote] = useState(false)

  useEffect(() => () => { closeOcr(); clearTimeout(slow.current) }, [])
  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture) }, [picture])

  /** Sends what the fields show (or `found`, a read just made) to the PC. */
  async function push(rs) {
    if (!onSend || !rs.length) return
    const id = ++latest.current
    const values = Object.fromEntries(rs.map((r) => [r.key, r.value]))
    if (!values.lanMac && !values.wlanMac && values.other0) values.lanMac = values.other0 // one MAC with no label: the LAN one
    setSent('sending'); setSendError(''); edited.current = false
    try {
      const got = await onSend(values)
      if (id === latest.current) setSent(got?.queued ? 'queued' : 'sent')
    } catch (e) { if (id === latest.current) { setSent('failed'); setSendError(e?.message || 'It couldn’t be sent.') } }
  }

  async function read(canvas) {
    setCamera(false); setError(''); setStage('reading'); setPercent(0); setSlowNote(false); setSent(''); setSendError('')
    clearTimeout(slow.current)
    slow.current = setTimeout(() => setSlowNote(true), 6000)
    canvas.toBlob((b) => b && setPicture(URL.createObjectURL(b)), 'image/jpeg', 0.7)
    try {
      const text = await readPhoto(canvas, { onProgress: (p) => setPercent(Math.round(p * 100)), enough: (t) => readRows(readScreenText(t)).length > 0 })
      const result = readScreenText(text)
      const found = readRows(result)
      setRaw(text)
      setRows(found)
      setLanMatches(result.lanMatchesDeviceId)
      setStage('done')
      push(found) // each scan goes to the PC at once; the last one stays there
    } catch (e) {
      setError(navigator.onLine === false
        ? 'The first read needs a connection, to load the reader (about 7 MB). Connect, then try again.'
        : 'The photo couldn’t be read here. Try again, or type the address.')
      setStage('start')
    } finally { clearTimeout(slow.current) }
  }

  async function fromPhoto(ev) {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    try {
      const bitmap = await createImageBitmap(f)
      read(toCanvas(bitmap))
    } catch { setError('That photo couldn’t be opened.') }
  }

  const again = () => { setRows([]); setRaw(''); setPicture(''); setStage('start'); setError(''); setSent(''); setSendError(''); setCamera(phone) }
  const edit = (key, value) => { edited.current = true; setRows((rs) => rs.map((r) => (r.key === key ? { ...r, value, fixed: false } : r))) }
  // A value corrected by hand (a B that was an 8) goes again, a moment after the last key, so the PC has the corrected one.
  useEffect(() => {
    if (!edited.current || stage !== 'done') return undefined
    const t = setTimeout(() => push(rows), 900)
    return () => clearTimeout(t)
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  async function copy(r) {
    showToast((await copyText(r.value, fields.current[r.key])) ? `${r.label} copied` : 'Couldn’t copy: press and hold the value instead')
  }

  return (
    <div className="tb-mac">
      {stage === 'start' && (
        <>
          <p className="tb-mac-note">Photograph a device’s network screen or label: the Device ID and MAC addresses on it come back as text to copy{onSend ? ', and are sent to your MAC reader on the PC by themselves (open the Test Bench’s MAC reader tab there)' : ''}. Keep to those lines, and out of the photo anything about a patient.</p>
          {error && <Alert tone="critical" title="Not read">{error}</Alert>}
          {camera
            ? <ScreenCamera onCapture={read} onClose={() => setCamera(false)} />
            : (
              <div className="tb-mac-actions">
                <Button iconLeft={<Camera size={16} />} onClick={() => setCamera(true)}>Open the camera</Button>
                <label className="btn btn-secondary">
                  <ImagePlus size={16} aria-hidden="true" /> Take or choose a photo
                  <input type="file" accept="image/*" capture="environment" hidden onChange={fromPhoto} />
                </label>
              </div>
            )}
        </>
      )}

      {stage === 'reading' && (
        <div className="tb-mac-busy" role="status">
          <Spinner size={22} />
          <span>Reading the photo on this {phone ? 'phone' : 'device'}…{percent > 0 ? ` ${percent}%` : ''}</span>
          {slowNote && <span className="tb-mac-note">The first read loads the reader (about 7 MB) and takes longer. Nothing leaves this {phone ? 'phone' : 'device'}.</span>}
        </div>
      )}

      {stage === 'done' && (
        <>
          <div className="tb-mac-result">
            {picture && <img className="tb-mac-photo" src={picture} alt="The photo that was read" />}
            {rows.length === 0
              ? <Alert tone="warning" title="No Device ID or MAC found">Try again closer, with the screen filling the picture and no glare across the lines. You can also choose a photo you took with the camera app.</Alert>
              : (
                <div className="tb-mac-rows">
                  {rows.map((r) => (
                    <div key={r.key} className="tb-mac-row">
                      <label className="field tb-mac-grow"><span className="field-label">{r.label}{r.fixed && <Badge tone="orange" className="tb-mac-check">Check</Badge>}</span>
                        <input ref={(el) => { fields.current[r.key] = el }} className="input tb-mac-mono tb-mac-input" value={r.value} onChange={(e) => edit(r.key, e.target.value)}
                          autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
                      </label>
                      <Button variant="secondary" iconLeft={<Copy size={16} />} onClick={() => copy(r)} aria-label={`Copy ${r.label}`}>Copy</Button>
                    </div>
                  ))}
                  {rows.length > 1 && <Button variant="secondary" iconLeft={<Copy size={16} />} onClick={async () => showToast((await copyText(rowsAsText(rows))) ? 'All copied' : 'Couldn’t copy')}>Copy all</Button>}
                </div>
              )}
          </div>
          {lanMatches === false && <Alert tone="warning" title="LAN MAC doesn’t follow the Device ID">The LAN MAC should be the Device ID without its 4th and 5th bytes. One of them was probably misread: compare each character with the screen.</Alert>}
          {lanMatches === true && <p className="tb-mac-note">The LAN MAC matches the Device ID.</p>}
          {rows.some((r) => r.fixed) && <p className="tb-mac-note">“Check” marks a value where a look-alike character (O for 0, l for 1) was put right. Look at it against the screen. B and 8, D and 0 can look alike too, so check those on any read.</p>}
          {sent === 'sending' && <p className="tb-mac-note" role="status">Sending to your PC…</p>}
          {sent === 'sent' && <Alert tone="success" title="Sent to your PC">It’s in your MAC reader tab there, and stays until you remove it or read another.</Alert>}
          {sent === 'queued' && <Alert tone="warning" title="Waiting to send">There’s no connection right now. It goes to your PC by itself when this {phone ? 'phone' : 'device'} is online again: keep this page open until then.</Alert>}
          {sent === 'failed' && (
            <Alert tone="critical" title="Not sent to your PC" action={<Button size="sm" variant="secondary" onClick={() => push(rows)}>Try again</Button>}>{sendError}</Alert>
          )}
          <details className="tb-mac-raw"><summary>What was read</summary><pre>{raw || '(nothing)'}</pre></details>
          <div><Button variant="secondary" iconLeft={<RotateCcw size={16} />} onClick={again}>Read another</Button></div>
        </>
      )}
      <Toast message={toast} />
    </div>
  )
}

/** The back camera with a button to take the picture (the QR scanner reads continuously; a screen is read once, from a still). */
function ScreenCamera({ onCapture, onClose }) {
  const video = useRef(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stream = null, stopped = false
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(location.protocol === 'http:' ? 'The camera needs a secure (https) address.' : 'This browser can’t show the camera here. Take a photo instead.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
      } catch (e) {
        setError(e?.name === 'NotAllowedError' ? 'The camera wasn’t allowed. Allow it for this site in the browser’s settings, or take a photo instead.' : 'The camera couldn’t start here. Take a photo instead.')
        return
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
      const v = video.current
      v.srcObject = stream
      await v.play().catch(() => {})
      setReady(true)
    })()
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [])

  if (error) {
    return (
      <div className="tb-mac-camera">
        <p className="tb-mac-note tb-mac-problem">{error}</p>
        <div className="tb-mac-actions">
          <label className="btn btn-primary"><ImagePlus size={16} aria-hidden="true" /> Take or choose a photo
            <input type="file" accept="image/*" capture="environment" hidden onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) createImageBitmap(f).then((b) => onCapture(toCanvas(b))).catch(() => setError('That photo couldn’t be opened.')) }} />
          </label>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    )
  }
  return (
    <div className="tb-mac-camera">
      <video ref={video} className="tb-mac-video" playsInline muted aria-label="Camera" />
      <div className="tb-mac-actions">
        <Button disabled={!ready} iconLeft={<Camera size={16} />} onClick={() => onCapture(toCanvas(video.current))}>Take the picture</Button>
        <Button variant="secondary" onClick={onClose}>Stop the camera</Button>
      </div>
    </div>
  )
}

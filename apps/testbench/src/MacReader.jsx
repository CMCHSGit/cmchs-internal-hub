/* The MAC reader (the Test Bench's MAC reader tab): point the camera at a device's network screen (a Mindray's
   Maintenance > Device Location, or a label) and get its Device ID and MAC addresses as text to copy.

   The camera (or a photo) is read by the browser's own text recognition (ocr.js, tesseract.js in a
   worker): on this phone or PC, nothing is sent anywhere. The rules for picking the addresses out of
   the text are macRead.js. Each result is an editable field, because a misread character (B for 8) is
   the one thing that can't be told from the photo: a value that was put right (O for 0) says "Check",
   and a LAN MAC that doesn't follow the Device ID (the asset lists' rule) says so. */
import { useEffect, useRef, useState } from 'react'
import { Camera, Copy, ImagePlus, RotateCcw, Send } from 'lucide-react'
import { Alert, Badge, Button, Spinner, Toast, useToast } from '../../../shared/ui/index.jsx'
import { closeOcr, readPhoto, toCanvas } from './ocr.js'
import { readRows, readScreenText, rowsAsText } from './macRead.js'

/** Copy text; true when it worked. Falls back to the old way where the clipboard API isn't offered. */
async function copyText(text, field) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* try the old way */ }
  try {
    const box = field || Object.assign(document.createElement('textarea'), { value: text })
    if (!field) document.body.appendChild(box)
    box.select()
    const ok = document.execCommand('copy')
    if (!field) box.remove()
    return ok
  } catch { return false }
}

/** `target` (from a unit's phone link, newequip/readings.js) says which unit a reading is for; with `onSend` the result goes to the PC. */
export default function MacReader({ target = null, onSend = null }) {
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const [sent, setSent] = useState('') // '' | 'sending' | 'sent' | 'queued'
  const [sendError, setSendError] = useState('')
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

  async function read(canvas) {
    setCamera(false); setError(''); setStage('reading'); setPercent(0); setSlowNote(false)
    clearTimeout(slow.current)
    slow.current = setTimeout(() => setSlowNote(true), 6000)
    canvas.toBlob((b) => b && setPicture(URL.createObjectURL(b)), 'image/jpeg', 0.7)
    try {
      const text = await readPhoto(canvas, { onProgress: (p) => setPercent(Math.round(p * 100)), enough: (t) => readRows(readScreenText(t)).length > 0 })
      const result = readScreenText(text)
      setRaw(text)
      setRows(readRows(result))
      setLanMatches(result.lanMatchesDeviceId)
      setStage('done')
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
  async function send() {
    setSent('sending'); setSendError('')
    try {
      const got = await onSend(Object.fromEntries(rows.map((r) => [r.key, r.value])))
      setSent(got?.queued ? 'queued' : 'sent')
    } catch (e) { setSent(''); setSendError(e?.message || 'It couldn’t be sent.') }
  }
  // What goes to the PC: the Device ID and the two MACs, as shown (and corrected) in the fields.
  const toSend = rows.length > 0 && onSend && target
  const edit = (key, value) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, value, fixed: false } : r)))
  async function copy(r) {
    showToast((await copyText(r.value, fields.current[r.key])) ? `${r.label} copied` : 'Couldn’t copy: press and hold the value instead')
  }

  return (
    <div className="tb-mac">
      {target && (
        <div className="tb-mac-for" role="note">
          <span className="tb-mac-note">Reading for</span>
          <strong className="tb-mac-mono">{target.serial}</strong>
          <span>{[target.model, target.asset && `asset ${target.asset}`, target.customerName].filter(Boolean).join(' · ')}</span>
        </div>
      )}
      {stage === 'start' && (
        <>
          <p className="tb-mac-note">Photograph a device’s network screen or label: the Device ID and MAC addresses on it come back as text to copy. Keep to those lines, and out of the photo anything about a patient.</p>
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
          {sendError && <Alert tone="critical" title="Not sent">{sendError}</Alert>}
          {sent === 'sent' && <Alert tone="success" title="Sent to the PC">It shows on {target.serial}’s row in the Customers tab.</Alert>}
          {sent === 'queued' && <Alert tone="warning" title="Waiting to send">There’s no connection right now. It goes to the PC by itself when this phone is online again: keep this page open until then.</Alert>}
          <details className="tb-mac-raw"><summary>What was read</summary><pre>{raw || '(nothing)'}</pre></details>
          <div className="tb-mac-actions">
            {toSend && sent !== 'sent' && sent !== 'queued' && <Button iconLeft={<Send size={16} />} disabled={sent === 'sending'} onClick={send}>{sent === 'sending' ? 'Sending…' : 'Send to the PC'}</Button>}
            <Button variant="secondary" iconLeft={<RotateCcw size={16} />} onClick={again}>Read another</Button>
          </div>
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

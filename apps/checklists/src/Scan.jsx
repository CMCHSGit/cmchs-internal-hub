/* Checklists — scan a device's label to find it on the list.

   The camera reads barcodes (Code 128, Code 39, EAN ...) and QR codes, with the browser's own BarcodeDetector where
   it has one (Android Chrome, desktop Chrome) and ZXing, loaded only then, where it doesn't (iPhones, Firefox).
   A scanned code is rarely what the list says (the label carries the asset number WHA303756, the list calls the
   device N1-WHA303756), so matching ignores punctuation and case and accepts one containing the other (model.js
   matchScan). One clear match shows the device with its step buttons, so a ward is scanned and ticked without
   leaving the camera; several that fit are offered; none offers to add it as a device found on site. A code can
   also be typed or pasted, which is what a bluetooth scanner does into a field.

   Loaded only when someone opens it (App.jsx lazy). */
import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Alert, Badge, Button, Dialog } from '../../../shared/ui/index.jsx'
import StepChecks from './StepChecks.jsx'
import { bestMatches, mainOf, stateOf, suggestName, tickOf } from './model.js'

const COOLDOWN = 2500
const WANTED = ['qr_code', 'code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e', 'data_matrix', 'pdf417']

/** A buzz, or a short beep where the phone can't buzz (iPhones). */
let audio = null
function signal() {
  if (navigator.vibrate) { try { if (navigator.vibrate(60)) return } catch { /* fall through to the beep */ } }
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)()
    const o = audio.createOscillator(), g = audio.createGain()
    o.frequency.value = 1200; g.gain.value = 0.08
    o.connect(g); g.connect(audio.destination)
    o.start(); o.stop(audio.currentTime + 0.09)
  } catch { /* no sound here */ }
}

/** ZXing as `canvas -> text or ''`, for browsers with no BarcodeDetector. */
async function loadZxing() {
  const Z = await import('@zxing/library')
  const F = Z.BarcodeFormat
  const reader = new Z.MultiFormatReader()
  reader.setHints(new Map([
    [Z.DecodeHintType.POSSIBLE_FORMATS, [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.CODABAR, F.EAN_13, F.EAN_8, F.ITF, F.UPC_A, F.UPC_E, F.DATA_MATRIX, F.PDF_417]],
    [Z.DecodeHintType.TRY_HARDER, true],
  ]))
  return (canvas) => {
    const w = canvas.width, h = canvas.height
    const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data
    const lum = new Uint8ClampedArray(w * h)
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (px[j] * 306 + px[j + 1] * 601 + px[j + 2] * 117) >> 10
    try { return reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, w, h)))).getText() } catch { return '' }
  }
}

/** The browser's detector for the formats it supports, as `source -> text or ''`, or null. */
async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null
  try {
    const have = (await window.BarcodeDetector.getSupportedFormats?.()) || WANTED
    const formats = WANTED.filter((f) => have.includes(f))
    if (!formats.length) return null
    const d = new window.BarcodeDetector({ formats })
    return async (source) => (await d.detect(source))[0]?.rawValue || ''
  } catch { return null }
}

/** A photo of a code, read at a few sizes (a photo is large and the code may be small in it). */
export async function readPhoto(file) {
  const bitmap = await createImageBitmap(file)
  const native = await nativeDetector()
  if (native) { const t = await native(bitmap).catch(() => ''); if (t) return t }
  const zx = await loadZxing()
  const canvas = document.createElement('canvas')
  for (const max of [1600, 1000, 640]) {
    const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.round(bitmap.width * k); canvas.height = Math.round(bitmap.height * k)
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const t = zx(canvas)
    if (t) return t
  }
  return ''
}

const clean = (raw) => String(raw || '').trim().replace(/[^\x20-\x7E]/g, '')

function Camera({ onCode }) {
  const video = useRef(null)
  const [error, setError] = useState('')
  const [photo, setPhoto] = useState(false)
  const [note, setNote] = useState('')
  const last = useRef({ code: '', at: 0 })
  const tell = useRef(onCode)
  tell.current = onCode

  const found = (raw) => {
    const code = clean(raw)
    if (!code) return
    const now = Date.now()
    if (code === last.current.code && now - last.current.at < COOLDOWN) return
    last.current = { code, at: now }
    signal()
    tell.current(code)
  }

  useEffect(() => {
    let stream = null, timer = null, stopped = false
    const canvas = document.createElement('canvas')
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(location.protocol === 'http:' ? 'The camera needs a secure (https) address.' : 'This browser can’t show the camera here.')
        setPhoto(location.protocol !== 'http:')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      } catch (e) {
        if (e?.name === 'NotAllowedError') setError('The camera wasn’t allowed. Allow it for this site in the browser’s settings, or type the code below.')
        else { setError('The camera couldn’t start here.'); setPhoto(true) }
        return
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
      const v = video.current
      v.srcObject = stream
      await v.play().catch(() => {})
      const native = await nativeDetector()
      const zx = native ? null : await loadZxing()
      const tick = async () => {
        if (stopped) return
        try {
          if (v.readyState >= 2) {
            if (native) found(await native(v))
            else {
              const w = Math.min(v.videoWidth, 1280), h = Math.round(v.videoHeight * (w / v.videoWidth))
              canvas.width = w; canvas.height = h
              canvas.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, w, h)
              found(zx(canvas))
            }
          }
        } catch { /* a frame that couldn't be read */ }
        timer = setTimeout(tick, native ? 180 : 260)
      }
      tick()
    })()
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, [])

  async function fromPhoto(ev) {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    setNote('Reading the photo…')
    try {
      const code = clean(await readPhoto(f))
      if (!code) { setNote('No code found in that photo. Try again closer, or type the code below.'); return }
      setNote('')
      last.current = { code, at: Date.now() }
      signal()
      tell.current(code)
    } catch { setNote('That photo couldn’t be read. Type the code below.') }
  }

  return (
    <div className="cl-scan-camera">
      {error ? <Alert tone="warning">{error}{photo ? ' Take a photo of the code instead, or type it below.' : ''}</Alert> : <video ref={video} className="cl-scan-video" playsInline muted aria-label="Camera" />}
      {photo && (
        <label className="btn btn-primary btn-sm">Take a photo of the code
          <input type="file" accept="image/*" capture="environment" hidden onChange={fromPhoto} />
        </label>
      )}
      {note && <p className="cl-info">{note}</p>}
    </div>
  )
}

/** The device a code found, with its step buttons: tick what you have done without leaving the camera. */
function Found({ it, steps, onToggle, onOpen, applied, onUndo }) {
  const state = stateOf(it, steps)
  return (
    <div className="cl-scan-card">
      <div className="cl-scan-card-top">
        <b>{it.name || it.serial}</b>
        <span className="cl-mono">{it.serial}</span>
        {state === 'done' && <Badge tone="green">Done</Badge>}
        {state === 'lost' && <Badge tone="orange">Couldn’t find</Badge>}
      </div>
      <p className="cl-scan-where">{[it.department, it.location, it.status].filter(Boolean).join(' · ')}</p>
      {applied && (
        <p className="cl-scan-did" role="status">
          {applied.steps.length ? `Ticked: ${applied.steps.map((s) => s.label).join(', ')}` : 'Already ticked, so nothing changed'}
          {applied.steps.length > 0 && <button type="button" className="cl-link" onClick={onUndo}>Undo</button>}
        </p>
      )}
      <StepChecks it={it} steps={steps} onToggle={onToggle} />
      <Button variant="ghost" size="sm" onClick={() => onOpen(it.id)}>Details and note</Button>
    </div>
  )
}

/** Which steps a scan ticks by itself: what this person chose last time on this list, else the main step, else the only step. */
function startingSteps(listId, steps) {
  try {
    const saved = JSON.parse(localStorage.getItem('cl-autotick:' + listId) || 'null')
    if (Array.isArray(saved)) return saved.filter((id) => steps.some((s) => s.id === id))
  } catch { /* private mode: the default */ }
  const main = mainOf(steps)
  return main ? [main.id] : steps.length === 1 ? [steps[0].id] : []
}

export default function Scan({ listId, items, steps, onToggle, onOpen, onAdd, onClose }) {
  const [scan, setScan] = useState(null) // { code, ids }
  const [picked, setPicked] = useState('')
  const [typed, setTyped] = useState('')
  const [auto, setAuto] = useState(() => startingSteps(listId, steps)) // step ids a scan ticks by itself
  const [applied, setApplied] = useState(null) // { id, steps } what the last scan ticked, to undo
  const focus = useRef(null)

  useEffect(() => { try { localStorage.setItem('cl-autotick:' + listId, JSON.stringify(auto)) } catch { /* private mode */ } }, [auto, listId])

  // Ticks the chosen steps on a device a scan found, never unticks (scanning the same one twice is harmless).
  const tickFor = (it) => {
    const todo = steps.filter((st) => auto.includes(st.id) && !tickOf(it, st.id))
    todo.forEach((st) => onToggle(it, st, true))
    setApplied(auto.length ? { id: it.id, steps: todo } : null)
  }
  const handle = (code) => {
    const found = bestMatches(items, code)
    setScan({ code, ids: found.map((i) => i.id) }); setPicked('')
    if (found.length === 1) tickFor(found[0]); else setApplied(null)
  }
  const undo = () => {
    const it = items.find((x) => x.id === applied?.id)
    if (it) applied.steps.forEach((st) => onToggle(it, st, false))
    setApplied(null)
  }
  const live = (scan?.ids || []).map((id) => items.find((x) => x.id === id)).filter(Boolean)
  const one = live.length === 1 ? live[0] : live.find((x) => x.id === picked) || null

  return (
    <Dialog title="Scan a device" description="Point the camera at the barcode or QR code on the device. The code doesn’t have to match the list exactly." onClose={onClose} width={560} initialFocus={focus}>
      <div className="cl-scan" tabIndex={-1} ref={focus}>
        <Camera onCode={handle} />
        {!scan && <p className="cl-info">{auto.length ? 'Nothing scanned yet. Each device found is ticked for you; Undo is offered.' : 'Nothing scanned yet. Choose steps above to have each scan tick them for you.'}</p>}
        {scan && !live.length && (
          <Alert tone="info" title={`“${scan.code}” isn’t on this list`}
            action={<Button size="sm" iconLeft={<Plus size={16} />} onClick={() => onAdd({ name: suggestName(items, scan.code) })}>Add it</Button>}>
            If it is a device you found on site, add it so it is counted.
          </Alert>
        )}
        {scan && live.length > 1 && !one && (
          <div className="cl-scan-pick">
            <p className="cl-info">{live.length} devices fit “{scan.code}”. Which one?</p>
            {live.map((it) => (
              <button key={it.id} type="button" className="cl-scan-opt" onClick={() => { setPicked(it.id); tickFor(it) }}>
                <b>{it.name || it.serial}</b><span className="cl-mono">{it.serial}</span><span>{[it.department, it.location].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        )}
        {one && <Found it={one} steps={steps} onToggle={onToggle} onOpen={onOpen} applied={applied?.id === one.id ? applied : null} onUndo={undo} />}
        <form className="cl-scan-type" onSubmit={(e) => { e.preventDefault(); const c = clean(typed); if (c) { handle(c); setTyped('') } }}>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type or paste a code, e.g. WHA303756" autoComplete="off" aria-label="Type or paste a code" />
          <Button type="submit" size="sm" variant="secondary" disabled={!clean(typed)}>Find</Button>
        </form>

        <fieldset className="cl-teams cl-scan-auto"><legend className="field-label">When a device is found, tick</legend>
          {steps.map((st) => (
            <label key={st.id} className="cl-radio"><input type="checkbox" checked={auto.includes(st.id)} onChange={(e) => setAuto(e.target.checked ? [...auto, st.id] : auto.filter((x) => x !== st.id))} /> {st.label}{st.main ? ' (main)' : ''}</label>
          ))}
        </fieldset>
      </div>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onClose}>Close the camera</Button>
      </div>
    </Dialog>
  )
}

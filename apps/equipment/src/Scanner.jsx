/* The camera reading QR codes (old: openQR on the desktop, mpOpenScan on
   the phone): the back camera, read with the browser's own BarcodeDetector
   where it has one (Android Chrome, desktop Chrome), else jsQR (iPhone,
   Firefox), several times a second. The same code read again within
   2.5 seconds is ignored, so holding a label in view counts it once.
   Each read buzzes, or beeps where the phone can't buzz (iPhones), as the
   old phone did. If the camera can't run here (but wasn't refused), a photo
   of the code can be taken instead and read the same way (old: handleNativeQR). */
import { useEffect, useRef, useState } from 'react'

const COOLDOWN = 2500

/** A short beep (old: the phone scanner's beep on iOS). Needs a tap first on iPhones, which opening the camera is. */
let audio = null
function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)()
    const o = audio.createOscillator(), g = audio.createGain()
    o.frequency.value = 1200; g.gain.value = 0.08
    o.connect(g); g.connect(audio.destination)
    o.start(); o.stop(audio.currentTime + 0.09)
  } catch { /* no sound here */ }
}
function signal() {
  if (navigator.vibrate) { try { if (navigator.vibrate(60)) return } catch { /* fall through to the beep */ } }
  beep()
}

/** A QR code in a still image: BarcodeDetector, else jsQR at a few sizes (a photo is large, a code may be small in it). */
async function readImage(file) {
  const bitmap = await createImageBitmap(file)
  if ('BarcodeDetector' in window) {
    try { const codes = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap); if (codes[0]?.rawValue) return codes[0].rawValue } catch { /* try jsQR */ }
  }
  const jsQR = (await import('jsqr')).default
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true })
  for (const max of [1600, 1000, 600]) {
    const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.round(bitmap.width * k); canvas.height = Math.round(bitmap.height * k)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' })
    if (code?.data) return code.data
  }
  return ''
}

export default function Scanner({ onCode, onClose }) {
  const video = useRef(null)
  const [error, setError] = useState('')
  const [photo, setPhoto] = useState(false) // offer a photo instead (the camera couldn't run, but wasn't refused)
  const [reading, setReading] = useState('')
  const last = useRef({ code: '', at: 0 })
  const tell = useRef(onCode)
  tell.current = onCode
  const clean = (raw) => String(raw || '').trim().replace(/[^\x20-\x7E]/g, '')

  useEffect(() => {
    let stream = null, timer = null, stopped = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const found = (raw) => {
      const code = clean(raw)
      if (!code) return
      const now = Date.now()
      if (code === last.current.code && now - last.current.at < COOLDOWN) return
      last.current = { code, at: now }
      signal()
      tell.current(code)
    }
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(location.protocol === 'http:' ? 'The camera needs a secure (https) address.' : 'This browser can’t show the camera here.')
        setPhoto(location.protocol !== 'http:')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      } catch (e) {
        if (e?.name === 'NotAllowedError') setError('The camera wasn’t allowed. Allow it for this site in the browser’s settings, or type the asset number.')
        else { setError('The camera couldn’t start here.'); setPhoto(true) }
        return
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
      const v = video.current
      v.srcObject = stream
      await v.play().catch(() => {})
      let detector = null
      if ('BarcodeDetector' in window) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }) } catch { detector = null } }
      const jsQR = detector ? null : (await import('jsqr')).default
      const tick = async () => {
        if (stopped) return
        try {
          if (v.readyState >= 2) {
            if (detector) {
              const codes = await detector.detect(v)
              if (codes[0]) found(codes[0].rawValue)
            } else {
              const w = Math.min(v.videoWidth, 800), h = Math.round(v.videoHeight * (w / v.videoWidth))
              canvas.width = w; canvas.height = h
              ctx.drawImage(v, 0, 0, w, h)
              const img = ctx.getImageData(0, 0, w, h)
              const code = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' })
              if (code?.data) found(code.data)
            }
          }
        } catch { /* a frame that couldn't be read */ }
        timer = setTimeout(tick, 180)
      }
      tick()
    })()
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, [])

  async function fromPhoto(ev) {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    setReading('Reading the photo…')
    try {
      const code = clean(await readImage(f))
      if (!code) { setReading('No QR code found in that photo. Try again closer, or type the asset number.'); return }
      setReading('')
      signal()
      tell.current(code)
    } catch { setReading('That photo couldn’t be read. Type the asset number instead.') }
  }

  return (
    <div className="eq-scanner">
      {error ? <p className="eq-note eq-problem">{error}{photo ? ' Take a photo of the code instead, or type the asset number.' : ''}</p> : <video ref={video} className="eq-scanner-video" playsInline muted aria-label="Camera" />}
      {photo && (
        <label className="btn btn-primary btn-sm">Take a photo of the code
          <input type="file" accept="image/*" capture="environment" hidden onChange={fromPhoto} />
        </label>
      )}
      {reading && <p className="eq-note">{reading}</p>}
      <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Stop the camera</button>
    </div>
  )
}

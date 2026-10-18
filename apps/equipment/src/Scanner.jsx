/* The camera reading QR codes (old: openQR on the desktop, mpOpenScan on
   the phone): the back camera, read with the browser's own BarcodeDetector
   where it has one (Android Chrome, desktop Chrome), else jsQR (iPhone,
   Firefox), several times a second. The same code read again within
   2.5 seconds is ignored, so holding a label in view counts it once. */
import { useEffect, useRef, useState } from 'react'

const COOLDOWN = 2500

export default function Scanner({ onCode, onClose }) {
  const video = useRef(null)
  const [error, setError] = useState('')
  const last = useRef({ code: '', at: 0 })
  const tell = useRef(onCode)
  tell.current = onCode

  useEffect(() => {
    let stream = null, timer = null, stopped = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const found = (raw) => {
      const code = String(raw || '').trim().replace(/[^\x20-\x7E]/g, '')
      if (!code) return
      const now = Date.now()
      if (code === last.current.code && now - last.current.at < COOLDOWN) return
      last.current = { code, at: now }
      try { navigator.vibrate?.(60) } catch { /* not on this device */ }
      tell.current(code)
    }
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(location.protocol === 'http:' ? 'The camera needs a secure (https) address.' : 'This browser can’t use the camera. Type the asset number instead.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      } catch (e) {
        setError(e?.name === 'NotAllowedError' ? 'The camera wasn’t allowed. Allow it for this site in the browser’s settings, or type the asset number.' : 'The camera couldn’t start: ' + (e?.message || e))
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

  return (
    <div className="eq-scanner">
      {error ? <p className="eq-note eq-problem">{error}</p> : <video ref={video} className="eq-scanner-video" playsInline muted aria-label="Camera" />}
      <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Stop the camera</button>
    </div>
  )
}

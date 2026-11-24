/* QR codes and barcodes: type something, get a code to save or copy. Drawn in this browser (qr.js, code128.js);
   what is typed is never sent anywhere, saved, or logged. First piece: QR codes and Code 128 barcodes. */
import { useMemo, useState } from 'react'
import { Barcode, Copy, Download, QrCode, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Alert, Button, Toast, useToast } from '../../../shared/ui/index.jsx'
import { DEFAULT_LEVEL, LEVELS, qrSvg } from './qr.js'
import { code128Problem, code128Svg } from './code128.js'
import { looksLikeNhi } from './privacy.js'
import { canCopyImage, copyPng, downloadPng, downloadSvg, fileNameFor } from './download.js'

const QR_SIZES = { S: ['Small', 4], M: ['Medium', 8], L: ['Large', 16] }
const BAR_SIZES = { S: ['Small', 1], M: ['Medium', 2], L: ['Large', 4] }

export default function App() {
  const [kind, setKind] = useState('qr') // 'qr' | 'barcode'
  // Each kind keeps its own text, so switching tabs doesn't throw away what was typed.
  const [texts, setTexts] = useState({ qr: '', barcode: '' })
  const [level, setLevel] = useState(DEFAULT_LEVEL)
  const [size, setSize] = useState('M')
  const [label, setLabel] = useState(true)
  const [toastMsg, toast] = useToast()

  const text = texts[kind]
  const isQr = kind === 'qr'

  // `svg` is what is shown and saved; `error` says why there isn't one (silent while the box is empty).
  const { svg, error } = useMemo(() => {
    if (!text) return { svg: '', error: '' }
    try {
      if (isQr) return { svg: qrSvg(text, { level, px: QR_SIZES[size][1] }), error: '' }
      const problem = code128Problem(text)
      if (problem) return { svg: '', error: problem }
      return { svg: code128Svg(text, { module: BAR_SIZES[size][1] * 2, height: 40 + BAR_SIZES[size][1] * 20, label }), error: '' }
    } catch (e) {
      return { svg: '', error: e.message }
    }
  }, [text, isQr, level, size, label])

  const name = fileNameFor(isQr ? 'qr' : 'barcode', text)
  const run = (fn, done) => async () => {
    try { await fn(); if (done) toast(done) } catch (e) { toast(e.message || 'That did not work.') }
  }

  return (
    <div className="codes">
      <header className="codes-head">
        <h1>QR codes and barcodes</h1>
        <p className="codes-lead">Type or paste something and save the code as a picture. It is made in this browser: nothing you type is sent anywhere or kept.</p>
      </header>

      <div className="codes-tabs" role="tablist" aria-label="Kind of code">
        <button role="tab" aria-selected={isQr} className={isQr ? 'on' : ''} onClick={() => { setKind('qr'); setSize('M') }}><QrCode size={18} aria-hidden="true" /> QR code</button>
        <button role="tab" aria-selected={!isQr} className={!isQr ? 'on' : ''} onClick={() => { setKind('barcode'); setSize('M') }}><Barcode size={18} aria-hidden="true" /> Barcode (Code 128)</button>
      </div>

      <div className="codes-grid">
        <section className="card codes-form" aria-label="What goes in the code">
          <label className="field">
            <span className="field-label">{isQr ? 'Text or link' : 'Text or number'}</span>
            {isQr ? (
              <textarea className="input" rows={4} value={text} placeholder="For example https://internal.chsnz.co.nz/ or an asset number"
                onChange={(e) => setTexts({ ...texts, qr: e.target.value })} spellCheck="false" autoCapitalize="off" autoCorrect="off" />
            ) : (
              <input className="input" type="text" inputMode="text" value={text} placeholder="For example an asset or serial number"
                onChange={(e) => setTexts({ ...texts, barcode: e.target.value })} spellCheck="false" autoCapitalize="off" autoCorrect="off" maxLength={200} />
            )}
          </label>

          <div className="codes-row">
            {isQr && (
              <label className="field">
                <span className="field-label">Error correction</span>
                <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
                  {Object.entries(LEVELS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
                </select>
              </label>
            )}
            <label className="field">
              <span className="field-label">Size to save</span>
              <select className="input" value={size} onChange={(e) => setSize(e.target.value)}>
                {Object.entries(isQr ? QR_SIZES : BAR_SIZES).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
              </select>
            </label>
          </div>
          {!isQr && (
            <label className="codes-check"><input type="checkbox" checked={label} onChange={(e) => setLabel(e.target.checked)} /> Print the text under the bars</label>
          )}
          {isQr && <p className="codes-hint">{LEVELS[level].note}. Black on white, so every scanner reads it.</p>}
          {!isQr && <p className="codes-hint">Code 128 holds letters, digits and the usual symbols. A run of digits is packed to keep the barcode short.</p>}
        </section>

        <section className="card codes-out" aria-label="The code" aria-live="polite">
          {svg ? (
            <>
              <div className="codes-sheet" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={isQr ? 'The QR code' : 'The barcode'} />
              <div className="codes-actions">
                <Button iconLeft={<Download size={16} aria-hidden="true" />} onClick={run(() => downloadPng(svg, name), 'Saved the PNG')}>Download PNG</Button>
                <Button variant="secondary" iconLeft={<Download size={16} aria-hidden="true" />} onClick={run(() => downloadSvg(svg, name), 'Saved the SVG')}>Download SVG</Button>
                {canCopyImage() && <Button variant="secondary" iconLeft={<Copy size={16} aria-hidden="true" />} onClick={run(() => copyPng(svg), 'Copied the picture')}>Copy picture</Button>}
              </div>
            </>
          ) : (
            <div className="codes-empty">
              {isQr ? <QrCode size={40} aria-hidden="true" /> : <Barcode size={40} aria-hidden="true" />}
              <p>{error || `Your ${isQr ? 'QR code' : 'barcode'} appears here.`}</p>
            </div>
          )}
        </section>
      </div>

      {looksLikeNhi(text) && (
        <Alert tone="warning" icon={<TriangleAlert size={18} aria-hidden="true" />} title="This looks like it may be an NHI number">
          Anyone with a phone can read a code. Patient information must not go into labels, reports or other shared material (QP33). Check before you save it.
        </Alert>
      )}
      <p className="codes-privacy"><ShieldCheck size={16} aria-hidden="true" /> Nothing leaves your device. Please keep patient details (names, NHI numbers, dates of birth, addresses) out of codes.</p>
      <Toast message={toastMsg} />
    </div>
  )
}

/* QR labels: choose assets, pick the label sheet, see the first page, print.
   Opened from the Equipment list (tick assets, "QR labels"), or empty to pick
   here. The sheet itself is labels.js. Each QR links to the asset's record
   (labelUrl); scanning one in Scan's "Look up" opens it. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import { Alert, Button } from '../../../shared/ui/index.jsx'
import { searchEquipment } from './model.js'
import { DEFAULT_LAYOUT, LAYOUTS, labelPages, sheetHtml } from './labels.js'

const A4_PX = 210 * 96 / 25.4 // a sheet's width in CSS pixels

/** The first sheet, shrunk to fit the width it's given. */
function Preview({ html }) {
  const box = useRef(null)
  const [scale, setScale] = useState(0.5)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / A4_PX)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className="eq-lbl-preview" style={{ height: scale * (297 * 96 / 25.4) }}>
      <iframe title="First sheet of labels" srcDoc={html} sandbox="" scrolling="no" style={{ width: A4_PX, height: 300 * 96 / 25.4, transform: `scale(${scale})` }} />
    </div>
  )
}

export default function Labels({ s, params }) {
  const all = useMemo(() => (s.equipment || []).filter((e) => e && e.CHSAssetNo)
    .sort((a, b) => String(a.CHSAssetNo).localeCompare(String(b.CHSAssetNo), undefined, { numeric: true })), [s.equipment])
  const [picked, setPicked] = useState(() => new Set(String(params.nos || '').split(',').map((x) => x.trim()).filter(Boolean)))
  const [q, setQ] = useState('')
  const [layout, setLayout] = useState(DEFAULT_LAYOUT)
  const [skip, setSkip] = useState(0)
  const [error, setError] = useState('')
  const shown = useMemo(() => (q.trim() ? searchEquipment(all, q) : all).slice(0, 300), [all, q])
  const chosen = useMemo(() => all.filter((e) => picked.has(e.CHSAssetNo)), [all, picked])
  const per = LAYOUTS[layout].cols * LAYOUTS[layout].rows
  const sheets = labelPages(chosen, layout, skip).length
  const preview = useMemo(() => (chosen.length ? sheetHtml(chosen.slice(0, per), { layout, skip, guides: true }) : ''), [chosen, layout, skip, per])
  const toggle = (no) => setPicked((p) => { const n = new Set(p); if (n.has(no)) n.delete(no); else n.add(no); return n })
  const allShown = shown.length > 0 && shown.every((e) => picked.has(e.CHSAssetNo))
  const toggleShown = () => setPicked((p) => { const n = new Set(p); shown.forEach((e) => (allShown ? n.delete(e.CHSAssetNo) : n.add(e.CHSAssetNo))); return n })

  function print() {
    setError('')
    const w = window.open('', '_blank')
    if (!w) return setError('The print window was blocked. Allow pop-ups for this site and try again.')
    w.document.write(sheetHtml(chosen, { layout, skip, autoPrint: true }))
    w.document.close()
  }

  return (
    <div className="eq-lbl">
      <div>
        <h2 className="eq-h2">QR labels</h2>
        <p className="eq-note">Each label’s QR opens that asset’s record: scan it with a phone’s camera, or with Scan → Look up. Older labels that hold just the asset number still scan.</p>
      </div>
      <div className="eq-lbl-cols">
        <section className="card eq-lbl-pick">
          <label className="field"><span className="field-label">Choose assets</span>
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Asset no., model, serial or shelf" autoComplete="off" />
          </label>
          <div className="eq-actions-row">
            <span className="eq-strong eq-grow">{picked.size} chosen</span>
            <Button size="sm" variant="secondary" disabled={!shown.length} onClick={toggleShown}>{allShown ? 'Untick shown' : 'Tick all shown'}</Button>
            <Button size="sm" variant="ghost" disabled={!picked.size} onClick={() => setPicked(new Set())}>Clear</Button>
          </div>
          <ul className="eq-picklist">
            {shown.map((e) => (
              <li key={e.id}>
                <label className="eq-picked">
                  <input type="checkbox" checked={picked.has(e.CHSAssetNo)} onChange={() => toggle(e.CHSAssetNo)} />
                  <span className="eq-picked-main"><span className="eq-strong">{e.CHSAssetNo}</span> {e.Model}</span>
                </label>
              </li>
            ))}
            {!shown.length && <li className="eq-note">Nothing matches that.</li>}
          </ul>
        </section>
        <section className="card eq-lbl-set">
          <label className="field"><span className="field-label">Label sheet</span>
            <select value={layout} onChange={(e) => { setLayout(e.target.value); setSkip(0) }}>
              {Object.entries(LAYOUTS).map(([k, L]) => <option key={k} value={k}>{L.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Start at label</span>
            <input className="input" type="number" min="1" max={per} value={skip + 1} onChange={(e) => setSkip(Math.max(0, Math.min(per - 1, (parseInt(e.target.value, 10) || 1) - 1)))} />
            <span className="eq-small">To carry on with a part-used sheet.</span>
          </label>
          {error && <Alert tone="critical" title="Not printed">{error}</Alert>}
          <div className="eq-actions-row">
            <Button iconLeft={<Printer size={16} />} disabled={!chosen.length} onClick={print}>Print {chosen.length ? `${chosen.length} ${chosen.length === 1 ? 'label' : 'labels'}` : 'labels'}</Button>
            {sheets > 0 && <span className="eq-small">{sheets} {sheets === 1 ? 'sheet' : 'sheets'}</span>}
          </div>
          <p className="eq-small">Print at 100% (“Actual size”), not “Fit to page”, or the labels drift off the stickers. The dashed outlines below are only a guide and don’t print.</p>
          {preview ? <Preview html={preview} /> : <p className="eq-note">Choose assets to see the first sheet.</p>}
        </section>
      </div>
    </div>
  )
}

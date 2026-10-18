/* A loan's test reports (old: the test reports window): files kept with the
   loan (PDFs, photos), up to 8 MB each, downloadable by anyone, deleted
   with the admin password. Kept by the loan's readiness key, so the same
   reports show in both trackers. */
import { useEffect, useRef, useState } from 'react'
import { Download, Trash2, Upload } from 'lucide-react'
import { Alert, Button, Dialog, Loading } from '../../../shared/ui/index.jsx'
import { AdminDialog } from './Items.jsx'
import { fmtWhen, readinessKey } from './model.js'

const size = (b) => (!b ? '0 KB' : b < 1024 * 1024 ? Math.round(b / 1024) + ' KB' : (b / (1024 * 1024)).toFixed(1) + ' MB')

export default function TestReports({ s, g, onClose }) {
  const key = readinessKey(g)
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(null)
  const input = useRef(null)
  const refresh = () => s.listReports(key).then(setList, (e) => setError(e.message || String(e)))
  useEffect(() => { refresh() }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(files) {
    setError('')
    const all = [...files]
    for (let i = 0; i < all.length; i++) {
      setBusy(`Uploading ${i + 1} of ${all.length}…`)
      try { await s.uploadReport(key, all[i], g.loanTo) } catch (e) { setError(e.message || String(e)) }
    }
    setBusy(''); if (input.current) input.current.value = ''
    refresh()
  }
  async function download(r) {
    setError('')
    try {
      const url = await s.reportFile(key, r.id)
      if (!url) throw new Error('That file couldn’t be found.')
      const a = document.createElement('a'); a.href = url; a.download = r.filename; document.body.appendChild(a); a.click(); a.remove()
    } catch (e) { setError(e.message || String(e)) }
  }

  return (
    <Dialog title={`Test reports: ${g.loanTo}`} onClose={onClose} width={560}>
      <div className="eq-form" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) upload(e.dataTransfer.files) }}>
        {!list ? <Loading /> : list.length ? (
          <ul className="eq-picklist">
            {list.map((r) => (
              <li key={r.id} className="eq-picked">
                <span className="eq-picked-main"><span className="eq-strong">{r.filename}</span><span className="eq-small">{size(r.size)}{r.uploadedBy ? ` · ${r.uploadedBy}` : ''}{r.uploadedAt ? ` · ${fmtWhen(r.uploadedAt)}` : ''}</span></span>
                <button type="button" className="icon-btn icon-btn-sm" aria-label={`Download ${r.filename}`} onClick={() => download(r)}><Download size={16} /></button>
                <button type="button" className="icon-btn icon-btn-sm" aria-label={`Delete ${r.filename}`} onClick={() => setDeleting(r)}><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        ) : <p className="eq-note">No test reports yet. Drop files here, or upload them.</p>}
        <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files?.length && upload(e.target.files)} />
        {error && <Alert tone="critical" title="Not done">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button iconLeft={<Upload size={16} />} disabled={!!busy} onClick={() => input.current?.click()}>{busy || 'Upload'}</Button>
        </div>
      </div>
      {deleting && <AdminDialog s={s} title={`Delete ${deleting.filename}?`} confirmLabel="Delete it" danger onClose={() => setDeleting(null)}
        onConfirm={async () => { await s.deleteReport(key, deleting, g.loanTo); setDeleting(null); refresh() }} />}
    </Dialog>
  )
}

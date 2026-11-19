/* Log Reader: open a device's log export (log.tar, or loose log files) and read
   it on this page. Everything happens in this browser tab's memory: the files
   are never uploaded, never saved in the hub and never cached; closing the tab
   (or "Close logs") forgets them. Which device it is decides the extras (the
   defibrillator gets a shock table); other devices just get the viewer. */
import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import { FileText, FolderOpen, Lock, X } from 'lucide-react'
import { Alert, Button, Spinner } from '../../../shared/ui/index.jsx'
import { openFiles, loadFamily } from './load.js'
import { fmtTime, mergeLines } from './lines.js'
import { profileFor } from './profiles.js'
import { LogView } from './LogView.jsx'
import { ShockTable } from './ShockTable.jsx'

const mb = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'
const day = (t) => fmtTime(t).slice(0, 10)

export default function App() {
  const [session, setSession] = useState(null)
  const [on, setOn] = useState([]) // ticked log names, in the order they were ticked
  const [tab, setTab] = useState('logs')
  const [jump, setJump] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  const [, bump] = useReducer(x => x + 1, 0)
  const fileRef = useRef(null)

  const names = useMemo(() => session ? session.families.map(f => f.name) : [], [session])
  const byName = useMemo(() => new Map((session?.families || []).map(f => [f.name, f])), [session])
  const profile = useMemo(() => profileFor(names), [names])

  const open = useCallback(async (files) => {
    setError(''); setBusy('Opening…')
    try {
      const s = await openFiles(files, setBusy)
      const all = s.families.map(f => f.name)
      const p = profileFor(all)
      const first = p ? p.firstFamilies.filter(n => all.includes(n)) : []
      for (const n of first) await loadFamily(s.families.find(f => f.name === n), setBusy)
      setSession(s); setOn(first); setTab('logs'); setJump(null)
    } catch (e) {
      setError(e.message || 'That file could not be read.')
    } finally { setBusy('') }
  }, [])

  const toggle = async (name) => {
    if (on.includes(name)) { setOn(on.filter(n => n !== name)); return }
    setError(''); setBusy('Reading…')
    try {
      await loadFamily(byName.get(name), setBusy)
      setOn([...on, name]); bump()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  const lines = useMemo(() => mergeLines(on.map(n => byName.get(n).lines)), [on, byName])
  const close = () => { setSession(null); setOn([]); setJump(null); setError('') }

  const fam = profile?.families
  const backend = fam && byName.get(fam.backend)?.lines
  const print = fam && byName.get(fam.print)?.lines
  const hasShocks = !!(profile?.id === 'defib' && backend && print)

  const showInLogs = (line) => {
    // both defibrillator logs side by side in one timeline
    setOn(profile.firstFamilies.filter(n => byName.has(n)))
    setTab('logs'); setJump({ t: line.t, line })
  }

  const pickFiles = (files) => { if (files && files.length) open(files) }
  const dropFiles = (e) => { e.preventDefault(); setDrag(false); pickFiles(e.dataTransfer.files) }
  const over = (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDrag(true) } }

  const input = <input ref={fileRef} type="file" multiple hidden accept=".tar,.log,.txt,.lzo,.0,.1,.2,.3,.4,.5" onChange={e => { const f = [...e.target.files]; e.target.value = ''; pickFiles(f) }} />

  return (
    <div className="lr" onDragOver={over} onDragLeave={() => setDrag(false)} onDrop={dropFiles} data-drag={drag ? '' : undefined}>
      {input}
      <div className="lr-top">
        <h1 className="lr-title"><FileText size={20} aria-hidden /> Log Reader</h1>
        {session && <span className="lr-source" title={session.source}>{session.source}</span>}
        <span className="lr-privacy"><Lock size={14} aria-hidden /> Read on this device only. Nothing is uploaded or saved.</span>
        <span className="lr-spacer" />
        <Button variant="secondary" size="sm" iconLeft={<FolderOpen size={16} />} onClick={() => fileRef.current.click()} disabled={!!busy}>{session ? 'Open another' : 'Open logs'}</Button>
        {session && <Button variant="ghost" size="sm" iconLeft={<X size={16} />} onClick={close}>Close logs</Button>}
      </div>

      {error && <Alert tone="critical" title="Couldn’t open that" className="lr-alert" action={<Button variant="ghost" size="sm" onClick={() => setError('')}>Dismiss</Button>}>{error}</Alert>}
      {busy && <div className="lr-busy" role="status"><Spinner size={18} /> {busy}</div>}

      {!session ? (
        <div className="lr-start">
          <div className="lr-drop">
            <FileText size={40} aria-hidden />
            <h2>Open a device’s logs</h2>
            <p>Drop a <b>log.tar</b> from a device export here (a defibrillator’s Orbit export, for example), or loose <b>.log</b>, <b>.txt</b> and <b>.lzo</b> files.</p>
            <Button iconLeft={<FolderOpen size={16} />} onClick={() => fileRef.current.click()} disabled={!!busy}>Choose a file</Button>
            <p className="lr-fine">The logs are read in this browser tab and forgotten when you close it. They are not sent anywhere, saved in the hub or kept for next time.</p>
            <p className="lr-fine">Defibrillators get a shock-to-print table. Other Mindray devices open in the same viewer, and get their own extras as they are added.</p>
          </div>
        </div>
      ) : (
        <div className="lr-main">
          <aside className="lr-side" aria-label="Logs in this export">
            <div className="lr-side-h">{profile ? profile.name + ' export' : 'Logs'} · {session.families.length} logs</div>
            <ul>
              {session.families.map(f => {
                const i = on.indexOf(f.name)
                const total = f.files.reduce((n, x) => n + x.size, 0)
                const first = profile?.firstFamilies.includes(f.name)
                return (
                  <li key={f.name}>
                    <label className={'lr-fl' + (i >= 0 ? ' on' : '')}>
                      <input type="checkbox" checked={i >= 0} onChange={() => toggle(f.name)} disabled={!!busy} />
                      <span className={'lr-dot lr-f' + (i >= 0 ? i % 6 : 'x')} aria-hidden />
                      <span className="lr-fl-t">
                        <span className="lr-fl-n">{f.name}{first && <i className="lr-star" title="Used by the shock table"> ★</i>}</span>
                        <span className="lr-fl-s">
                          {f.files.length > 1 ? `${f.files.length} files · ` : ''}{mb(total)}
                          {f.range ? ` · ${day(f.range.from)} → ${day(f.range.to)}` : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="lr-fine">Tick two or more to read them together in one timeline.</p>
          </aside>

          <section className="lr-content">
            {hasShocks && (
              <div className="lr-tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'logs'} className={tab === 'logs' ? 'on' : ''} onClick={() => setTab('logs')}>Log lines</button>
                <button role="tab" aria-selected={tab === 'shocks'} className={tab === 'shocks' ? 'on' : ''} onClick={() => setTab('shocks')}>Shock events</button>
              </div>
            )}
            {tab === 'shocks' && hasShocks
              ? <ShockTable backend={backend} print={print} onShow={showInLogs} />
              : <LogView lines={lines} famNames={on} profile={profile} jump={jump} />}
          </section>
        </div>
      )}
    </div>
  )
}

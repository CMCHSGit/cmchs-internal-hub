/* Log Reader: open a device's log export (log.tar, or loose log files) and read
   it on this page. Everything happens in this browser tab's memory: the files
   are never uploaded, never saved in the hub and never cached; closing the tab
   (or "Close logs") forgets them. Which device it is decides the extras (the
   defibrillator gets a shock table); other devices just get the viewer. */
import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import { FileArchive, FileText, FolderOpen, Folders, Lock, X } from 'lucide-react'
import { Alert, Button, Spinner, useConfirm } from '../../../shared/ui/index.jsx'
import { openFiles, loadFamily } from './load.js'
import { findExports, itemsFromDrop, itemsFromInput } from './folder.js'
import { fmtTime, mergeLines } from './lines.js'
import { profileFor } from './profiles.js'
import { LogView } from './LogView.jsx'
import { ShockTable } from './ShockTable.jsx'
import { AlarmsTab } from './AlarmsTab.jsx'
import { ALARM_FAMILY } from './alarms.js'

const mb = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'
const day = (t) => fmtTime(t).slice(0, 10)

export default function App() {
  const [session, setSession] = useState(null)
  const [found, setFound] = useState(null) // the exports found in a chosen folder or files: { list, label, skipped, more }
  const [on, setOn] = useState([]) // ticked log names, in the order they were ticked
  const [tab, setTab] = useState('logs')
  const [jump, setJump] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  const [, bump] = useReducer(x => x + 1, 0)
  const fileRef = useRef(null)
  const [confirmDialog, confirm] = useConfirm()
  const dirRef = useRef(null)

  const names = useMemo(() => session ? session.families.map(f => f.name) : [], [session])
  const byName = useMemo(() => new Map((session?.families || []).map(f => [f.name, f])), [session])
  const profile = useMemo(() => profileFor(names), [names])

  // Opens one export (a log.tar, a zip, or a set of loose logs) and reads the logs the device type needs first.
  const openExport = useCallback(async (exp) => {
    setError(''); setBusy('Opening…')
    try {
      const s = await openFiles(exp.files, setBusy, exp.name)
      const all = s.families.map(f => f.name)
      const p = profileFor(all)
      const first = p ? p.firstFamilies.filter(n => all.includes(n)) : []
      for (const n of first) await loadFamily(s.families.find(f => f.name === n), setBusy)
      setSession(s); setOn(first); setTab('logs'); setJump(null)
    } catch (e) {
      setError(e.message || 'That file could not be read.')
    } finally { setBusy('') }
  }, [])

  // What a person chose or dropped: sort it into exports; open it straight away if there is only one, else let them pick.
  const ingest = useCallback(async (items, label) => {
    setError('')
    if (!items.length) { setError('Nothing was chosen.'); return }
    const f = findExports(items)
    if (!f.exports.length) { setError(`No logs were found in that (${items.length.toLocaleString('en-NZ')} files looked at). The Log Reader opens log.tar, .zip and .tar.gz exports and .log, .txt and .lzo files.`); return }
    setFound({ ...f, list: f.exports, label })
    if (f.exports.length === 1) await openExport(f.exports[0])
    else { setSession(null); setOn([]); setJump(null) }
  }, [openExport])

  const toggle = async (name) => {
    if (on.includes(name)) { setOn(on.filter(n => n !== name)); return }
    setError(''); setBusy('Reading…')
    try {
      await loadFamily(byName.get(name), setBusy)
      setOn([...on, name]); bump()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  // Tick every log: read the ones not read yet (one after another, saying how far it has got), then show them all together.
  const tickAll = async () => {
    const todo = session.families.filter(f => !f.lines)
    const bytes = todo.reduce((n, f) => n + f.files.reduce((m, x) => m + x.size, 0), 0)
    if (bytes > 100 * 1048576 && !(await confirm({
      title: 'Read all the logs?',
      message: `That is about ${mb(bytes)} still to read, and every line goes into this tab's memory. It can take a minute and slow the page down. You can untick logs afterwards.`,
      confirmLabel: 'Read them all',
    }))) return
    setError('')
    const failed = []
    try {
      for (const [i, f] of todo.entries()) {
        setBusy(`Reading ${i + 1} of ${todo.length}: ${f.name}…`)
        try { await loadFamily(f) } catch (e) { failed.push(f.name) }
      }
    } finally { setBusy('') }
    setOn(session.families.filter(f => f.lines).map(f => f.name)); bump()
    if (failed.length) setError(`${failed.length} log${failed.length === 1 ? '' : 's'} could not be read and ${failed.length === 1 ? 'was' : 'were'} left out: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}`)
  }
  const untickAll = () => setOn([])

  const lines = useMemo(() => mergeLines(on.map(n => byName.get(n).lines)), [on, byName])
  const close = () => { setSession(null); setFound(null); setOn([]); setJump(null); setError('') }

  const fam = profile?.families
  const backend = fam && byName.get(fam.backend)?.lines
  const print = fam && byName.get(fam.print)?.lines
  const hasShocks = !!(profile?.id === 'defib' && backend && print)
  const hasAlarms = byName.has(ALARM_FAMILY)
  const alarmLines = byName.get(ALARM_FAMILY)?.lines

  // The alarm records are in a log that may not have been opened yet: read it when its tab is first asked for.
  const openTab = async (t) => {
    if (t === 'alarms' && !alarmLines) {
      setError(''); setBusy('Reading…')
      try { await loadFamily(byName.get(ALARM_FAMILY), setBusy); bump() } catch (e) { setError(e.message); return } finally { setBusy('') }
    }
    setTab(t)
  }

  // `fams`: the logs to show together at that moment (default: the one the line is in)
  const showInLogs = (line, fams = [line.fam]) => {
    setOn(fams.filter(n => byName.has(n)))
    setTab('logs'); setJump({ t: line.t, line })
  }

  const pickFiles = (files, label) => { if (files && files.length) ingest(itemsFromInput(files), label) }
  const dropFiles = (e) => {
    e.preventDefault(); setDrag(false)
    setBusy('Looking through what you dropped…')
    // itemsFromDrop has to start inside this event, before anything is awaited
    itemsFromDrop(e.dataTransfer).then(items => ingest(items, 'what you dropped')).catch(err => setError(err.message || 'That could not be read.')).finally(() => setBusy(''))
  }
  const over = (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDrag(true) } }

  const input = <input ref={fileRef} type="file" multiple hidden accept=".tar,.zip,.gz,.tgz,.log,.txt,.lzo,.0,.1,.2,.3,.4,.5" onChange={e => { const f = [...e.target.files]; e.target.value = ''; pickFiles(f) }} />
  const dirInput = <input ref={dirRef} type="file" hidden webkitdirectory="" directory="" onChange={e => { const f = [...e.target.files]; e.target.value = ''; pickFiles(f, f[0]?.webkitRelativePath?.split('/')[0]) }} />

  // data-working: opened logs exist only in this tab, so the app must not reload onto a new version under them (shared/updateGuard.js).
  return (
    <div className="lr" onDragOver={over} onDragLeave={() => setDrag(false)} onDrop={dropFiles} data-drag={drag ? '' : undefined} data-working={session || found ? '' : undefined}>
      {input}{dirInput}{confirmDialog}
      <div className="lr-top">
        <h1 className="lr-title"><FileText size={20} aria-hidden /> Log Reader</h1>
        {session && <span className="lr-source" title={session.source}>{session.source}</span>}
        <span className="lr-privacy"><Lock size={14} aria-hidden /> Read on this device only. Nothing is uploaded or saved.</span>
        <span className="lr-spacer" />
        {session && found?.list.length > 1 && <Button variant="secondary" size="sm" iconLeft={<Folders size={16} />} onClick={() => { setSession(null); setOn([]); setJump(null) }}>All {found.list.length} exports</Button>}
        <Button variant="secondary" size="sm" iconLeft={<FolderOpen size={16} />} onClick={() => dirRef.current.click()} disabled={!!busy}>Open folder</Button>
        <Button variant="secondary" size="sm" onClick={() => fileRef.current.click()} disabled={!!busy}>Open files</Button>
        {(session || found) && <Button variant="ghost" size="sm" iconLeft={<X size={16} />} onClick={close}>Close logs</Button>}
      </div>

      {error && <Alert tone="critical" title="Couldn’t open that" className="lr-alert" action={<Button variant="ghost" size="sm" onClick={() => setError('')}>Dismiss</Button>}>{error}</Alert>}
      {busy && <div className="lr-busy" role="status"><Spinner size={18} /> {busy}</div>}

      {!session && found && found.list.length > 1 ? (
        <div className="lr-start">
          <div className="lr-picker">
            <h2>{found.list.length}{found.more ? '+' : ''} exports in {found.label || 'that folder'}</h2>
            <p className="lr-fine">Each log.tar, zip or set of loose log files is one device’s export. Pick one to read. Nothing is read until you do.</p>
            <ul>
              {found.list.map(e => (
                <li key={e.id}>
                  <button type="button" className="lr-exp" onClick={() => openExport(e)} disabled={!!busy}>
                    {e.kind === 'archive' ? <FileArchive size={20} aria-hidden /> : <FileText size={20} aria-hidden />}
                    <span className="lr-exp-t">
                      <span className="lr-exp-n">{e.name}</span>
                      <span className="lr-exp-s">{[e.detail, e.where && e.where !== e.name ? e.where : '', mb(e.size)].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {found.more > 0 && <p className="lr-fine">{found.more} more were found; choose a smaller folder to see them.</p>}
            {found.skipped > 0 && <p className="lr-fine">{found.skipped.toLocaleString('en-NZ')} other files in the folder aren’t logs and were left alone (pictures, documents, databases, crash dumps).</p>}
          </div>
        </div>
      ) : !session ? (
        <div className="lr-start">
          <div className="lr-drop">
            <FileText size={40} aria-hidden />
            <h2>Open a device’s logs</h2>
            <p>Drop a <b>folder</b> here and the Log Reader finds every export in it, or drop a device’s <b>log.tar</b> or service <b>.zip</b> (a defibrillator’s Orbit export, an A5 service export, a monitor’s log tar), or loose <b>.log</b>, <b>.txt</b> and <b>.lzo</b> files.</p>
            <div className="lr-drop-btns">
              <Button iconLeft={<FolderOpen size={16} />} onClick={() => dirRef.current.click()} disabled={!!busy}>Open a folder</Button>
              <Button variant="secondary" onClick={() => fileRef.current.click()} disabled={!!busy}>Choose files</Button>
            </div>
            <p className="lr-fine">Choosing a folder may make your browser say it will “upload” the files. That is just its wording: they stay on this device.</p>
            <p className="lr-fine">The logs are read in this browser tab and forgotten when you close it. They are not sent anywhere, saved in the hub or kept for next time.</p>
            <p className="lr-fine">Defibrillators get a shock-to-print table. Other Mindray devices open in the same viewer, and get their own extras as they are added.</p>
          </div>
        </div>
      ) : (
        <div className="lr-main">
          <aside className="lr-side" aria-label="Logs in this export">
            <div className="lr-side-h">{profile ? profile.name + ' export' : 'Logs'} · {session.families.length} logs</div>
            <div className="lr-side-btns">
              <Button variant="secondary" size="sm" onClick={tickAll} disabled={!!busy || on.length === session.families.length}>Tick all</Button>
              <Button variant="ghost" size="sm" onClick={untickAll} disabled={!!busy || !on.length}>Untick all</Button>
            </div>
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
            {session.skipped?.length > 0 && (
              <p className="lr-fine" title={[...new Set(session.skipped)].slice(0, 40).join(', ')}>
                {session.skipped.length.toLocaleString('en-NZ')} other files were not opened: screenshots, databases, binary data and crash dumps. The Log Reader only reads text logs.
              </p>
            )}
          </aside>

          <section className="lr-content">
            {(hasShocks || hasAlarms) && (
              <div className="lr-tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'logs'} className={tab === 'logs' ? 'on' : ''} onClick={() => openTab('logs')}>Log lines</button>
                {hasAlarms && <button role="tab" aria-selected={tab === 'alarms'} className={tab === 'alarms' ? 'on' : ''} onClick={() => openTab('alarms')}>Alarms</button>}
                {hasShocks && <button role="tab" aria-selected={tab === 'shocks'} className={tab === 'shocks' ? 'on' : ''} onClick={() => openTab('shocks')}>Shock events</button>}
              </div>
            )}
            {tab === 'shocks' && hasShocks
              ? <ShockTable backend={backend} print={print} onShow={(line) => showInLogs(line, profile.firstFamilies)} />
              : tab === 'alarms' && alarmLines
                ? <AlarmsTab lines={alarmLines} onShow={(line) => showInLogs(line, [ALARM_FAMILY])} />
                : <LogView lines={lines} famNames={on} profile={profile} jump={jump} />}
          </section>
        </div>
      )}
    </div>
  )
}

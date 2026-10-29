/* Settings: the staff list and leave, categories, statuses and activity types
   with their colours, archiving, the demo pool (and which demo tracker model
   names count as each model), and the state of the demo tracker feed. One
   document, projectSettings/main, shared by everyone. */

import { useEffect, useState } from 'react'
import { ArrowUp, ArrowDown, Trash2, Plus, RefreshCw } from 'lucide-react'
import { Alert, Badge, Button, Switch } from '../../../schedule/src/components/ui'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { Avatar, Field, Empty, Modal } from '../ui.jsx'
import { downloadBackup } from '../io.js'
import { readBackup, restorePlan } from '../backup.js'
import { syncedWhen, ago } from '../JobPanel.jsx'
import { initialsOf, isStage, pillStyle, rid, fmt } from '../model.js'

/** A text box that saves when you leave it. */
function Cell({ value, onSave, ...rest }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  return <input className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (String(v) !== String(value ?? '')) onSave(v) }}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} {...rest} />
}

export default function Settings() {
  const s = useStore()
  const ui = useUi()
  const ro = !s.canEdit
  const st = s.settings
  const save = (patch, msg) => s.saveSettings(patch).then(() => msg && ui.toast(msg)).catch((e) => ui.toast('Not saved: ' + e.message))
  const used = (field, value) => s.jobs.some((j) => j[field] === value)
  const move = (list, i, d) => { const n = [...list]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n }
  const hasSample = s.jobs.some((j) => j.sample)

  return (
    <div className="pt-page pt-settings">
      <div className="pt-pagehead"><h1 className="pt-h1">Settings</h1></div>
      {ro && <Alert tone="info" title="View only">Changing settings is for staff with a team, set in Settings → People and access.</Alert>}

      <section className="card pt-card">
        <div className="pt-card-head">
          <div className="pt-col"><h2 className="pt-h3">Staff</h2><span className="text-sm text-muted">People who can be put on jobs and weeks. Email links someone to "My jobs". Leave shows on the Timeline's By person layout.</span></div>
          {!ro && <Button size="sm" variant="secondary" iconLeft={<Plus size={15} />} onClick={() => save({ staff: [...st.staff, { id: rid(), name: 'New person', initials: 'NP', role: 'Engineering', email: '', leave: [] }] })}>Add staff member</Button>}
        </div>
        {st.staff.length === 0 && <Empty>No staff yet.</Empty>}
        <div className="pt-staff">
          {st.staff.map((p, i) => {
            const upd = (patch) => save({ staff: st.staff.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) })
            return (
              <div key={p.id} className="pt-staff-row">
                <Avatar person={p} size={32} />
                <Cell value={p.name} disabled={ro} aria-label="Name" onSave={(v) => upd({ name: v, initials: p.initials === initialsOf(p.name) ? initialsOf(v) : p.initials })} />
                <Cell value={p.initials} disabled={ro} aria-label="Initials" className="input pt-w-init" maxLength={4} onSave={(v) => upd({ initials: v.toUpperCase() })} />
                <select value={p.role} disabled={ro} aria-label="Role" onChange={(e) => upd({ role: e.target.value })}>
                  {['Engineering', 'Applications', 'Sales'].map((r) => <option key={r}>{r}</option>)}
                </select>
                <Cell value={p.email} disabled={ro} aria-label="Email" placeholder="Email (optional)" onSave={(v) => upd({ email: v.trim() })} />
                <div className="pt-leave">
                  {(p.leave || []).map((l, k) => (
                    <span key={k} className="tag">{fmt(l.from)} – {fmt(l.to)}{!ro && <button type="button" className="pt-x" aria-label="Remove leave" onClick={() => upd({ leave: p.leave.filter((_, n) => n !== k) })}>×</button>}</span>
                  ))}
                  {!ro && <LeaveAdd onAdd={(l) => upd({ leave: [...(p.leave || []), l] })} />}
                </div>
                {!ro && <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${p.name}`} onClick={() => {
                  if (s.assignments.some((a) => a.staffId === p.id) && !window.confirm(`${p.name} is booked on the timeline. Remove them from the staff list anyway? Their weeks stay but show as "?".`)) return
                  save({ staff: st.staff.filter((x) => x.id !== p.id) }, 'Removed')
                }}><Trash2 size={16} /></button>}
                {i === -1 && null}
              </div>
            )
          })}
        </div>
      </section>

      <div className="pt-cards pt-cards-2">
        <section className="card pt-card">
          <div className="pt-col"><h2 className="pt-h3">Categories</h2><span className="text-sm text-muted">The groups in Table and Timeline, in this order.</span></div>
          {st.categories.map((c, i) => (
            <div key={c.id} className="pt-swrow">
              <input type="color" value={c.color} disabled={ro} aria-label={`Colour for ${c.name}`} onChange={(e) => save({ categories: st.categories.map((x) => (x.id === c.id ? { ...x, color: e.target.value } : x)) })} />
              <Cell value={c.name} disabled={ro} aria-label="Category name" onSave={(v) => save({ categories: st.categories.map((x) => (x.id === c.id ? { ...x, name: v } : x)) })} />
              {!ro && <>
                <button type="button" className="icon-btn icon-btn-sm" disabled={i === 0} aria-label="Move up" onClick={() => save({ categories: move(st.categories, i, -1) })}><ArrowUp size={15} /></button>
                <button type="button" className="icon-btn icon-btn-sm" disabled={i === st.categories.length - 1} aria-label="Move down" onClick={() => save({ categories: move(st.categories, i, 1) })}><ArrowDown size={15} /></button>
                <button type="button" className="icon-btn icon-btn-sm" disabled={used('category', c.id)} title={used('category', c.id) ? 'Jobs use this category' : 'Remove'} aria-label="Remove category" onClick={() => save({ categories: st.categories.filter((x) => x.id !== c.id) })}><Trash2 size={15} /></button>
              </>}
            </div>
          ))}
          {!ro && <div><Button size="sm" variant="ghost" iconLeft={<Plus size={15} />} onClick={() => save({ categories: [...st.categories, { id: rid(), name: 'New category', color: '#968ac1' }] })}>Add category</Button></div>}
        </section>

        <section className="card pt-card">
          <div className="pt-col"><h2 className="pt-h3">Archiving</h2><span className="text-sm text-muted">Archived jobs keep everything and can be restored.</span></div>
          <Switch checked={st.askOnComplete} onChange={(v) => !ro && save({ askOnComplete: v })} label="Ask to archive when a job is set to Complete" />
          <Switch checked={st.autoArchive} onChange={(v) => !ro && save({ autoArchive: v })} label="Archive completed jobs automatically" />
          <Field label="Auto-archive delay" hint="Counted from the day the status changes to Complete. Also the delay offered when you're asked.">
            <select value={st.autoArchiveDays} disabled={ro} onChange={(e) => save({ autoArchiveDays: Number(e.target.value) })} style={{ maxWidth: 220 }}>
              {[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </Field>
        </section>

        <ColourList title="Statuses" hint="Waiting asks what the job is waiting on. Complete offers to archive." list={st.statuses} keyName="statuses" field="status" ro={ro} save={save} core={['Waiting', 'Complete']} used={used} />
        <ColourList title="Activity types" hint="What the Timeline's week cells show. Tick Job stage for ones that describe the job's week (Prep week, Go-live week, EST Testing…): those are set once on the job's week, not against each person. The rest are what a person is doing." list={st.activities} keyName="activities" ro={ro} save={save}
          used={(_, name) => s.assignments.some((a) => a.activity === name)} />
      </div>

      <section className="card pt-card">
        <div className="pt-card-head">
          <div className="pt-col"><h2 className="pt-h3">Demo pool</h2><span className="text-sm text-muted">Every model in the demo tracker is available to jobs and the Equipment view automatically, under its own name, with how many we own. This list is only for extras: a model's family and kind, other names it goes by in the demo tracker ("Demo tracker names", separated by commas, to count them as one), or a count for equipment the demo tracker doesn't hold. A model listed here that the demo tracker has none of, and no job asks for, stays out of the Equipment view.</span></div>
          {!ro && <Button size="sm" variant="secondary" iconLeft={<Plus size={15} />} onClick={() => save({ pool: [...st.pool, { model: 'New model', family: 'Accessories', kind: '', total: null }] })}>Add model</Button>}
        </div>
        <div className="pt-pool">
          <div className="pt-pool-row pt-pool-head overline"><span>Model</span><span>Family</span><span>Kind</span><span>Demo tracker names</span><span>In tracker</span><span>Units if not</span><span /></div>
          {st.pool.map((p, i) => {
            const upd = (patch) => save({ pool: st.pool.map((x, n) => (n === i ? { ...x, ...patch, sampleTotal: false } : x)) })
            const inUse = s.jobs.some((j) => (j.equipment || []).some((l) => l.model === p.model))
            return (
              <div key={i} className="pt-pool-row">
                <Cell value={p.model} disabled={ro || inUse} title={inUse ? 'Jobs use this model' : undefined} aria-label="Model" onSave={(v) => upd({ model: v.trim() })} />
                <Cell value={p.family} disabled={ro} aria-label="Family" list="pt-fams" onSave={(v) => upd({ family: v.trim() })} />
                <Cell value={p.kind} disabled={ro} aria-label="Kind" onSave={(v) => upd({ kind: v.trim() })} />
                <Cell value={p.match || ''} disabled={ro} aria-label={`Other names for ${p.model} in the demo tracker`} placeholder="e.g. BeneVision N19" onSave={(v) => upd({ match: v.split(',').map((x) => x.trim()).filter(Boolean).join(', ') })} />
                {(() => {
                  const names = s.feed.summary?.names[p.model]
                  const n = s.feed.summary?.owned[p.model] || 0
                  return <span className="pt-mono" title={names ? 'Matched: ' + Object.entries(names).map(([k, c]) => `${k} (${c})`).join(', ') : s.feed.summary ? 'No assets in the demo tracker match this model' : 'The demo tracker has not been read yet'}>{s.feed.summary ? n : '–'}</span>
                })()}
                <Cell value={p.total ?? ''} disabled={ro} aria-label="Units owned, if the demo tracker has none" type="number" min="0" placeholder="?" onSave={(v) => upd({ total: v === '' ? null : Math.max(0, Number(v)) })} />
                {!ro && <button type="button" className="icon-btn icon-btn-sm" disabled={inUse} aria-label="Remove model" onClick={() => save({ pool: st.pool.filter((_, n) => n !== i) })}><Trash2 size={15} /></button>}
              </div>
            )
          })}
          <datalist id="pt-fams">{[...new Set(st.pool.map((p) => p.family))].map((f) => <option key={f} value={f} />)}</datalist>
        </div>
      </section>

      <div className="pt-cards pt-cards-2">
        <FeedCard />

        <BackupCard />

        <section className="card pt-card">
          <h2 className="pt-h3">Import and sample data</h2>
          <p className="text-sm">Import a project tracker file (jobs, staff weeks, staff and activity colours together), or a job register from Excel or CSV.</p>
          {!ro && <div><Button size="sm" onClick={() => ui.openImport()}>Import from a file…</Button></div>}
          <p className="text-sm">Or load the sample jobs to try the tracker out: the jobs from the project team's sheets, a few archived ones, placeholder staff and pool sizes. They're marked as samples and come out again in one go.</p>
          {!ro && (
            <div className="pt-addrow">
              {!hasSample && <Button size="sm" variant="secondary" onClick={() => s.loadSample().then(() => ui.toast('Sample jobs loaded'))}>Load sample jobs</Button>}
              {hasSample && <Button size="sm" variant="secondary" onClick={() => window.confirm('Remove every sample job, its weeks and comments, the placeholder staff and sample pool sizes?') && s.removeSample().then(() => ui.toast('Sample data removed'))}>Remove sample data</Button>}
              {s.resetDev && <Button size="sm" variant="ghost" onClick={() => s.resetDev()}>Reset local dev data</Button>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** Nightly backups, and putting one back. */
function BackupCard() {
  const s = useStore()
  const ui = useUi()
  const [restoring, setRestoring] = useState(false)
  return (
    <section className="card pt-card">
      <div className="pt-col">
        <h2 className="pt-h3">Backups</h2>
        <span className="text-sm text-muted">Every night at 3am NZ time everything here (jobs, staff weeks, comments, history and these settings) is saved to Google Drive, in the folder <b>CMCHS Project Tracker Backups</b>, and kept for a year: a <b>.json</b> file to restore from, and an <b>.xlsx</b> to read.</span>
      </div>
      <div className="pt-addrow">
        <Button size="sm" variant="secondary" onClick={() => { downloadBackup(s); ui.toast('Backup downloaded') }}>Download a backup now</Button>
        {s.isAdmin && <Button size="sm" variant="secondary" onClick={() => setRestoring(true)}>Restore from a backup…</Button>}
      </div>
      {!s.isAdmin && <p className="text-sm text-muted">Restoring from a backup is for admins.</p>}
      {restoring && <RestoreDialog onClose={() => setRestoring(false)} />}
    </section>
  )
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

function RestoreDialog({ onClose }) {
  const s = useStore()
  const ui = useUi()
  const [backup, setBackup] = useState(null)
  const [msg, setMsg] = useState('')
  const [mode, setMode] = useState('merge')
  const [busy, setBusy] = useState(false)
  async function pick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBackup(null)
    try {
      const b = JSON.parse(await file.text())
      readBackup(b)
      setBackup(b)
      setMsg('')
    } catch (err) { setMsg(err instanceof SyntaxError ? 'That file is not a backup (it is not valid JSON).' : err.message) }
  }
  const plan = backup && restorePlan(readBackup(backup), { jobs: s.jobs, assignments: s.assignments, comments: s.comments, history: s.history, settings: s.settingsStored }, mode).summary
  const taken = backup?.takenAt ? new Date(backup.takenAt).toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'an unknown time'
  async function go() {
    if (!window.confirm(mode === 'exact'
      ? 'Make the tracker exactly as it was in this backup? Jobs and staff weeks added since will be removed. A copy of the tracker as it is now downloads first, so this can be undone.'
      : 'Put back everything from this backup? A copy of the tracker as it is now downloads first, so this can be undone.')) return
    setBusy(true)
    try {
      downloadBackup(s, 'before-restore')
      const r = await s.restoreBackup(backup, mode)
      ui.toast(r.notAppended
        ? `Restored. ${plural(r.notAppended, 'comment or history entry', 'comments or history entries')} could not be put back: the Firestore rules need updating`
        : 'Restored from the backup')
      onClose()
    } catch (err) { setMsg('Restore failed: ' + (err.message || err) + '. Nothing after the failure was changed; the copy that downloaded first has the tracker as it was.'); setBusy(false) }
  }
  const line = (label, x) => x && (
    <li><b>{label}:</b> {plural(x.inBackup, 'in the backup', 'in the backup')}{x.missing ? `, ${x.missing} missing now (put back)` : ''}{x.changed ? `, ${x.changed} changed since (put back as they were)` : ''}{x.added ? `, ${x.added} added since (${mode === 'exact' && x.removed ? 'removed' : 'kept'})` : ''}</li>
  )
  return (
    <Modal title="Restore from a backup" description="Choose a Project-Tracker-….json file: one from the CMCHS Project Tracker Backups folder in Google Drive, or one downloaded here." onClose={onClose} width={640}>
      <div className="pt-stack">
        <label className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>Choose a backup…<input type="file" accept=".json,application/json" onChange={pick} hidden /></label>
        {msg && <p className="text-sm pt-bad">{msg}</p>}
        {plan && (
          <>
            <p className="text-sm">Backup taken <b>{taken}</b>{backup.source === 'nightly' ? ' (nightly)' : backup.source === 'before-restore' ? ' (just before a restore)' : ' (downloaded)'}.</p>
            <div className="pt-col">
              <label className="pt-check"><input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} /><span><b>Put back what's missing or changed.</b> Jobs, staff weeks and settings go back to how they were in the backup. Anything added since stays.</span></label>
              <label className="pt-check"><input type="radio" name="mode" checked={mode === 'exact'} onChange={() => setMode('exact')} /><span><b>Make it exactly as it was.</b> The same, and jobs and staff weeks added since the backup are removed.</span></label>
            </div>
            <ul className="text-sm pt-restore-list">
              {line('Jobs', plan.jobs)}
              {line('Staff weeks', plan.assignments)}
              {line('Comments', plan.comments)}
              {line('History', plan.history)}
              <li><b>Settings:</b> {plan.settingsChanged ? 'changed since (put back as they were)' : 'the same'}</li>
            </ul>
            <p className="text-sm text-muted">Comments and history are never removed or changed, only put back if missing. A copy of the tracker as it is now downloads before anything changes, so a restore can itself be undone by restoring that copy.</p>
            <div className="pt-addrow"><span className="pt-grow" />
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={busy || plan.changes === 0} onClick={go}>{plan.changes === 0 ? 'Nothing to restore' : busy ? 'Restoring…' : 'Restore'}</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/** The demo tracker connection: where the figures come from and how fresh they are. */
function FeedCard() {
  const s = useStore()
  const f = s.feed
  const sum = f.summary
  const state = f.ok ? 'live' : f.raw ? (f.failedAt ? 'stale' : 'cached') : (f.failedAt ? 'down' : 'connecting')
  const badge = {
    live: ['green', 'Live'], stale: ['orange', 'Out of date'], down: ['critical', 'Not connected'],
    cached: ['neutral', 'Checking…'], connecting: ['neutral', 'Connecting…'],
  }[state]
  const qty = (list) => list.reduce((t, x) => t + x.qty, 0)
  const units = (list) => { const n = qty(list); const k = new Set(list.map((x) => x.key)).size; return `${n} unit${n === 1 ? '' : 's'} on ${k} loan${k === 1 ? '' : 's'}` }
  const out = sum ? sum.loans.filter((x) => x.out) : []
  const ahead = sum ? sum.loans.filter((x) => !x.out) : []
  const matched = sum ? Object.values(sum.owned).reduce((t, n) => t + n, 0) : 0
  const [all, setAll] = useState(false)
  const unmatched = sum ? (all ? sum.unmatched : sum.unmatched.slice(0, 12)) : []
  return (
    <section className={`card pt-card ${state === 'live' ? 'cap-green' : state === 'stale' || state === 'down' ? 'cap-orange' : 'cap-purple'}`}>
      <div className="pt-card-head"><h2 className="pt-h3">Demo tracker connection</h2><Badge tone={badge[0]}>{badge[1]}</Badge></div>
      <p className="text-sm">Units owned, which are out or booked out, where, and when they're due back, read from the demo tracker (demo.chsnz.co.nz). Read-only: nothing here changes the demo tracker. Read when this opens, every 10 minutes and on Refresh; the last good read stays on this device for when it can't connect.</p>
      <dl className="pt-facts">
        <dt>Last synced</dt><dd>{f.at ? `${syncedWhen(f.at)} (${ago(f.at)})` : 'Not yet'}</dd>
        {f.failedAt && !f.ok && <><dt>Last attempt</dt><dd className="pt-bad">{syncedWhen(f.failedAt)}: {f.error}</dd></>}
        {sum && <>
          <dt>Assets</dt><dd>{sum.assets} in the register, {matched} of them counted as pool models</dd>
          <dt>Out now</dt><dd>{units(out)}{out.some((x) => x.due && x.due < s.today) ? `, ${qty(out.filter((x) => x.due && x.due < s.today))} overdue` : ''}</dd>
          <dt>Booked ahead</dt><dd>{units(ahead)}</dd>
        </>}
      </dl>
      {sum && sum.unmatched.length > 0 && (
        <p className="text-sm">
          <span className="text-muted">In the demo tracker under their own name (no entry in the Demo pool list): </span>
          {unmatched.map((u) => `${u.name} (${u.count})`).join(', ')}
          {sum.unmatched.length > 12 && <>{' '}<button type="button" className="pt-linkbtn" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `and ${sum.unmatched.length - 12} more`}</button></>}
          <span className="text-muted">. To count one as a listed model instead (say two spellings of the same thing), add its name under Demo tracker names above.</span>
        </p>
      )}
      <div><Button size="sm" variant="secondary" iconLeft={<RefreshCw size={14} className={f.loading ? 'pt-spin' : ''} />} disabled={f.loading} onClick={() => f.refresh()}>{f.loading ? 'Refreshing…' : 'Refresh now'}</Button></div>
    </section>
  )
}

function LeaveAdd({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  if (!open) return <button type="button" className="link-btn" onClick={() => setOpen(true)}>+ Leave</button>
  return (
    <span className="pt-addrow">
      <input className="input pt-w-date" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (!to) setTo(e.target.value) }} aria-label="Leave from" />
      <input className="input pt-w-date" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Leave to" />
      <Button size="sm" disabled={!from || !to || to < from} onClick={() => { onAdd({ from, to }); setOpen(false); setFrom(''); setTo('') }}>Add</Button>
      <button type="button" className="link-btn" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  )
}

function ColourList({ title, hint, list, keyName, field, ro, save, core = [], used }) {
  const upd = (i, patch) => save({ [keyName]: list.map((x, n) => (n === i ? { ...x, ...patch } : x)) })
  const [name, setName] = useState('')
  return (
    <section className="card pt-card">
      <div className="pt-col"><h2 className="pt-h3">{title}</h2><span className="text-sm text-muted">{hint}</span></div>
      <div className="pt-swgrid">
        {list.map((x, i) => {
          const inUse = used(field, x.name)
          return (
            <div key={x.name} className="pt-swrow">
              <input type="color" value={x.color} disabled={ro} aria-label={`Colour for ${x.name}`} onChange={(e) => upd(i, { color: e.target.value })} />
              <span className="pt-pill" style={pillStyle(x)}>{x.name}</span>
              {keyName === 'activities' && <label className="pt-check text-sm" title="Describes the job's week, not what a person does"><input type="checkbox" checked={isStage(x)} disabled={ro} onChange={(e) => upd(i, { stage: e.target.checked })} />Job stage</label>}
              <label className="pt-check text-sm" title="Draw as an outline instead of a fill"><input type="checkbox" checked={!!x.outline} disabled={ro} onChange={(e) => upd(i, { outline: e.target.checked, dashed: e.target.checked && x.dashed })} />Outline</label>
              <span className="pt-grow" />
              {!ro && !core.includes(x.name) && <button type="button" className="icon-btn icon-btn-sm" disabled={inUse} title={inUse ? 'In use' : 'Remove'} aria-label={`Remove ${x.name}`} onClick={() => save({ [keyName]: list.filter((_, n) => n !== i) })}><Trash2 size={15} /></button>}
            </div>
          )
        })}
      </div>
      {!ro && (
        <form className="pt-addrow" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n || list.some((x) => x.name === n)) return; save({ [keyName]: [...list, { name: n, color: '#968ac1' }] }); setName('') }}>
          <input className="input" placeholder={`New ${title.toLowerCase().replace(/s$/, '').replace('activity type', 'activity')}`} value={name} onChange={(e) => setName(e.target.value)} aria-label={`New ${title}`} />
          <Button size="sm" variant="ghost" type="submit" iconLeft={<Plus size={15} />}>Add</Button>
        </form>
      )}
    </section>
  )
}

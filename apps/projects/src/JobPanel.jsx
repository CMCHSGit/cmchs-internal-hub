/* The job side panel: every field, the equipment needed, the notes log,
   action points, comments and history, without leaving the page underneath.
   Archived jobs open here too, read-only, with Restore and Use as template. */

import { useEffect, useMemo, useState } from 'react'
import { X, Copy, Printer, Trash2, RotateCcw, Lock, RefreshCw, Plus, ClipboardList, AlertTriangle } from 'lucide-react'
import { Alert, Badge, Button } from '../../schedule/src/components/ui'
import { useStore } from './store.jsx'
import { useUi } from './App.jsx'
import { StatusPill, Avatar, StaffPicker, Field, Empty, ActivityChip, Priority, Modal } from './ui.jsx'
import {
  PRIORITIES, LINE_STATUSES, WAITING, availability, fmt, fmtY, fmtRange, todayISO, rid, duplicateOf, templateFrom, dueBack,
  linkableLoans, entryWho, linesNeedingLoan, isISO,
} from './model.js'
import { loanPlace, matchModel } from './feed.js'

const TABS = [['details', 'Details'], ['equipment', 'Equipment'], ['notes', 'Notes & actions'], ['comments', 'Comments'], ['history', 'History']]

export default function JobPanel({ job, onClose }) {
  const s = useStore()
  const ui = useUi()
  const [tab, setTab] = useState('details')
  const readOnly = job.archived || !s.canEdit
  const cat = s.catById.get(job.category)
  const openActions = (job.actions || []).filter((a) => !a.done).length
  const comments = s.comments.filter((c) => c.jobId === job.id)
  const editors = s.online.filter((p) => p.jobId === job.id && p.id !== s.me.uid)

  async function duplicate(template) {
    const fields = template ? { ...templateFrom(job), fromTemplate: job.name } : duplicateOf(job)
    const id = await s.createJob(fields)
    ui.toast(template ? 'New job started from the template' : 'Job duplicated')
    ui.openJob(id, 'table')
  }
  async function remove() {
    if (!window.confirm(`Delete "${job.name}" for everyone? Its weeks on the timeline and its comments go too. This can't be undone.\n\nTo keep a record instead, set it to Complete and archive it.`)) return
    await s.deleteJob(job)
    ui.toast('Job deleted')
    onClose()
  }

  return (
    <aside className="pt-panel" aria-label={`Job: ${job.name}`}>
      {job.archived
        ? <div className="pt-panel-cap" style={{ background: 'var(--text-muted)' }} />
        : <div className="stripe-rule" style={{ height: 4 }} aria-hidden="true"><span /><span /><span /></div>}
      <div className={`pt-panel-head${job.archived ? ' archived' : ''}`}>
        <div className="pt-panel-title">
          <div className="pt-panel-over">
            {job.archived && <Badge tone="neutral">Archived</Badge>}
            {readOnly && <span className="pt-ro"><Lock size={13} aria-hidden="true" /> Read only</span>}
            <span className="overline">{cat?.name || 'No category'}</span>
          </div>
          {readOnly
            ? <h2 className="pt-h3">{job.name}</h2>
            : <TextEdit className="pt-name-input" value={job.name} label="Job name" onSave={(v) => s.updateJob(job.id, { name: v }, `renamed the job to "${v}"`)} />}
          <div className="pt-panel-meta">
            <StatusPill status={job.status} />
            <Priority value={job.priority} />
            <span className="text-sm text-muted">{fmtRange(job.start, job.end)}</span>
            {job.archived && job.completedAt && <span className="text-sm text-muted">· completed {fmtY(job.completedAt)}</span>}
          </div>
          {editors.length > 0 && (
            <div className="pt-editing">{editors.map((p) => p.name.split(' ')[0]).join(' and ')} {editors.length === 1 ? 'has' : 'have'} this job open too. Changes show for everyone as they're made.</div>
          )}
        </div>
        <button type="button" className="icon-btn icon-btn-md" aria-label="Close panel" title="Close (Esc)" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="pt-panel-actions">
        {job.archived ? (
          <>
            {s.canEdit && <Button size="sm" iconLeft={<Copy size={15} />} onClick={() => duplicate(true)}>Use as template</Button>}
            {s.canEdit && <Button size="sm" variant="secondary" iconLeft={<RotateCcw size={15} />} onClick={() => s.restoreJob(job).then(() => { ui.toast('Restored to active, as Planning'); ui.openJob(job.id, 'table') })}>Restore</Button>}
          </>
        ) : (
          <>
            {s.canEdit && <Button size="sm" variant="secondary" iconLeft={<Copy size={15} />} onClick={() => duplicate(false)}>Duplicate</Button>}
            {s.canEdit && job.status === 'Complete' && <Button size="sm" variant="secondary" onClick={() => ui.askArchive(job)}>Archive…</Button>}
          </>
        )}
        <Button size="sm" variant="ghost" iconLeft={<Printer size={15} />} onClick={() => { document.body.classList.add('pt-print-panel'); window.print(); setTimeout(() => document.body.classList.remove('pt-print-panel'), 500) }}>PDF</Button>
        {s.canEdit && <Button size="sm" variant="ghost" iconLeft={<Trash2 size={15} />} onClick={remove}>Delete</Button>}
      </div>
      {job.archived && <p className="pt-panel-note text-sm text-muted">Use as template copies the equipment, team and category. Dates and notes start empty. Restore puts it back in the Table as Planning.</p>}
      {!job.archived && job.autoArchiveOn && (
        <div className="pt-pad-x"><Alert tone="info" title={`Archives on ${fmtY(job.autoArchiveOn)}`} action={s.canEdit && <Button size="sm" variant="ghost" onClick={() => s.keepActive(job)}>Keep active</Button>} /></div>
      )}

      <div className="pt-tabs" role="tablist">
        {TABS.map(([id, label]) => {
          const n = id === 'notes' ? openActions : id === 'comments' ? comments.length : id === 'equipment' ? (job.equipment || []).length : 0
          return (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pt-tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
              {label}{n > 0 && <span className="pt-tab-n">{n}</span>}
              {id === 'equipment' && linesNeedingLoan(job).length > 0 && <span className="pt-tab-dot" title="Equipment without a demo loan form yet" />}
            </button>
          )
        })}
      </div>

      <div className="pt-panel-body">
        {tab === 'details' && <Details job={job} readOnly={readOnly} />}
        {tab === 'equipment' && <EquipmentNeeded job={job} readOnly={readOnly} />}
        {tab === 'notes' && <NotesActions job={job} readOnly={readOnly} />}
        {tab === 'comments' && <Comments job={job} comments={comments} readOnly={!s.canEdit} />}
        {tab === 'history' && <History job={job} />}
      </div>
    </aside>
  )
}

/** An input that saves when you leave it (or press Enter), and follows other people's edits while you're not in it. */
function TextEdit({ value, onSave, label, type = 'text', className = 'input', placeholder, list, disabled }) {
  const [v, setV] = useState(value || '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setV(value || '') }, [value, focused])
  const commit = () => { setFocused(false); if ((v || '') !== (value || '')) onSave(v) }
  return (
    <input className={className} type={type} value={v} aria-label={label} placeholder={placeholder} list={list} disabled={disabled}
      onFocus={() => setFocused(true)} onChange={(e) => { setV(e.target.value); if (type === 'date') { setFocused(false); onSave(e.target.value) } }}
      onBlur={type === 'date' ? undefined : commit}
      onKeyDown={(e) => { if (e.key === 'Enter' && type !== 'date') e.currentTarget.blur() }} />
  )
}

function Details({ job, readOnly }) {
  const s = useStore()
  const ui = useUi()
  const regions = useMemo(() => [...new Set(s.jobs.map((j) => j.region).filter(Boolean))].sort(), [s.jobs])
  const owners = useMemo(() => [...new Set([...s.jobs.map((j) => j.owner), ...s.online.map((p) => p.name)].filter(Boolean))].sort(), [s.jobs, s.online])
  const weeks = s.assignments.filter((a) => a.jobId === job.id).sort((a, b) => a.week.localeCompare(b.week))
  const save = (field, label) => (v) => s.updateJob(job.id, { [field]: v }, `changed ${label} to ${v ? `"${v}"` : 'blank'}`)
  const saveDate = (field, label) => (v) => s.updateJob(job.id, { [field]: v }, `changed ${label} to ${v ? fmt(v) : 'blank'}`)
  const f = job.freight || {}

  async function status(v) {
    const ask = await s.setStatus(job, v)
    if (ask) ui.askArchive(job)
  }

  return (
    <div className="pt-stack">
      {job.status === WAITING && (
        <div className="pt-waiting">
          <Field label="Waiting on" hint={job.waitingSince ? `Since ${fmt(job.waitingSince)}. Clears when the status moves on.` : undefined}>
            <TextEdit value={job.waitingOn} placeholder="Wi-Fi changes, PO, parts, customer…" disabled={readOnly} label="Waiting on"
              onSave={(v) => s.updateJob(job.id, { waitingOn: v }, `set Waiting on to "${v}"`)} list="pt-waiting-list" />
          </Field>
          <datalist id="pt-waiting-list">{['Wi-Fi changes', 'PO', 'Parts', 'Customer', 'Freight', 'IT'].map((x) => <option key={x} value={x} />)}</datalist>
        </div>
      )}
      <div className="pt-grid2">
        <Field label="Status">
          <select value={job.status} disabled={readOnly} onChange={(e) => status(e.target.value)}>
            {s.settings.statuses.map((x) => <option key={x.name}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={job.priority} disabled={readOnly} onChange={(e) => s.updateJob(job.id, { priority: e.target.value }, `changed Priority to ${e.target.value}`)}>
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Status note" className="pt-span2" hint="Anything the status alone doesn't say, e.g. &quot;est leaving Mindray 23/10&quot;.">
          <TextEdit value={job.statusNote} disabled={readOnly} label="Status note" onSave={(v) => s.updateJob(job.id, { statusNote: v }, `set the Status note to "${v}"`)} />
        </Field>
        <Field label="Category" className="pt-span2">
          <select value={job.category} disabled={readOnly} onChange={(e) => s.updateJob(job.id, { category: e.target.value }, `moved the job to ${s.catById.get(e.target.value)?.name}`)}>
            {s.settings.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Customer / hospital"><TextEdit value={job.customer} disabled={readOnly} label="Customer" onSave={save('customer', 'Customer')} /></Field>
        <Field label="Region"><TextEdit value={job.region} disabled={readOnly} label="Region" onSave={save('region', 'Region')} list="pt-regions" /></Field>
        <datalist id="pt-regions">{regions.map((r) => <option key={r} value={r} />)}</datalist>
        <Field label="Planned start"><TextEdit type="date" value={job.start} disabled={readOnly} label="Planned start" onSave={saveDate('start', 'Planned start')} /></Field>
        <Field label="Planned end"><TextEdit type="date" value={job.end} disabled={readOnly} label="Planned end" onSave={saveDate('end', 'Planned end')} /></Field>
        <Field label="Project manager"><TextEdit value={job.owner} disabled={readOnly} label="Project manager" onSave={save('owner', 'Project manager')} list="pt-owners" /></Field>
        <datalist id="pt-owners">{owners.map((r) => <option key={r} value={r} />)}</datalist>
      </div>

      <section className="pt-sec">
        <h3 className="pt-h4">Team</h3>
        <div className="pt-grid2">
          <Field label="Engineering"><StaffPicker value={job.eng || []} roles={['Engineering']} disabled={readOnly} onChange={(v) => s.updateJob(job.id, { eng: v }, 'changed the Engineering team')} /></Field>
          <Field label="Applications / sales"><StaffPicker value={job.apps || []} roles={['Applications', 'Sales']} disabled={readOnly} onChange={(v) => s.updateJob(job.id, { apps: v }, 'changed the Applications / sales team')} /></Field>
        </div>
      </section>

      <section className="pt-sec">
        <h3 className="pt-h4">Customer lead</h3>
        <div className="pt-grid2">
          <Field label="Name"><TextEdit value={job.lead?.name} disabled={readOnly} label="Customer lead name" onSave={(v) => s.updateJob(job.id, { lead: { ...(job.lead || {}), name: v } }, 'changed the Customer lead')} /></Field>
          <Field label="Contact"><TextEdit value={job.lead?.contact} disabled={readOnly} label="Customer lead contact" placeholder="Phone or email" onSave={(v) => s.updateJob(job.id, { lead: { ...(job.lead || {}), contact: v } }, 'changed the Customer lead contact')} /></Field>
        </div>
      </section>

      <section className="pt-sec">
        <h3 className="pt-h4">Freight</h3>
        <div className="pt-grid2">
          <Field label="Tracking number"><TextEdit className="input pt-mono" value={f.tracking} disabled={readOnly} label="Tracking number" onSave={(v) => s.updateJob(job.id, { freight: { ...f, tracking: v } }, `set Freight tracking to ${v || 'blank'}`)} /></Field>
          <Field label="ETA"><TextEdit type="date" value={f.eta} disabled={readOnly} label="Freight ETA" onSave={(v) => s.updateJob(job.id, { freight: { ...f, eta: v } }, `set Freight ETA to ${v ? fmt(v) : 'blank'}`)} /></Field>
          <Field label="Where it is" className="pt-span2">
            <select value={f.state || (f.arrived ? 'At office' : '')} disabled={readOnly} onChange={(e) => s.updateJob(job.id, { freight: { ...f, state: e.target.value, arrived: e.target.value === 'At office' || e.target.value === 'Delivered to site' } }, `set Freight to ${e.target.value || 'not shipped'}`)}>
              <option value="">Not shipped yet</option>
              <option>In transit</option>
              <option>Arrived in NZ</option>
              <option>At office</option>
              <option>Delivered to site</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="pt-sec">
        <div className="pt-sec-head"><h3 className="pt-h4">Staff by week</h3><a href={`#/timeline?job=${job.id}`} className="link-btn">Open timeline</a></div>
        {weeks.length === 0 ? <Empty>No one booked yet. Add people on the Timeline.</Empty> : (
          <ul className="pt-list">
            {weeks.map((a) => {
              const p = s.staffById.get(a.staffId)
              return (
                <li key={a.id} className="pt-row">
                  <span className="pt-wk">{fmt(a.week)}</span>
                  <Avatar person={p} size={26} />
                  <span className="pt-grow">{p?.name || 'Someone no longer on the staff list'}</span>
                  <ActivityChip activity={a.activity} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

/** 14:05 today, else 12-Oct 14:05. */
export function syncedWhen(ms) {
  const d = new Date(ms)
  const t = d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })
  return todayISO(d) === todayISO() ? t : `${fmt(todayISO(d))} ${t}`
}
export function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} days ago`
}

/** One demo tracker loan in words: "2 at Tauranga Hospital, ICU · out 05-Oct – 30-Oct". */
export const loanText = (x) => `${x.qty} at ${loanPlace(x) || 'an unnamed loan'} · ${x.out ? 'out' : 'booked'} ${fmtRange(x.start, x.due)}`

/**
 * Where the demo tracker figures stand: live, still connecting, or the last
 * good read shown out of date because the latest one failed.
 */
export function FeedStatus({ compact = false }) {
  const s = useStore()
  const f = s.feed
  const sum = f.summary
  const state = f.ok ? 'live' : f.raw ? (f.failedAt ? 'stale' : 'cached') : (f.failedAt ? 'down' : 'connecting')
  const dot = { live: 'var(--chs-green)', stale: 'var(--chs-orange)', down: 'var(--status-critical)' }[state] || 'var(--border-strong, #a7a9ac)'
  const units = sum ? Object.values(sum.owned).reduce((t, n) => t + n, 0) : 0
  const outNow = sum ? sum.loans.filter((x) => x.out).reduce((t, x) => t + x.qty, 0) : 0
  const title = {
    live: 'Demo tracker: live',
    cached: 'Demo tracker: checking…',
    stale: 'Demo tracker: out of date',
    connecting: 'Demo tracker: connecting…',
    down: 'Demo tracker: not connected',
  }[state]
  let detail = ''
  if (state === 'live') {
    detail = `Last synced ${syncedWhen(f.at)} (${ago(f.at)})` + (compact ? '.' : ` · ${units} units across ${Object.keys(sum.owned).length} models, ${outNow} out now.`)
  } else if (state === 'cached') {
    detail = `Showing the figures from ${syncedWhen(f.at)} while it refreshes.`
  } else if (state === 'stale') {
    detail = `Couldn't refresh${compact ? '' : ` (${f.error})`}. These figures are from ${syncedWhen(f.at)}, ${ago(f.at)}.`
  } else if (state === 'down') {
    detail = `${compact ? 'Could not read it' : f.error}. Pool sizes come from Settings until it connects.`
  }
  return (
    <div className={`pt-feed pt-feed-${state}${compact ? ' compact' : ''}`} role={state === 'stale' || state === 'down' ? 'status' : undefined}>
      <span className="pt-feed-dot" style={{ background: dot }} />
      <span className="pt-grow">
        <b>{title}</b>
        {detail && <span className="text-sm text-muted">{' '}{detail}</span>}
      </span>
      <Button size="sm" variant="ghost" iconLeft={<RefreshCw size={14} className={f.loading ? 'pt-spin' : ''} />} disabled={f.loading} onClick={() => f.refresh()}>
        {f.loading ? 'Refreshing…' : 'Refresh'}
      </Button>
    </div>
  )
}

function EquipmentNeeded({ job, readOnly }) {
  const s = useStore()
  const today = todayISO()
  const lines = job.equipment || []
  const families = useMemo(() => {
    const m = new Map()
    for (const p of s.pool) {
      if (!m.has(p.family)) m.set(p.family, [])
      m.get(p.family).push(p)
    }
    return [...m]
  }, [s.pool])
  const edit = (id, patch, what) => s.mutateJob(job.id, (cur) => ({ equipment: (cur.equipment || []).map((l) => (l.id === id ? { ...l, ...patch } : l)) }), what)
  const add = () => s.mutateJob(job.id, (cur) => ({ equipment: [...(cur.equipment || []), { id: rid(), model: s.settings.pool[0]?.model || '', qty: 1, line: 'Requested' }] }), 'added an equipment line')
  const del = (l) => s.mutateJob(job.id, (cur) => ({ equipment: (cur.equipment || []).filter((x) => x.id !== l.id) }), `removed ${l.qty}x ${l.model}`)
  const need = linesNeedingLoan(job)
  const [loanOpen, setLoanOpen] = useState(false)
  // How many of each model are free for this job's dates, for the picker
  const freeFor = useMemo(() => new Map(s.pool.map((p) => [p.model, availability(s.jobs, s.pool, { model: p.model, qty: 0, job, today, loans: s.loans })])), [s.pool, s.jobs, s.loans, job, today])

  return (
    <div className="pt-stack">
      <FeedStatus compact />
      <p className="text-sm">
        Availability is worked out for {job.start || job.end ? <b>{fmtRange(job.start, job.end)}</b> : 'this job’s dates'}, counting units reserved by any other job on overlapping dates, units the demo tracker has out or booked then, and anything overdue back.
      </p>
      {need.length > 0 && !readOnly && (
        <div className="pt-loanbar">
          <ClipboardList size={16} aria-hidden="true" />
          <span className="pt-grow text-sm"><b>No demo loan form yet</b> for {need.map((l) => `${l.qty}x ${l.model}`).join(', ')}. Make it in the demo tracker once the job is confirmed, so the units are held for it.</span>
          <Button size="sm" variant="secondary" onClick={() => setLoanOpen(true)}>Create loan form</Button>
        </div>
      )}
      {loanOpen && <LoanFormDialog job={job} onClose={() => setLoanOpen(false)} />}
      {lines.length === 0 && <Empty>No equipment requested yet.</Empty>}
      {lines.map((l) => {
        const a = availability(s.jobs, s.pool, { model: l.model, qty: l.qty, job, today, loans: s.loans })
        const out = a.entries.filter((e) => (e.loan ? e.loan.out : ['Shipped', 'At site'].includes(e.line.line)))
        const fromFeed = s.pool.find((p) => p.model === l.model)?.fromFeed
        const linked = l.loan && s.loans ? s.loans.find((x) => x.key === l.loan && x.model === l.model) || null : null
        const canLink = !readOnly && !l.loan && l.line !== 'Returned' && s.loans ? linkableLoans(s.jobs, s.loans, { model: l.model, job, today }) : []
        const level = a.noDates ? 'unknown' : a.owned == null ? 'unknown' : a.short > 0 ? 'short' : a.free === Number(l.qty) ? 'tight' : 'ok'
        return (
          <div key={l.id} className={`pt-eqline ${level}`}>
            <div className="pt-eqline-row">
              <select value={l.model} disabled={readOnly} aria-label="Model" onChange={(e) => edit(l.id, { model: e.target.value }, `changed an equipment line to ${e.target.value}`)}>
                {!s.pool.some((p) => p.model === l.model) && <option>{l.model}</option>}
                {families.map(([fam, models]) => (
                  <optgroup key={fam} label={fam}>
                    {models.map((p) => {
                      const f = freeFor.get(p.model)
                      const count = f && !f.noDates && f.owned != null ? ` (${f.free} of ${f.owned} free)` : p.total != null ? ` (${p.total})` : ''
                      return <option key={p.model} value={p.model}>{p.model}{p.kind ? ` · ${p.kind}` : ''}{count}</option>
                    })}
                  </optgroup>
                ))}
              </select>
              <input className="input pt-qty" type="number" min="1" value={l.qty} disabled={readOnly} aria-label="Quantity"
                onChange={(e) => edit(l.id, { qty: Math.max(1, Number(e.target.value) || 1) })} />
              <select value={l.line} disabled={readOnly} aria-label="Status" onChange={(e) => edit(l.id, { line: e.target.value }, `set ${l.model} to ${e.target.value}`)}>
                {LINE_STATUSES.map((x) => <option key={x}>{x}</option>)}
              </select>
              {!readOnly && <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${l.model}`} onClick={() => del(l)}><X size={16} /></button>}
            </div>
            <div className="pt-eqline-facts">
              <span><b>{a.owned ?? '?'}</b> owned{fromFeed ? ' (demo tracker)' : a.owned != null ? ' (from Settings)' : ''}</span>
              <span className={level === 'short' ? 'pt-bad' : level === 'tight' ? 'pt-warn' : 'pt-ok'}><b>{a.free ?? '?'}</b> free for these dates</span>
              {linked ? linked.out && <span>Due back {fmt(linked.due) || 'not set'} (demo tracker)</span> : ['Shipped', 'At site'].includes(l.line) && <span>Due back {fmt(dueBack(job, l)) || 'not set'}</span>}
              {l.note && <span className="pt-mono">{l.note}</span>}
            </div>
            {l.loan && (
              <p className="text-sm pt-linked">
                {linked ? <>Demo tracker loan: {loanText(linked)}{linked.assets.length > 0 && <span className="pt-mono"> · {linked.assets.join(', ')}</span>}</>
                  : s.loans ? 'The demo tracker has the units from its linked loan back.' : 'Linked to a demo tracker loan.'}
                {!readOnly && <>{' '}<button type="button" className="pt-linkbtn" onClick={() => edit(l.id, { loan: '' }, `unlinked ${l.model} from its demo tracker loan`)}>Unlink</button></>}
              </p>
            )}
            {canLink.length > 0 && (
              <div className="text-sm pt-col">
                <span className="text-muted">The demo tracker has {l.model} out or booked around these dates. If one of these loans is this job's units, link it so they're counted once:</span>
                {canLink.map((x) => (
                  <span key={x.key}>{loanText(x)}{' '}
                    <button type="button" className="pt-linkbtn" onClick={() => edit(l.id, { loan: x.key }, `linked ${l.model} to the demo tracker loan at ${loanPlace(x) || 'an unnamed loan'}`)}>These are this job's</button>
                  </span>
                ))}
              </div>
            )}
            {a.owned == null && !a.noDates && <p className="text-sm text-muted">Pool size for {l.model} not known: the demo tracker has no units under that name. Add the name it uses, or a count, under Demo pool in Settings.</p>}
            {a.noDates && <p className="text-sm text-muted">Add planned dates to check availability.</p>}
            {level === 'short' && <p className="pt-bad text-sm"><b>Short by {a.short}.</b> More requested than are free for these dates.</p>}
            {out.length > 0 && (
              <p className="text-sm">Currently out: {out.map((e, i) => (
                <span key={i}>{i > 0 && '; '}{e.qty} at {e.job ? e.job.customer || e.job.name : entryWho(e)}, {(() => { const due = e.loan?.due || (e.job ? dueBack(e.job, e.line) : ''); return e.overdue ? <b className="pt-bad">overdue since {fmt(due)}</b> : due ? `due back ${fmt(due)}` : 'no due date' })()}</span>
              ))}</p>
            )}
            {a.entries.length > 0 && (
              <p className={`pt-eqwarn text-sm${level === 'short' ? ' bad' : ''}`}>
                <AlertTriangle size={14} aria-hidden="true" />
                <span><b>Also wanted on these dates:</b> {a.entries.map((e, i) => (
                  <span key={i}>{i > 0 && ', '}{e.job ? <a href={`#/${e.job.archived ? 'archive' : 'table'}?job=${e.job.id}`}>{e.job.name}</a> : <>{entryWho(e)} <span className="text-muted">(demo tracker)</span></>} ({e.qty})</span>
                ))}{a.owned != null && !a.noDates ? `. ${a.free} of ${a.owned} left for this job.` : '.'}</span>
              </p>
            )}
            {!readOnly && !l.loan && l.line !== 'Returned' && (
              <button type="button" className="pt-linkbtn text-sm pt-noloan" onClick={() => edit(l.id, { noLoan: !l.noLoan }, l.noLoan ? `marked ${l.model} as needing a demo loan form` : `marked ${l.model} as not needing a demo loan form`)}>
                {l.noLoan ? 'Not using a demo loan form · undo' : 'Doesn’t need a demo loan form'}
              </button>
            )}
          </div>
        )
      })}
      {!readOnly && <div><Button size="sm" variant="secondary" iconLeft={<Plus size={15} />} onClick={add}>Add a model</Button></div>}
    </div>
  )
}

/**
 * The demo tracker, in a pop-up, making the loan for this job: the hub's copy
 * of it (/demo/, same site) opened at its loan form, filled in with the job's
 * customer, site and dates (chs-equipment index.html
 * openLoanFromProjectTracker). When the loan is confirmed there, it posts the
 * new loan back; this links the job's matching equipment lines to it.
 */
function LoanFormDialog({ job, onClose }) {
  const s = useStore()
  const ui = useUi()
  const need = linesNeedingLoan(job)
  const base = import.meta.env.DEV ? 'https://internal.chsnz.co.nz/demo/' : '/demo/'
  const src = base + '?' + new URLSearchParams({
    newLoan: '1', ref: job.id,
    loanTo: job.customer || job.name, location: job.region || '',
    start: isISO(job.start) ? job.start : '', end: isISO(job.end) ? job.end : '',
    notes: `Project tracker: ${job.name}. Asked for: ${need.map((l) => `${l.qty}x ${l.model}`).join(', ')}.`,
  })
  useEffect(() => {
    async function linkLoan(d) {
      const modelOf = (name) => matchModel(name, s.settings.pool) || String(name || '').trim()
      const got = new Set((d.items || []).map((it) => modelOf(it.Model)))
      const linked = new Set()
      await s.mutateJob(job.id, (cur) => ({
        equipment: (cur.equipment || []).map((l) => {
          if (l.loan || l.line === 'Returned' || !got.has(l.model)) return l
          linked.add(l.model)
          return { ...l, loan: d.batchId, noLoan: false, line: l.line === 'Requested' ? 'Reserved' : l.line }
        }),
      }), `made the demo loan form (${(d.items || []).length} units, ${d.loanTo || 'no customer'}) and linked it`)
      s.feed.refresh()
      ui.toast(linked.size ? `Loan created and linked to this job: ${[...linked].join(', ')}` : 'Loan created in the demo tracker. None of its units match this job’s models; link it from the equipment line')
      onClose()
    }
    const on = (e) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'chs-demo-loan-created' || e.data.ref !== job.id) return
      linkLoan(e.data).catch((err) => ui.toast('The loan was made, but linking it failed: ' + (err.message || err)))
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Create the demo loan form" width={1240} className="pt-loanmodal" onClose={onClose}
      description={`Filled in for ${job.customer || job.name}${isISO(job.start) ? ', ' + fmtRange(job.start, job.end) : ''}. Pick the units with Browse Database, check the details, then Confirm Loan. The loan is linked to this job when it's confirmed.`}>
      <iframe className="pt-loanframe" src={src} title="Demo tracker loan form" />
      <div className="pt-addrow"><span className="text-sm text-muted pt-grow">Not confirmed yet? Close this; the job keeps a small reminder until the loan form is made.</span><Button variant="ghost" onClick={onClose}>I’ll do it later</Button></div>
    </Modal>
  )
}

function NotesActions({ job, readOnly }) {
  const s = useStore()
  const [text, setText] = useState('')
  const [owner, setOwner] = useState('')
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [noteDate, setNoteDate] = useState(todayISO())
  const today = todayISO()
  const actions = [...(job.actions || [])].sort((a, b) => (a.done - b.done) || String(a.due || '9').localeCompare(String(b.due || '9')))
  const notes = [...(job.notes || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)))

  const toggle = (a, done) => s.mutateJob(job.id, (cur) => ({ actions: (cur.actions || []).map((x) => (x.id === a.id ? { ...x, done, doneBy: done ? s.me.name : '', doneAt: done ? today : '' } : x)) }), `${done ? 'ticked off' : 'reopened'} "${a.text}"`)
  const addAction = (e) => {
    e.preventDefault()
    if (!text.trim()) return
    const a = { id: rid(), text: text.trim(), owner: owner.trim(), due, done: false }
    s.mutateJob(job.id, (cur) => ({ actions: [...(cur.actions || []), a] }), `added the action point "${a.text}"`)
    setText(''); setOwner(''); setDue('')
  }
  const delAction = (a) => s.mutateJob(job.id, (cur) => ({ actions: (cur.actions || []).filter((x) => x.id !== a.id) }), `deleted the action point "${a.text}"`)
  const addNote = (e) => {
    e.preventDefault()
    if (!note.trim()) return
    const n = { id: rid(), at: noteDate || today, by: s.me.name, text: note.trim() }
    s.mutateJob(job.id, (cur) => ({ notes: [...(cur.notes || []), n] }), 'added a note')
    setNote(''); setNoteDate(today)
  }
  const delNote = (n) => s.mutateJob(job.id, (cur) => ({ notes: (cur.notes || []).filter((x) => x.id !== n.id) }), 'deleted a note')

  return (
    <div className="pt-stack">
      <section className="pt-sec">
        <h3 className="pt-h4">Action points</h3>
        {actions.length === 0 && <Empty>No action points.</Empty>}
        <ul className="pt-list">
          {actions.map((a) => {
            const late = !a.done && a.due && a.due < today
            return (
              <li key={a.id} className="pt-action">
                <label className="pt-check">
                  <input type="checkbox" checked={!!a.done} disabled={readOnly} onChange={(e) => toggle(a, e.target.checked)} />
                  <span className={a.done ? 'pt-done' : ''}>{a.text}</span>
                </label>
                <span className="text-sm text-muted pt-action-meta">
                  {a.owner && <>{a.owner} · </>}
                  {a.due && <span className={late ? 'pt-bad' : ''}>{late ? 'overdue, ' : ''}due {fmt(a.due)}</span>}
                  {a.done && a.doneBy && <> · done by {a.doneBy}</>}
                  {!readOnly && <button type="button" className="link-btn pt-del" onClick={() => delAction(a)}>Delete</button>}
                </span>
              </li>
            )
          })}
        </ul>
        {!readOnly && (
          <form className="pt-addrow" onSubmit={addAction}>
            <input className="input pt-grow" placeholder="Add an action point" value={text} onChange={(e) => setText(e.target.value)} aria-label="New action point" />
            <input className="input pt-w-owner" placeholder="Who" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" />
            <input className="input pt-w-date" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
            <Button size="sm" type="submit">Add</Button>
          </form>
        )}
      </section>
      <section className="pt-sec">
        <h3 className="pt-h4">Notes, newest first</h3>
        {!readOnly && (
          <form className="pt-stack-sm" onSubmit={addNote}>
            <textarea className="input" rows="2" placeholder="Add a dated note" value={note} onChange={(e) => setNote(e.target.value)} aria-label="New note" />
            <div className="pt-addrow">
              <input className="input pt-w-date" type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} aria-label="Note date" />
              <span className="pt-grow" />
              <Button size="sm" type="submit">Add note</Button>
            </div>
          </form>
        )}
        {notes.length === 0 && <Empty>No notes yet.</Empty>}
        <ul className="pt-list">
          {notes.map((n) => (
            <li key={n.id} className="pt-note">
              <span className="pt-note-date">{fmt(n.at)}</span>
              <span className="pt-grow">
                <span className="pt-note-text">{n.text}</span>
                <span className="text-sm text-muted"> · {n.by}{!readOnly && <button type="button" className="link-btn pt-del" onClick={() => delNote(n)}>Delete</button>}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Comments({ job, comments, readOnly }) {
  const s = useStore()
  const [text, setText] = useState('')
  const list = [...comments].sort((a, b) => (a.atMs || 0) - (b.atMs || 0))
  const people = useMemo(() => [...new Set([...s.settings.staff.map((p) => p.name), ...s.jobs.map((j) => j.owner), ...s.online.map((p) => p.name)].filter(Boolean))], [s.settings.staff, s.jobs, s.online])
  const m = /@([^\s@]*)$/.exec(text)
  const suggestions = m ? people.filter((n) => n.toLowerCase().startsWith(m[1].toLowerCase())).slice(0, 6) : []
  const pick = (name) => setText(text.replace(/@([^\s@]*)$/, '@' + name.split(' ')[0] + ' '))
  const post = (e) => {
    e.preventDefault()
    if (!text.trim()) return
    s.addComment(job.id, text.trim())
    setText('')
  }
  return (
    <div className="pt-stack">
      {list.length === 0 && <Empty>No comments yet. Type @ to mention someone.</Empty>}
      {list.map((c) => (
        <div key={c.id} className="pt-comment">
          <Avatar person={{ name: c.byName, initials: c.byName?.split(' ').map((w) => w[0]).join('').slice(0, 2) }} />
          <div className="pt-comment-bubble">
            <div className="pt-comment-who"><b>{c.byName}</b> <span className="text-muted">· {c.atMs ? new Date(c.atMs).toLocaleString('en-NZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
              {c.uid === s.me.uid && <button type="button" className="link-btn pt-del" onClick={() => s.removeComment(c)}>Delete</button>}
            </div>
            <div className="pt-comment-text">{c.text.split(/(@[A-Za-zĀ-ž'-]+)/g).map((part, i) => (part.startsWith('@') ? <b key={i} className="pt-mention">{part}</b> : part))}</div>
          </div>
        </div>
      ))}
      {!readOnly && (
        <form className="pt-stack-sm" onSubmit={post}>
          <textarea className="input" rows="2" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment. Type @ to mention someone" aria-label="New comment"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post(e) }} />
          {suggestions.length > 0 && (
            <div className="pt-suggest">{suggestions.map((n) => <button key={n} type="button" className="tag" onClick={() => pick(n)}>@{n}</button>)}</div>
          )}
          <div className="pt-addrow"><span className="pt-grow text-sm text-muted">Ctrl+Enter to post</span><Button size="sm" type="submit">Post</Button></div>
        </form>
      )}
    </div>
  )
}

function History({ job }) {
  const s = useStore()
  const list = s.history.filter((h) => h.jobId === job.id).sort((a, b) => (b.atMs || 0) - (a.atMs || 0))
  const when = (ms) => new Date(ms).toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="pt-stack">
      {list.length === 0 && <Empty>No changes recorded yet.</Empty>}
      <ul className="pt-list">
        {list.map((h) => (
          <li key={h.id} className="pt-hist">
            <span className="pt-hist-when">{h.atMs ? when(h.atMs) : ''}</span>
            <span><b>{h.who}</b> {h.what}</span>
          </li>
        ))}
        {job.createdAtMs && !list.some((h) => h.what.startsWith('created')) && (
          <li className="pt-hist"><span className="pt-hist-when">{when(job.createdAtMs)}</span><span><b>{job.createdByName || 'Someone'}</b> created this job</span></li>
        )}
      </ul>
    </div>
  )
}

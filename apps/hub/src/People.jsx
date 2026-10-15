// People: the staff directory and HR profiles (#/people, #/people/<uid>).
//
// Laid out like the HR portals people know (BambooHR, Employment Hero): a
// directory anyone can browse, showing only name, team, picture, work email
// and work mobile; and a profile with Personal / Job / Emergency tabs that
// only the person and HR can open. HR (admins, or `hr: true`) can also add
// and remove people and edit anyone's details. What each person may read or
// write is enforced by firestore.rules; see people.js for the data.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Dialog, Toast, failMsg, useToast } from './ui.jsx'
import { loadToday, ONCALL_BG } from './today.js'
import {
  EMPLOYMENT_TYPES, RELATIONSHIPS, TEAM_OPTIONS, addEmployee, completeness, isHR, loadDirectory, loadProfile,
  photoFromFile, removeEmployee, saveEmployment, savePhoto, savePrivate, saveUser, searchPeople, tenure,
} from './people.js'

const go = hash => { location.hash = hash }
const longDate = iso => iso ? new Date(iso + 'T00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
const telHref = n => 'tel:' + n.replace(/[^\d+]/g, '')

function Avatar({ person, size = 40 }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.34) }
  if (person.photo) return <img className="pp-avatar" src={person.photo} alt="" style={style} />
  return <span className="pp-avatar" style={person.onCall ? { ...style, background: ONCALL_BG, color: '#1d1d1d' } : style}>{person.initials}</span>
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function People({ user, route }) {
  const [data, setData] = useState(null) // { users, directory }
  const [error, setError] = useState('')
  const [toast, showToast] = useToast()

  async function reload() {
    try {
      setData(await loadDirectory(user, loadToday))
    } catch (e) {
      console.error(e)
      setError('Couldn’t load the staff list. Check your connection and refresh.')
    }
  }
  useEffect(() => { reload() }, [])

  if (error) return <main className="pp-page"><div className="alert">{error}</div></main>
  if (!data) return <main className="pp-page" aria-busy="true"><span className="caption">Loading people…</span></main>

  const me = data.users.find(u => u.uid === user.uid) || null
  const ctx = { user, me, hr: isHR(me), people: data.directory, reload, showToast }
  const person = route.uid && data.directory.find(p => p.uid === (route.uid === 'me' ? user.uid : route.uid))

  return (
    <main className="pp-page">
      {!me && (
        <div className="alert">
          You’re not on the staff list yet. Open the <a href="/schedule/">staff schedule</a> once and it adds you; then come back to fill in your profile.
        </div>
      )}
      {route.uid
        ? (person ? <Profile key={person.uid} ctx={ctx} person={person} /> : <NotFound />)
        : <Directory ctx={ctx} />}
      <Toast text={toast} />
    </main>
  )
}

function NotFound() {
  return (
    <div className="stack-16">
      <a className="btn-ghost-sm self-start" href="#/people"><Icon name="chevron-left" size={16} /> All people</a>
      <div className="card pp-empty">That person isn’t on the staff list any more.</div>
    </div>
  )
}

// ── Directory ─────────────────────────────────────────────────────────────

function Directory({ ctx }) {
  const [q, setQ] = useState('')
  const [teams, setTeams] = useState([])
  const [adding, setAdding] = useState(false)
  const list = searchPeople(ctx.people, q, teams)
  const onCall = ctx.people.find(p => p.onCall)
  const toggle = id => setTeams(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]))

  return (
    <div className="stack-22">
      <div className="pp-head">
        <div className="section-head-text">
          <span className="section-stripes" aria-hidden="true"><span style={{ background: '#80bd01' }} /><span style={{ background: '#554596' }} /></span>
          <span className="chs-overline">People</span>
          <h2>Staff directory</h2>
          <span className="caption">
            {ctx.people.length} people{onCall ? ` · ${onCall.shortName} is on call` : ''}
          </span>
        </div>
        <div className="pp-head-actions">
          {ctx.me && <a className="btn btn-secondary" href="#/people/me"><Icon name="user" size={16} /> My profile</a>}
          {ctx.hr && <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="user-plus" size={16} /> Add employee</button>}
        </div>
      </div>

      <div className="dir-filters">
        <div className="field-sm">
          <Icon name="search" size={16} className="field-icon" />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email or number" aria-label="Search people" />
        </div>
        <div className="tag-row">
          <button className={`tag ${!teams.length ? 'tag-on' : ''}`} aria-pressed={!teams.length} onClick={() => setTeams([])}>All</button>
          {TEAM_OPTIONS.map(t => (
            <button key={t.id} className={`tag ${teams.includes(t.id) ? 'tag-on' : ''}`} aria-pressed={teams.includes(t.id)} onClick={() => toggle(t.id)}>{t.name}</button>
          ))}
        </div>
      </div>

      {list.length
        ? <div className="pp-grid">{list.map(p => <PersonCard key={p.uid} p={p} me={ctx.user.uid === p.uid} hr={ctx.hr} />)}</div>
        : <div className="card pp-empty">No one matches that search.</div>}

      {adding && <AddEmployee ctx={ctx} onClose={() => setAdding(false)} />}
    </div>
  )
}

function PersonCard({ p, me, hr }) {
  return (
    <article className="card card-interactive pp-card">
      <a className="pp-card-link" href={`#/people/${encodeURIComponent(p.uid)}`} aria-label={`${p.name}${me ? ' (you)' : ''}`} />
      <div className="pp-card-top">
        <Avatar person={p} size={52} />
        <div className="person-text">
          <span className="person-name ellipsis">{p.name}{me && <span className="caption"> (you)</span>}</span>
          <span className="caption">{p.teamName}{p.onCall ? ' · On call' : ''}</span>
          {p.where && <span className="person-where"><span className="swatch" style={{ background: p.swatch }} /><span className="ellipsis">{p.where}</span></span>}
        </div>
      </div>
      <div className="pp-card-contact">
        {p.email
          ? <a href={`mailto:${p.email}`} className="pp-contact ellipsis"><Icon name="mail" size={14} /><span className="ellipsis">{p.email}</span></a>
          : <span className="pp-contact muted"><Icon name="mail" size={14} />No work email yet</span>}
        {p.workMobile
          ? <a href={telHref(p.workMobile)} className="pp-contact"><Icon name="phone" size={14} />{p.workMobile}</a>
          : <span className="pp-contact muted"><Icon name="phone" size={14} />No work mobile</span>}
      </div>
      {hr && p.pending && <span className="badge badge-orange pp-card-badge">Not signed in yet</span>}
    </article>
  )
}

// ── Profile ───────────────────────────────────────────────────────────────

const TABS = [['personal', 'Personal'], ['job', 'Job'], ['emergency', 'Emergency']]

function Profile({ ctx, person }) {
  const self = ctx.user.uid === person.uid
  const full = self || ctx.hr
  const [tab, setTab] = useState('personal')
  const [details, setDetails] = useState(null) // { priv, employment }
  const [loadError, setLoadError] = useState('')
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (!full) return
    loadProfile(person.key).then(setDetails).catch(e => {
      console.error(e)
      setLoadError(e?.code === 'permission-denied'
        ? 'Private details can’t be read yet: the Firestore rules for them haven’t been published.'
        : 'Couldn’t load the private details. Refresh to try again.')
    })
  }, [person.key, full])

  const manager = details?.employment.managerUid && ctx.people.find(p => p.uid === details.employment.managerUid)
  const done = self && details ? completeness({ user: person, photo: person.photo, priv: details.priv }) : null
  const canRemove = ctx.hr && !self && person.role !== 'admin'

  return (
    <div className="stack-18">
      <a className="btn-ghost-sm self-start" href="#/people"><Icon name="chevron-left" size={16} /> All people</a>

      <section className="card pp-hero">
        <div className="pp-cover" aria-hidden="true" />
        <div className="pp-hero-body">
          <PhotoEditor ctx={ctx} person={person} canEdit={full} />
          <div className="pp-hero-text">
            <h2>{person.name}</h2>
            <span className="body-sm">
              {[details?.employment.jobTitle, person.teamName].filter(Boolean).join(' · ')}
            </span>
            <div className="tag-row">
              {person.where && <span className="pp-chip"><span className="swatch" style={{ background: person.swatch }} />{person.where}</span>}
              {person.onCall && <span className="badge badge-orange-solid">On call</span>}
              {person.role === 'admin' && ctx.hr && <span className="badge badge-purple">Admin</span>}
              {person.hr && <span className="badge badge-purple">HR</span>}
              {person.pending && <span className="badge badge-orange">Not signed in yet</span>}
            </div>
          </div>
          <div className="pp-hero-contact">
            {person.email && <a className="pp-contact" href={`mailto:${person.email}`}><Icon name="mail" size={16} />{person.email}</a>}
            {person.workMobile && <a className="pp-contact" href={telHref(person.workMobile)}><Icon name="phone" size={16} />{person.workMobile}</a>}
            {manager && <a className="pp-contact" href={`#/people/${manager.uid}`}><Icon name="users" size={16} />Reports to {manager.name}</a>}
          </div>
        </div>
      </section>

      {!full && (
        <div className="card pp-private-note">
          <Icon name="lock" size={18} />
          <span className="body-sm">Personal and job details are private to {person.shortName || person.name} and HR.</span>
        </div>
      )}

      {full && done && done.percent < 100 && (
        <div className="card pp-progress">
          <div className="pp-progress-text">
            <strong>Your profile is {done.percent}% complete</strong>
            <span className="caption">Still to add: {done.missing.join(', ')}.</span>
          </div>
          <div className="pp-bar" aria-hidden="true"><span style={{ width: `${done.percent}%` }} /></div>
        </div>
      )}

      {full && (
        <>
          <div className="pp-tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={`pp-tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {loadError && <div className="alert">{loadError}</div>}
          {!details && !loadError && <span className="caption">Loading…</span>}
          {details && tab === 'personal' && <PersonalTab ctx={ctx} person={person} self={self} details={details} setDetails={setDetails} />}
          {details && tab === 'job' && <JobTab ctx={ctx} person={person} self={self} details={details} setDetails={setDetails} manager={manager} />}
          {details && tab === 'emergency' && <EmergencyTab ctx={ctx} person={person} details={details} setDetails={setDetails} />}
        </>
      )}

      {canRemove && (
        <div className="pp-danger">
          <button className="btn btn-danger-ghost" onClick={() => setRemoving(true)}>Remove from staff list</button>
        </div>
      )}
      {removing && <RemoveEmployee ctx={ctx} person={person} onClose={() => setRemoving(false)} />}
    </div>
  )
}

function PhotoEditor({ ctx, person, canEdit }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      await savePhoto(ctx.user, person, await photoFromFile(file))
      await ctx.reload()
      ctx.showToast('Picture updated.')
    } catch (err) {
      console.error(err)
      ctx.showToast(failMsg(err))
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    try {
      await savePhoto(ctx.user, person, null)
      await ctx.reload()
      ctx.showToast('Picture removed.')
    } catch (err) {
      ctx.showToast(failMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pp-photo">
      <Avatar person={person} size={112} />
      {canEdit && person.key && (
        <div className="pp-photo-actions">
          <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
          <button className="btn-ghost-sm" disabled={busy} onClick={() => input.current.click()}>
            <Icon name="camera" size={16} /> {busy ? 'Saving…' : person.photo ? 'Change' : 'Add picture'}
          </button>
          {person.photo && !busy && <button className="btn-ghost-sm" onClick={remove}>Remove</button>}
        </div>
      )}
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────

/** A card of label/value rows with Edit → form → Save/Cancel, as in most HR portals. */
function Section({ title, canEdit, editing, setEditing, onSave, children, note }) {
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await onSave()
      setEditing(false)
    } catch {
      // onSave has already said what went wrong; stay in the form so nothing typed is lost
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="card pp-section" onSubmit={save}>
      <div className="pp-section-head">
        <h3>{title}</h3>
        {canEdit && !editing && <button type="button" className="btn-ghost-sm" onClick={() => setEditing(true)}><Icon name="pencil" size={16} /> Edit</button>}
      </div>
      {note && <span className="caption">{note}</span>}
      <dl className="pp-fields">{children}</dl>
      {editing && (
        <div className="pp-section-foot">
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </form>
  )
}

/** One row: the value when reading, an input when editing (if this field is editable). */
function Field({ label, value, display, editing, editable = true, type = 'text', options, onChange, wide, hint, ...rest }) {
  const shown = display ?? value
  return (
    <div className={`pp-field ${wide ? 'wide' : ''}`}>
      <dt>{label}</dt>
      <dd>
        {editing && editable
          ? options
            ? <select className="pp-input" value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            : <input className="pp-input" type={type} value={value} onChange={e => onChange(e.target.value)} aria-label={label} {...rest} />
          : shown ? <span>{shown}</span> : <span className="muted">Not added</span>}
        {editing && hint && <span className="caption">{hint}</span>}
      </dd>
    </div>
  )
}

function PersonalTab({ ctx, person, self, details, setDetails }) {
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState(null)
  useEffect(() => {
    if (editing) setF({ displayName: person.name, workMobile: person.workMobile, email: person.email, ...details.priv, address: { ...details.priv.address } })
  }, [editing])
  const v = editing && f ? f : { displayName: person.name, workMobile: person.workMobile, email: person.email, ...details.priv }
  const set = k => val => setF(x => ({ ...x, [k]: val }))
  const setA = k => val => setF(x => ({ ...x, address: { ...x.address, [k]: val } }))
  const a = v.address || {}
  // Private details are kept against the email, so it's only set while there's nothing behind it yet
  const emailEditable = ctx.hr && !self && (person.pending || !person.email)

  async function save() {
    try {
      const pub = { displayName: f.displayName, workMobile: f.workMobile }
      if (emailEditable && f.email !== person.email) pub.email = f.email
      await saveUser(ctx.user, person, pub)
      // A changed email moves where private details live; save them under the new one.
      const target = pub.email ? { ...person, key: pub.email.trim().toLowerCase() } : person
      const priv = await savePrivate(ctx.user, target, f)
      setDetails(d => ({ ...d, priv }))
      await ctx.reload()
      ctx.showToast('Saved.')
    } catch (e) {
      console.error(e)
      ctx.showToast(failMsg(e))
      throw e
    }
  }

  const addressText = [a.street, a.suburb, [a.city, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return (
    <div className="stack-16">
      <Section title="Contact" canEdit editing={editing} setEditing={setEditing} onSave={save}
        note={editing ? 'Your name, work email, work mobile and picture are visible to everyone. Everything else here is visible only to you and HR.' : null}>
        <Field label="Name" value={v.displayName} editing={editing} onChange={set('displayName')} required maxLength={80} />
        <Field label="Work email" value={v.email} editing={editing} editable={emailEditable} type="email" onChange={set('email')}
          hint={emailEditable ? 'The address they sign in with.' : null} />
        <Field label="Work mobile" value={v.workMobile} editing={editing} type="tel" onChange={set('workMobile')} placeholder="021 123 4567" />
        <Field label="Personal email" value={v.personalEmail} editing={editing} type="email" onChange={set('personalEmail')} />
        <Field label="Personal phone" value={v.personalPhone} editing={editing} type="tel" onChange={set('personalPhone')} />
        <Field label="Date of birth" value={v.dateOfBirth} display={longDate(v.dateOfBirth)} editing={editing} type="date" onChange={set('dateOfBirth')} />
        {editing
          ? <>
              <Field label="Street address" value={a.street} editing onChange={setA('street')} wide autoComplete="street-address" />
              <Field label="Suburb" value={a.suburb} editing onChange={setA('suburb')} />
              <Field label="City" value={a.city} editing onChange={setA('city')} />
              <Field label="Postcode" value={a.postcode} editing onChange={setA('postcode')} inputMode="numeric" maxLength={10} />
            </>
          : <Field label="Home address" value={addressText} wide />}
      </Section>
    </div>
  )
}

function JobTab({ ctx, person, self, details, setDetails, manager }) {
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState(null)
  useEffect(() => { if (editing) setF({ ...details.employment, team: person.team, hr: person.hr }) }, [editing])
  const v = editing && f ? f : { ...details.employment, team: person.team, hr: person.hr }
  const set = k => val => setF(x => ({ ...x, [k]: val }))
  const hr = ctx.hr
  const isAdmin = ctx.me?.role === 'admin'
  const managers = useMemo(() => [{ value: '', label: 'No one' },
    ...ctx.people.filter(p => p.uid !== person.uid && !p.pending).map(p => ({ value: p.uid, label: p.name }))], [ctx.people, person.uid])

  async function save() {
    try {
      const employment = await saveEmployment(ctx.user, person, f, { titleOnly: !hr })
      setDetails(d => ({ ...d, employment: { ...d.employment, ...employment } }))
      const pub = {}
      if (hr && f.team !== person.team) pub.team = f.team
      if (isAdmin && !!f.hr !== person.hr) pub.hr = f.hr
      if (Object.keys(pub).length) { await saveUser(ctx.user, person, pub); await ctx.reload() }
      ctx.showToast('Saved.')
    } catch (e) {
      console.error(e)
      ctx.showToast(failMsg(e))
      throw e
    }
  }

  return (
    <Section title="Job" canEdit={hr || self} editing={editing} setEditing={setEditing} onSave={save}
      note={!hr ? 'You can update your job title. Team, manager, start date and employment type are kept by HR.' : null}>
      <Field label="Job title" value={v.jobTitle} editing={editing} onChange={set('jobTitle')} placeholder="Field Service Engineer" maxLength={120} />
      <Field label="Team" value={v.team} display={TEAM_OPTIONS.find(t => t.id === v.team)?.name} editing={editing} editable={hr}
        options={[{ value: '', label: 'No team' }, ...TEAM_OPTIONS.map(t => ({ value: t.id, label: t.name }))]} onChange={set('team')} />
      <Field label="Manager" value={v.managerUid} display={manager?.name} editing={editing} editable={hr} options={managers} onChange={set('managerUid')} />
      <Field label="Employment type" value={v.employmentType} editing={editing} editable={hr}
        options={[{ value: '', label: 'Not set' }, ...EMPLOYMENT_TYPES.map(t => ({ value: t, label: t }))]} onChange={set('employmentType')} />
      <Field label="Start date" value={v.startDate} editing={editing} editable={hr} type="date" onChange={set('startDate')}
        display={v.startDate ? `${longDate(v.startDate)}${tenure(v.startDate) ? ` · ${tenure(v.startDate)}` : ''}` : ''} />
      {hr && (
        <Field label="HR access" value={v.hr ? 'yes' : 'no'} display={person.role === 'admin' ? 'Yes (admin)' : v.hr ? 'Yes' : 'No'}
          editing={editing} editable={isAdmin && person.role !== 'admin'} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
          onChange={val => setF(x => ({ ...x, hr: val === 'yes' }))}
          hint={isAdmin ? 'Can see and edit everyone’s profile, and add or remove people.' : null} />
      )}
    </Section>
  )
}

const emptyContact = { name: '', relationship: '', phone: '' }

function EmergencyTab({ ctx, person, details, setDetails }) {
  const [editing, setEditing] = useState(false)
  const [list, setList] = useState([])
  useEffect(() => {
    if (editing) setList([0, 1].map(i => ({ ...emptyContact, ...details.priv.emergency[i] })))
  }, [editing])
  const shown = editing ? list : details.priv.emergency
  const set = (i, k) => val => setList(l => l.map((c, j) => (j === i ? { ...c, [k]: val } : c)))

  async function save() {
    try {
      const priv = await savePrivate(ctx.user, person, { ...details.priv, emergency: list })
      setDetails(d => ({ ...d, priv }))
      ctx.showToast('Saved.')
    } catch (e) {
      console.error(e)
      ctx.showToast(failMsg(e))
      throw e
    }
  }

  return (
    <Section title="Emergency contacts" canEdit editing={editing} setEditing={setEditing} onSave={save}
      note="Who we call if something happens at work. Visible only to you and HR.">
      {!shown.length && !editing && <Field label="Primary contact" value="" wide />}
      {shown.map((c, i) => (
        <div key={i} className="pp-contact-group">
          <span className="chs-overline">{i === 0 ? 'Primary' : 'Secondary'}</span>
          <Field label="Name" value={c.name} editing={editing} onChange={set(i, 'name')} />
          <Field label="Relationship" value={c.relationship} editing={editing} onChange={set(i, 'relationship')}
            options={editing ? [{ value: '', label: 'Choose…' }, ...RELATIONSHIPS.map(r => ({ value: r, label: r }))] : null} />
          <Field label="Phone" value={c.phone} editing={editing} type="tel" onChange={set(i, 'phone')}
            display={c.phone && <a href={telHref(c.phone)}>{c.phone}</a>} />
        </div>
      ))}
    </Section>
  )
}

// ── HR dialogs ────────────────────────────────────────────────────────────

function AddEmployee({ ctx, onClose }) {
  const [f, setF] = useState({ name: '', email: '', team: '', workMobile: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const added = await addEmployee(ctx.user, ctx.people, f)
      await ctx.reload()
      ctx.showToast(`Added ${added.displayName}.`)
      onClose()
      go(`#/people/${encodeURIComponent(added.uid)}`)
    } catch (err) {
      console.error(err)
      setError(failMsg(err))
      setBusy(false)
    }
  }

  return (
    <Dialog title="Add employee" onClose={onClose}>
      <p className="body-sm">
        They can be scheduled straight away. When they first sign in with this work email, the profile becomes theirs
        and they can fill in their own details.
      </p>
      <form className="stack-16" onSubmit={submit}>
        <label className="pp-label">Full name<input className="pp-input" value={f.name} onChange={set('name')} autoFocus required maxLength={80} placeholder="Jo Bloggs" /></label>
        <label className="pp-label">Work email<input className="pp-input" type="email" value={f.email} onChange={set('email')} required placeholder="jo.bloggs@cass.co.nz" /></label>
        <div className="pp-two">
          <label className="pp-label">Team
            <select className="pp-input" value={f.team} onChange={set('team')} required>
              <option value="">Choose…</option>
              {TEAM_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="pp-label">Work mobile<input className="pp-input" type="tel" value={f.workMobile} onChange={set('workMobile')} placeholder="Optional" /></label>
        </div>
        {error && <div className="alert">{error}</div>}
        <div className="pp-section-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add employee'}</button>
        </div>
      </form>
    </Dialog>
  )
}

function RemoveEmployee({ ctx, person, onClose }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ok = typed.trim().toLowerCase() === person.name.toLowerCase()

  async function remove() {
    setBusy(true)
    try {
      await removeEmployee(ctx.user, person)
      await ctx.reload()
      ctx.showToast(`Removed ${person.name}.`)
      onClose()
      go('#/people')
    } catch (err) {
      console.error(err)
      setError(failMsg(err))
      setBusy(false)
    }
  }

  return (
    <Dialog title={`Remove ${person.name}?`} onClose={onClose}>
      <p className="body-sm">
        This takes them off the staff list, the staff schedule and the directory, and deletes their profile picture and
        private details. Their past schedule weeks are kept. It can’t be undone.
      </p>
      {!person.pending && (
        <p className="body-sm">Do this once they’ve left and their Microsoft account is closed: if they sign in again, they’re added back with an empty profile.</p>
      )}
      <label className="pp-label">Type their name to confirm
        <input className="pp-input" value={typed} onChange={e => setTyped(e.target.value)} placeholder={person.name} autoFocus />
      </label>
      {error && <div className="alert">{error}</div>}
      <div className="pp-section-foot">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-danger" disabled={!ok || busy} onClick={remove}>{busy ? 'Removing…' : 'Remove'}</button>
      </div>
    </Dialog>
  )
}

/* Customers: a folder for each customer, and in it sub folders that open the
   customer's OneDrive equipment list, projects folder, test reports… Only the
   names are shown; the links are set in the folder's settings (the cog at the
   top right of its icon), so nothing here reads as a web address. Folders are
   customers.js; they live in the tracker's settings, so editing is for the
   same people as the rest of the tracker. */

import { useMemo, useState } from 'react'
import {
  Folder, Hospital, Boxes, FileSpreadsheet, ClipboardCheck, FileText, FileSignature, Receipt, Image as ImageIcon, Map as MapIcon,
  Wrench, Wifi, ShieldCheck, BookOpen, Users, Calendar, Mail, Link2, Settings2, Star, Plus, ChevronUp, ChevronDown, Trash2, ArrowLeft, Search, Copy,
} from 'lucide-react'
import { Alert, Button } from '../../../schedule/src/components/ui'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { Modal, Field, Empty } from '../ui.jsx'
import { linkHref } from '../model.js'
import {
  FOLDER_COLOURS, FOLDER_ICONS, SUB_KINDS, newCustomer, newSub, copyCustomer, customerProblems, visibleCustomers, moved,
} from '../customers.js'

const ICONS = {
  folder: Folder, building: Hospital, boxes: Boxes, sheet: FileSpreadsheet, check: ClipboardCheck, file: FileText, sign: FileSignature,
  receipt: Receipt, image: ImageIcon, map: MapIcon, wrench: Wrench, wifi: Wifi, shield: ShieldCheck, book: BookOpen, users: Users,
  calendar: Calendar, mail: Mail, link: Link2,
}
const IconOf = ({ name, size = 24 }) => { const I = ICONS[name] || Folder; return <I size={size} aria-hidden="true" /> }

const openCustomer = (id) => { location.hash = '#/customers' + (id ? `?c=${encodeURIComponent(id)}` : '') }
/** Opens a link in a new tab without ever putting it on screen. */
const openLink = (link) => { const href = linkHref(link); if (href) window.open(href, '_blank', 'noopener,noreferrer') }

export default function Customers({ params }) {
  const s = useStore()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // { draft, isNew }
  const open = params.c ? s.customers.find((c) => c.id === params.c) : null
  const list = useMemo(() => visibleCustomers(s.customers, q), [s.customers, q])

  const startNew = () => setEditing({ draft: newCustomer(s.settings.customerDefaults), isNew: true })
  const edit = (c) => setEditing({ draft: c, isNew: false })

  return (
    <div className="pt-page">
      {params.c && !open ? (
        <>
          <Header title="That folder isn’t here" sub="It may have been deleted." />
          <div><Button variant="secondary" iconLeft={<ArrowLeft size={16} />} onClick={() => openCustomer('')}>All customers</Button></div>
        </>
      ) : open ? (
        <Detail c={open} canEdit={s.canEdit} onEdit={() => edit(open)} />
      ) : (
        <>
          <div className="pt-pagehead">
            <div className="pt-col">
              <h1 className="pt-h2">Customers</h1>
              <span className="text-sm text-muted">A folder for each customer, with shortcuts to their equipment list, projects folder, test reports and more.</span>
            </div>
            {s.canEdit && <Button iconLeft={<Plus size={16} />} onClick={startNew}>New customer folder</Button>}
          </div>
          {s.customers.length > 0 && (
            <div className="pt-filters">
              <span className="pt-searchfield">
                <Search size={16} aria-hidden="true" />
                <input className="input" type="search" placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
              </span>
            </div>
          )}
          {s.customers.length === 0 ? (
            <div className="pt-folders-empty">
              <Folder size={40} aria-hidden="true" />
              <h2 className="pt-h4">No customer folders yet</h2>
              <p className="text-sm text-muted">{s.canEdit ? 'Make one for a customer, then add the sub folders you want: their equipment list, projects folder, test reports… Each opens a link you set once.' : 'Nobody has made one yet. Editing is for staff with a team.'}</p>
              {s.canEdit && <Button iconLeft={<Plus size={16} />} onClick={startNew}>New customer folder</Button>}
            </div>
          ) : list.length === 0 ? (
            <Empty>No customer folder matches “{q}”.</Empty>
          ) : (
            <ul className="pt-folders">
              {list.map((c) => (
                <li key={c.id} className="pt-folder card" style={{ '--fc': c.colour }}>
                  <div className="pt-folder-top">
                    <span className="pt-folder-ico"><IconOf name={c.icon} size={30} /></span>
                    {s.canEdit && <button type="button" className="pt-gear" aria-label={`Settings for ${c.name}`} title="Folder settings" onClick={() => edit(c)}><Settings2 size={14} aria-hidden="true" /></button>}
                    {c.pinned && <Star size={14} className="pt-pin" aria-label="Pinned" />}
                  </div>
                  <button type="button" className="pt-folder-open" onClick={() => openCustomer(c.id)}>
                    <span className="pt-folder-name">{c.name}</span>
                    <span className="pt-folder-meta">{c.subs.length === 1 ? '1 sub folder' : `${c.subs.length} sub folders`}</span>
                  </button>
                  {c.note && <span className="pt-folder-note">{c.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {editing && <FolderDialog draft={editing.draft} isNew={editing.isNew} onClose={() => setEditing(null)} onGone={() => { setEditing(null); if (params.c) openCustomer('') }} />}
    </div>
  )
}

function Header({ title, sub }) {
  return (
    <div className="pt-pagehead">
      <div className="pt-col">
        <h1 className="pt-h2">{title}</h1>
        {sub && <span className="text-sm text-muted">{sub}</span>}
      </div>
    </div>
  )
}

/** One customer: its sub folders as tiles. Names only: a tile opens its link. */
function Detail({ c, canEdit, onEdit }) {
  return (
    <>
      <div><button type="button" className="link-btn pt-back" onClick={() => openCustomer('')}><ArrowLeft size={14} aria-hidden="true" /> All customers</button></div>
      <div className="pt-folder-hero" style={{ '--fc': c.colour }}>
        <div className="pt-folder-top">
          <span className="pt-folder-ico pt-folder-ico-lg"><IconOf name={c.icon} size={40} /></span>
          {canEdit && <button type="button" className="pt-gear" aria-label={`Settings for ${c.name}`} title="Folder settings" onClick={onEdit}><Settings2 size={15} aria-hidden="true" /></button>}
        </div>
        <div className="pt-col">
          <h1 className="pt-h2">{c.name}</h1>
          {c.note && <span className="text-sm text-muted">{c.note}</span>}
        </div>
      </div>
      {c.subs.length === 0 ? (
        <div className="pt-folders-empty">
          <p className="text-sm text-muted">No sub folders yet.</p>
          {canEdit && <Button variant="secondary" iconLeft={<Plus size={16} />} onClick={onEdit}>Add sub folders</Button>}
        </div>
      ) : (
        <ul className="pt-subs" style={{ '--fc': c.colour }}>
          {c.subs.map((x) => {
            const ok = !!linkHref(x.link)
            return (
              <li key={x.id}>
                <button type="button" className={`pt-sub card${ok ? '' : ' pt-sub-off'}`} onClick={() => (ok ? openLink(x.link) : canEdit && onEdit())} disabled={!ok && !canEdit}
                  aria-label={ok ? `Open ${x.name}` : `${x.name}: no link yet${canEdit ? ', open the settings to add one' : ''}`}>
                  <span className="pt-sub-ico"><IconOf name={x.icon} size={22} /></span>
                  <span className="pt-sub-text">
                    <span className="pt-sub-name">{x.name}</span>
                    {(x.note || !ok) && <span className="pt-sub-note">{ok ? x.note : 'No link yet'}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/** The folder's settings: its name, look and sub folders, where the links are. */
function FolderDialog({ draft: initial, isNew, onClose, onGone }) {
  const s = useStore()
  const ui = useUi()
  const [d, setD] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState([])
  const [sure, setSure] = useState(false)
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const setSub = (i, patch) => setD((x) => ({ ...x, subs: x.subs.map((y, j) => (j === i ? { ...y, ...patch } : y)) }))
  const used = new Set(d.subs.map((x) => x.name.trim().toLowerCase()))
  const suggestions = SUB_KINDS.filter(([n]) => !used.has(n.toLowerCase()))

  async function save(e) {
    e.preventDefault()
    const found = customerProblems(d, s.customers)
    setProblems(found)
    if (found.length) return
    setBusy(true)
    try {
      await s.saveCustomer(d, isNew)
      ui.toast(isNew ? 'Folder made' : 'Folder saved')
      onClose()
    } catch (err) { ui.toast('Not saved: ' + (err.message || err)); setBusy(false) }
  }
  async function remove() {
    setBusy(true)
    try { await s.deleteCustomer(d); ui.toast('Folder deleted'); onGone() } catch (err) { ui.toast('Not deleted: ' + (err.message || err)); setBusy(false) }
  }
  async function duplicate() {
    setBusy(true)
    try {
      const copy = copyCustomer(d, `${d.name} (copy)`)
      await s.saveCustomer(copy, true)
      ui.toast('Copied without the links: name it and add its links')
      onClose()
      openCustomer(copy.id)
    } catch (err) { ui.toast('Not copied: ' + (err.message || err)); setBusy(false) }
  }

  return (
    <Modal title={isNew ? 'New customer folder' : `Settings: ${initial.name || 'folder'}`} description="Only the names show on the Customers tab. The links live here." onClose={onClose} width={720}>
      <form className="pt-stack" onSubmit={save}>
        <div className="pt-grid2">
          <Field label="Customer name" className="pt-span2"><input className="input" value={d.name} onChange={set('name')} placeholder="e.g. Waikato Hospital" maxLength={80} required /></Field>
          <Field label="Note (optional)" className="pt-span2" hint="Shown under the name."><input className="input" value={d.note} onChange={set('note')} maxLength={300} /></Field>
        </div>

        <div className="pt-looks">
          <div>
            <span className="field-label">Colour</span>
            <div className="pt-swatches" role="radiogroup" aria-label="Colour">
              {FOLDER_COLOURS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={d.colour === c} aria-label={c} className={`pt-swatch${d.colour === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setD((x) => ({ ...x, colour: c }))} />
              ))}
            </div>
          </div>
          <div>
            <span className="field-label">Icon</span>
            <div className="pt-icons" role="radiogroup" aria-label="Icon">
              {FOLDER_ICONS.map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={d.icon === k} title={label} aria-label={label} className={`pt-iconpick${d.icon === k ? ' on' : ''}`} style={{ '--fc': d.colour }} onClick={() => setD((x) => ({ ...x, icon: k }))}><IconOf name={k} size={18} /></button>
              ))}
            </div>
          </div>
        </div>
        <label className="pt-check"><input type="checkbox" checked={d.pinned} onChange={set('pinned')} /> Pin to the top of the list</label>

        <section className="pt-sec">
          <h3 className="pt-h4">Sub folders</h3>
          <datalist id="pt-sub-kinds">{SUB_KINDS.map(([n]) => <option key={n} value={n} />)}</datalist>
          {d.subs.length === 0 && <Empty>No sub folders yet. Add the first below.</Empty>}
          <ul className="pt-subedit">
            {d.subs.map((x, i) => (
              <li key={x.id} className="pt-subrow">
                <div className="pt-subrow-main">
                  <select value={x.icon} onChange={(e) => setSub(i, { icon: e.target.value })} aria-label={`Icon for ${x.name || `sub folder ${i + 1}`}`} className="pt-subicon">
                    {FOLDER_ICONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                  <input className="input pt-subname" value={x.name} onChange={(e) => setSub(i, { name: e.target.value })} list="pt-sub-kinds" placeholder="Name, e.g. Equipment list" aria-label={`Name of sub folder ${i + 1}`} maxLength={80} />
                  <span className="pt-subbtns">
                    <button type="button" className="icon-btn icon-btn-md" aria-label="Move up" disabled={i === 0} onClick={() => setD((v) => ({ ...v, subs: moved(v.subs, i, -1) }))}><ChevronUp size={16} /></button>
                    <button type="button" className="icon-btn icon-btn-md" aria-label="Move down" disabled={i === d.subs.length - 1} onClick={() => setD((v) => ({ ...v, subs: moved(v.subs, i, 1) }))}><ChevronDown size={16} /></button>
                    <button type="button" className="icon-btn icon-btn-md" aria-label={`Remove ${x.name || `sub folder ${i + 1}`}`} onClick={() => setD((v) => ({ ...v, subs: v.subs.filter((_, j) => j !== i) }))}><Trash2 size={16} /></button>
                  </span>
                </div>
                <input className="input" value={x.link} onChange={(e) => setSub(i, { link: e.target.value })} placeholder="Paste the link (OneDrive, SharePoint…)" aria-label={`Link for ${x.name || `sub folder ${i + 1}`}`} autoComplete="off" spellCheck={false} />
                <input className="input pt-subnote" value={x.note} onChange={(e) => setSub(i, { note: e.target.value })} placeholder="Note (optional), shown under the name" aria-label={`Note for ${x.name || `sub folder ${i + 1}`}`} maxLength={200} />
              </li>
            ))}
          </ul>
          <div className="pt-addrow">
            <Button variant="secondary" size="sm" iconLeft={<Plus size={16} />} onClick={() => setD((v) => ({ ...v, subs: [...v.subs, newSub('')] }))}>Add a sub folder</Button>
            {suggestions.length > 0 && (
              <select value="" aria-label="Add a usual sub folder" onChange={(e) => { const [n] = SUB_KINDS.find(([k]) => k === e.target.value) || []; if (n) setD((v) => ({ ...v, subs: [...v.subs, newSub(n)] })) }}>
                <option value="">Add a usual one…</option>
                {suggestions.map(([n]) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </div>
        </section>

        {problems.length > 0 && <Alert tone="critical" title="Not saved yet">{problems.join(' ')}</Alert>}

        <div className="pt-addrow">
          {!isNew && !sure && <Button variant="ghost" iconLeft={<Trash2 size={16} />} disabled={busy} onClick={() => setSure(true)}>Delete folder</Button>}
          {!isNew && sure && (
            <span className="pt-sure" role="alert">Delete “{initial.name}” and all its links? <Button variant="secondary" size="sm" disabled={busy} onClick={remove}>Yes, delete it</Button> <Button variant="ghost" size="sm" onClick={() => setSure(false)}>No</Button></span>
          )}
          {!isNew && !sure && <Button variant="ghost" iconLeft={<Copy size={16} />} disabled={busy} onClick={duplicate}>Duplicate (without links)</Button>}
          <span className="pt-grow" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{isNew ? 'Make the folder' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/* One entry in full, in a dialog. Its address (/knowledge/#/article/<id>) opens it directly, so an entry can be shared as a link.
   Text is always drawn as React text, never as HTML (richBlocks in model.js): nothing typed in an article can inject markup. */
import { Link2, Pencil, Trash2 } from 'lucide-react'
import { Badge, Button, Dialog, useConfirm } from '../../../shared/ui/index.jsx'
import { mentioning, relatedParts, richBlocks } from './model.js'
import { removeRecord } from './store.js'

const NZ = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]}-${m[1]}` : iso || '' }

/** A body of text with **bold**, bullet lines and http(s) links, as elements. */
export function Rich({ text }) {
  const blocks = richBlocks(text)
  const parts = (ps) => ps.map((p, i) => p.t === 'bold' ? <strong key={i}>{p.text}</strong>
    : p.t === 'link' ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>
    : <span key={i}>{p.text}</span>)
  const out = []
  let list = null
  blocks.forEach((b, i) => {
    if (b.type === 'li') {
      if (!list) { list = []; out.push(<ul key={'l' + i} className="kb-ul">{list}</ul>) }
      list.push(<li key={i}>{parts(b.parts)}</li>)
      return
    }
    list = null
    if (b.type === 'p') out.push(<p key={i}>{parts(b.parts)}</p>)
  })
  return <div className="kb-rich">{out}</div>
}

function Facts({ rows }) {
  const shown = rows.filter(([, v]) => v && (!Array.isArray(v) || v.length))
  return (
    <dl className="kb-facts">
      {shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{Array.isArray(v) ? v.join(', ') : v}</dd></div>)}
    </dl>
  )
}

export function Detail({ kind, rec, lists, canEdit, onClose, onOpen, onEdit, onToast }) {
  const [confirmDialog, confirm] = useConfirm()
  const parts = lists.part || []
  const linkedParts = kind === 'part' ? [] : relatedParts(rec, parts)
  const partsUsing = kind === 'part' ? { articles: mentioning(rec, lists.article || []), jobs: mentioning(rec, lists.job || []) } : null
  const title = kind === 'article' ? rec.title : kind === 'part' ? `${rec.partNo}${rec.name ? ' · ' + rec.name : ''}`
    : kind === 'device' ? `${rec.model || 'Device'}${rec.site ? ' · ' + rec.site : ''}` : `${rec.jobNo ? 'Job ' + rec.jobNo + ' · ' : ''}${rec.title}`

  async function share() {
    const url = `${location.origin}/knowledge/#/${kind}/${encodeURIComponent(rec.id)}`
    try { await navigator.clipboard.writeText(url); onToast('Link copied.') } catch { onToast(url) }
  }
  async function del() {
    if (!(await confirm({ title: 'Remove this entry?', message: 'It goes for everyone. This cannot be undone.', confirmLabel: 'Remove', danger: true }))) return
    try { await removeRecord(kind, rec.id); onClose(); onToast('Removed.') } catch (e) { console.error(e); onToast('Could not remove it.') }
  }

  return (
    <Dialog title={title} onClose={onClose} width={680}>
      <div className="kb-detail">
        {kind === 'article' && (<>
          <div className="kb-tags">{rec.category && <Badge tone="neutral">{rec.category}</Badge>}{(rec.tags || []).map((t) => <Badge key={t} tone="purple">{t}</Badge>)}</div>
          <Rich text={rec.body} />
          <Facts rows={[['Last checked', NZ(rec.reviewedAt)]]} />
        </>)}
        {kind === 'part' && (<>
          <Facts rows={[['Part number', rec.partNo], ['Name', rec.name], ['Also called', rec.aliases], ['Fits', rec.fits], ['Notes', rec.notes]]} />
          {rec.diagram && (/^https?:\/\//i.test(rec.diagram)
            ? <p><a href={rec.diagram} target="_blank" rel="noopener noreferrer">Open the diagram</a></p>
            : <Facts rows={[['Diagram', rec.diagram]]} />)}
          {partsUsing.articles.length > 0 && <Linked title="Articles that mention it" rows={partsUsing.articles.map((a) => [a.id, a.title, 'article'])} onOpen={onOpen} />}
          {partsUsing.jobs.length > 0 && <Linked title="Past jobs that used it" rows={partsUsing.jobs.map((j) => [j.id, `${j.jobNo ? 'Job ' + j.jobNo + ': ' : ''}${j.title}`, 'job'])} onOpen={onOpen} />}
        </>)}
        {kind === 'device' && (
          <Facts rows={[['Site', rec.site], ['Department', rec.dept], ['Model', rec.model], ['Serial', rec.serial], ['Software', rec.version], ['Options', rec.options], ['Notes', rec.notes], ...Object.entries(rec.extra || {})]} />
        )}
        {kind === 'job' && (<>
          <Facts rows={[['Job', rec.jobNo], ['Site', rec.site], ['Date', NZ(rec.date)], ['Models', rec.model], ['Parts', rec.parts]]} />
          <Rich text={rec.notes} />
        </>)}

        {linkedParts.length > 0 && <Linked title="Parts" rows={linkedParts.map((p) => [p.id, `${p.partNo}${p.name ? ' · ' + p.name : ''}`, 'part'])} onOpen={onOpen} />}
        <p className="kb-meta">{rec.updatedByName ? `Last changed by ${rec.updatedByName}` : ''}{rec.updatedAt?.toMillis ? ` on ${new Date(rec.updatedAt.toMillis()).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' })}` : ''}</p>
        <div className="dialog-actions">
          {canEdit && <Button variant="danger" iconLeft={<Trash2 size={16} />} onClick={del}>Remove</Button>}
          <span className="spacer" />
          <Button variant="ghost" iconLeft={<Link2 size={16} />} onClick={share}>Copy link</Button>
          {canEdit && <Button variant="secondary" iconLeft={<Pencil size={16} />} onClick={onEdit}>Edit</Button>}
        </div>
      </div>
      {confirmDialog}
    </Dialog>
  )
}

function Linked({ title, rows, onOpen }) {
  return (
    <div className="kb-linked">
      <h3>{title}</h3>
      <ul>{rows.slice(0, 20).map(([id, label, kind]) => <li key={id}><button type="button" className="kb-link" onClick={() => onOpen(kind, id)}>{label}</button></li>)}</ul>
    </div>
  )
}

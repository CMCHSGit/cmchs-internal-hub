/* One entry in full, in a dialog. Its address (/knowledge/#/article/<id>) opens it directly, so an entry can be shared as a link.
   Text is always drawn as React text, never as HTML (richBlocks in model.js): nothing typed in an article can inject markup. */
import { Link2, Pencil, Trash2 } from 'lucide-react'
import { Alert, Badge, Button, Dialog, useConfirm } from '../../../shared/ui/index.jsx'
import { Hl } from './Hl.jsx'
import { compact, mentioning, partInfo, relatedParts, richBlocks, sourceLink } from './model.js'
import { removeRecord } from './store.js'

const NZ = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]}-${m[1]}` : iso || '' }

/** A body of text with **bold**, bullet lines and http(s) links, as elements. */
export function Rich({ text, source = '', re = null }) {
  const blocks = richBlocks(text)
  // A "[Picture p.3]" mark opens the article's original PDF at that page, when the article has one.
  const parts = (ps) => ps.map((p, i) => p.t === 'bold' ? <strong key={i}><Hl text={p.text} re={re} /></strong>
    : p.t === 'link' ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>
    : p.t === 'pic' ? (source
      ? <a key={i} className="kb-pic" href={source + (p.page ? `#page=${p.page}` : '')} target="_blank" rel="noopener noreferrer" title="Open the original PDF">{p.text}</a>
      : <span key={i} className="kb-pic">{p.text}</span>)
    : <span key={i}><Hl text={p.text} re={re} /></span>)
  const out = []
  let list = null
  blocks.forEach((b, i) => {
    if (b.type === 'li') {
      if (!list) { list = []; out.push(<ul key={'l' + i} className="kb-ul">{list}</ul>) }
      // A numbered step shows its own number ("3." or "a."); a deeper step is indented.
      list.push(<li key={i} className={b.marker ? 'kb-step' : undefined} style={b.level ? { marginLeft: `${b.level * 20}px` } : undefined}>
        {b.marker && <span className="kb-step-n">{b.marker}</span>}{parts(b.parts)}</li>)
      return
    }
    list = null
    if (b.type === 'p') out.push(<p key={i}>{parts(b.parts)}</p>)
  })
  return <div className="kb-rich">{out}</div>
}

function Facts({ rows, re }) {
  const shown = rows.filter(([, v]) => v && (!Array.isArray(v) || v.length))
  return (
    <dl className="kb-facts">
      {shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd><Hl text={Array.isArray(v) ? v.join(', ') : String(v)} re={re} /></dd></div>)}
    </dl>
  )
}

export function Detail({ kind, rec, lists, canEdit, re = null, onClose, onOpen, onEdit, onToast }) {
  const [confirmDialog, confirm] = useConfirm()
  const parts = lists.part || []
  const linkedParts = kind === 'part' ? [] : relatedParts(rec, parts)
  const partsUsing = kind === 'part' ? { articles: mentioning(rec, lists.article || []), jobs: mentioning(rec, lists.job || []) } : null
  const info = kind === 'part' ? partInfo(rec.notes) : null
  // Jobs that list the part number, and the jobs the part's own notes say it was used on (a number can be only in a job's text).
  const usedOn = kind === 'part' ? (() => {
    const byNo = new Map((lists.job || []).map((j) => [j.jobNo, j]))
    const seen = new Set(partsUsing.jobs.map((j) => j.id))
    return [...partsUsing.jobs, ...info.jobs.map((n) => byNo.get(n)).filter((j) => j && !seen.has(j.id) && seen.add(j.id))]
  })() : []
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
    <Dialog title={title} titleNode={re ? <Hl text={title} re={re} /> : undefined} onClose={onClose} width={680}>
      <div className="kb-detail">
        {kind === 'article' && (<>
          <div className="kb-tags">{rec.category && <Badge tone="neutral">{rec.category}</Badge>}{(rec.tags || []).map((t) => <Badge key={t} tone="purple">{t}</Badge>)}</div>
          <Rich text={rec.body} source={sourceLink(rec.body)} re={re} />
          <Facts rows={[['Last checked', NZ(rec.reviewedAt)]]} re={re} />
        </>)}
        {kind === 'part' && (<>
          {info.status && <div className="kb-tags"><Badge tone={statusTone(info.status)}>{info.status}</Badge></div>}
          {info.note && <Alert tone="warning"><Hl text={info.note} re={re} /></Alert>}
          <Facts rows={[['Part number', rec.partNo], ['Name', rec.name], ['Also called', rec.aliases], ['Fits', rec.fits]]} re={re} />
          <PnLinks title="Replaced by" pns={info.replacedBy} parts={parts} onOpen={onOpen} />
          <PnLinks title="Replaces" pns={info.replaces} parts={parts} onOpen={onOpen} />
          {info.rest && <Rich text={info.rest} re={re} />}
          {rec.diagram && (/^https?:\/\//i.test(rec.diagram)
            ? <p><a href={rec.diagram} target="_blank" rel="noopener noreferrer">Open the diagram</a></p>
            : <Facts rows={[['Diagram', rec.diagram]]} re={re} />)}
          {partsUsing.articles.length > 0 && <Linked title="Articles that mention it" rows={partsUsing.articles.map((a) => [a.id, a.title, 'article'])} onOpen={onOpen} />}
          {usedOn.length > 0 && <Linked title="Past jobs that used it" rows={usedOn.map((j) => [j.id, `${j.jobNo ? 'Job ' + j.jobNo + ': ' : ''}${j.title}`, 'job'])} onOpen={onOpen} />}
        </>)}
        {kind === 'device' && (
          <Facts rows={[['Site', rec.site], ['Department', rec.dept], ['Model', rec.model], ['Serial', rec.serial], ['Software', rec.version], ['Options', rec.options], ['Notes', rec.notes], ...Object.entries(rec.extra || {})]} re={re} />
        )}
        {kind === 'job' && (<>
          <Facts rows={[['Job', rec.jobNo], ['Site', rec.site], ['Date', NZ(rec.date)], ['Models', rec.model], ['Parts', rec.parts]]} re={re} />
          <Rich text={rec.notes} re={re} />
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

/** Part numbers that are in the catalogue open it; ones that are not are just shown. */
function PnLinks({ title, pns, parts, onOpen }) {
  if (!pns.length) return null
  return (
    <div className="kb-linked">
      <h3>{title}</h3>
      <ul>{pns.map((pn) => {
        const p = parts.find((x) => compact(x.partNo) === compact(pn))
        return <li key={pn}>{p ? <button type="button" className="kb-link" onClick={() => onOpen('part', p.id)}>{`${p.partNo}${p.name ? ' · ' + p.name : ''}`}</button> : pn}</li>
      })}</ul>
    </div>
  )
}

export const statusTone = (s) => /^active/i.test(s) ? 'green' : /do not use|wrong/i.test(s) ? 'critical' : /supersed|obsolete/i.test(s) ? 'orange' : 'neutral'

function Linked({ title, rows, onOpen }) {
  return (
    <div className="kb-linked">
      <h3>{title}</h3>
      <ul>{rows.slice(0, 20).map(([id, label, kind]) => <li key={id}><button type="button" className="kb-link" onClick={() => onOpen(kind, id)}>{label}</button></li>)}</ul>
    </div>
  )
}

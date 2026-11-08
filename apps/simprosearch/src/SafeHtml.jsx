/* Draws Simpro's rich text (html.js) as React elements: only the tags html.js lets through, never raw HTML on the page.
   `mark`: text to highlight wherever it appears. */
import { Fragment } from 'react'
import { htmlToTree, splitByTerms } from './html.js'

function Text({ v, mark }) {
  if (!mark || (Array.isArray(mark) && !mark.length)) return v
  return splitByTerms(v, mark).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>))
}

function Node({ n, mark }) {
  if (n.t === 'text') return <Text v={n.v} mark={mark} />
  const kids = n.kids.map((k, i) => <Node key={i} n={k} mark={mark} />)
  switch (n.tag) {
    case 'br': return <br />
    case 'hr': return <hr />
    case 'a': return n.href ? <a href={n.href} target="_blank" rel="noopener noreferrer">{kids}</a> : <span>{kids}</span>
    case 'table': return <div className="ds-table-scroll"><table>{kids}</table></div>
    case 'thead': case 'tbody': case 'tr': case 'td': case 'th': return <n.tag>{kids}</n.tag>
    default: return <n.tag>{kids}</n.tag> // every other tag is one of html.js's list (p, div, ul, li, b, h3 …)
  }
}

export default function SafeHtml({ html, mark = '', empty = 'Nothing written.' }) {
  const tree = htmlToTree(html)
  if (!tree.length) return <p className="ds-empty">{empty}</p>
  return <div className="ds-rich">{tree.map((n, i) => <Node key={i} n={n} mark={mark} />)}</div>
}

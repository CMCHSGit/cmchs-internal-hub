// "Needs you": a compact row on the home page, hidden when nothing is waiting.
// Items come from needs.js; each one opens its page.
import { useEffect, useState } from 'react'
import { EVENT, KEY, readAll } from '../../../shared/badges.js'
import Icon from './Icon.jsx'
import { needsYou } from './needs.js'

/** Every section's count (shared/badges.js), kept current across this browser's tabs. */
function useBadges() {
  const [all, setAll] = useState(readAll)
  useEffect(() => {
    const update = () => setAll(readAll())
    const other = e => { if (e.key === KEY) update() }
    window.addEventListener(EVENT, update)
    window.addEventListener('storage', other)
    return () => { window.removeEventListener(EVENT, update); window.removeEventListener('storage', other) }
  }, [])
  return all
}

export default function NeedsYou({ asks }) {
  const badges = useBadges()
  const items = needsYou({ badges, asks })
  if (!items.length) return null
  return (
    <section className="needs-you" aria-label="Needs you">
      <span className="chs-overline needs-over">Needs you</span>
      <ul className="needs-list">
        {items.map(i => (
          <li key={i.id}>
            <a className={`needs-item${i.urgent ? ' urgent' : ''}`} href={i.link} title={i.hint || undefined}>
              <Icon name={i.icon} size={16} />
              <span className="needs-text">{i.text}</span>
              {i.hint && <span className="caption needs-hint">{i.hint}</span>}
              <Icon name="arrow-right" size={14} className="needs-go" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* Service: the service team's tools on one page, laid out like Checklists' list. Each card opens its tool.
   The list is tools.json's service tools (apps/hub/src/tools.js), the same ones as the header's Service menu. */
import { serviceTools, groupStyle, serviceGroupOf, SERVICE_GROUPS } from '../../hub/src/tools.js'

export default function ServicePage() {
  // Only the groups that have a tool, in the order they are listed in tools.js.
  // The cards show the full name, so they are in the order of the full names (the menu sorts by its shorter ones).
  const cards = [...serviceTools].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  const used = Object.entries(SERVICE_GROUPS).filter(([, g]) => serviceTools.some(t => serviceGroupOf(t.id) === g))
  return (
    <div className="sv-page">
      <div className="sv-head">
        <div>
          <h1 className="sv-title">Service</h1>
          <p className="sv-sub">The service team’s tools: orders, test reports, PDF editing, asset sync, maintenance, on call and checklists.</p>
        </div>
      </div>
      <ul className="sv-legend" aria-label="Colour key">
        {used.map(([key, g]) => <li key={key} style={{ '--grp': g.color, '--grp-dark': g.dark }}><span className="sv-dot" aria-hidden="true" />{g.name}</li>)}
      </ul>
      <ul className="sv-lists">
        {cards.map(t => (
          <li key={t.id}>
            <a className="sv-card" href={t.link} style={groupStyle(t.id)}>
              <span className="sv-name">{t.name}</span>
              <span className="sv-meta">{t.description}</span>
              <span className="sv-group">{serviceGroupOf(t.id).name}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

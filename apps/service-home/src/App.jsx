/* Service: the service team's tools on one page, laid out like Checklists' list. Each card opens its tool.
   The list is tools.json's service tools (apps/hub/src/tools.js), the same ones as the header's Service menu. */
import { serviceTools } from '../../hub/src/tools.js'

export default function ServicePage() {
  return (
    <div className="sv-page">
      <div className="sv-head">
        <div>
          <h1 className="sv-title">Service</h1>
          <p className="sv-sub">The service team’s tools: orders, test reports, asset sync, maintenance, on call and checklists.</p>
        </div>
      </div>
      <ul className="sv-lists">
        {serviceTools.map(t => (
          <li key={t.id}>
            <a className="sv-card" href={t.link}>
              <span className="sv-name">{t.name}</span>
              <span className="sv-meta">{t.description}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

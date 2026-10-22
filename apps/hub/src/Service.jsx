/* Service: the service team's tools together (Service orders, Ansur reports, Simpro sync, Maintenance
   Schedule), as a page of their own next to Projects. They are still opened at their own addresses;
   this lists them from tools.json's "Service" category. */
import Icon from './Icon.jsx'
import { ToolCard } from './Home.jsx'
import { tools } from './tools.js'

export default function Service() {
  const list = tools.filter(t => t.category === 'Service')
  return (
    <main className="pp-page">
      <div className="pp-head">
        <div className="section-head-text">
          <span className="section-stripes" aria-hidden="true"><span style={{ background: '#554596' }} /><span style={{ background: '#ef7d00' }} /></span>
          <span className="chs-overline">Service</span>
          <h2>Service tools</h2>
        </div>
      </div>
      <div className="tool-grid">{list.map(t => <ToolCard key={t.id} tool={t} />)}</div>
      {list.length === 0 && <p className="body-sm"><Icon name="wrench" size={16} /> No service tools yet.</p>}
    </main>
  )
}

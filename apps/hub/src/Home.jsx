import { firstNameOf } from '../../../shared/session.js'
import Icon from './Icon.jsx'
import { announcements, hostOf, markUsed, opensInTab, recentTools, toolGroups } from './tools.js'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const dateLabel = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`

// A tool link: same tab for pages on this site, new tab for other sites.
function ToolLink({ tool, className, children }) {
  const tab = opensInTab(tool)
  return (
    <a
      className={className}
      href={tool.link}
      target={tab ? '_blank' : undefined}
      rel={tab ? 'noopener' : undefined}
      onClick={() => markUsed(tool)}
    >
      {children}
    </a>
  )
}

function ToolCard({ tool }) {
  const tab = opensInTab(tool)
  return (
    <div className="card card-interactive tool-card">
      <div className="tool-card-top">
        <span className="tile tile-40"><Icon name={tool.icon} size={20} /></span>
        {tab
          ? <span className="tool-card-tab" title="Opens in a new tab"><Icon name="external-link" size={16} /></span>
          : <a className="icon-btn" href={tool.link} target="_blank" rel="noopener" aria-label={`Open ${tool.name} in a new tab`}
               title="Open in a new tab" onClick={() => markUsed(tool)}>
              <Icon name="external-link" size={16} />
            </a>}
      </div>
      <div className="tool-card-body">
        {/* The name link stretches over the whole card (see .tool-card-link::after) */}
        <ToolLink tool={tool} className="tool-card-link">{tool.name}</ToolLink>
        <span className="body-sm">{tool.description}</span>
      </div>
      <span className="mono host">{hostOf(tool)}</span>
    </div>
  )
}

export default function Home({ user }) {
  const recent = recentTools()
  const groups = toolGroups()
  const hasAnnouncements = announcements.length > 0

  return (
    <main className="page">
      <div className="greeting">
        <span className="chs-overline">{dateLabel(new Date())}</span>
        <h1>Kia ora, {firstNameOf(user)}</h1>
      </div>

      <div className={hasAnnouncements ? 'home-cols' : 'home-cols home-cols-single'}>
        <div className="stack-28">
          {recent.length > 0 && (
            <section className="stack-10" aria-label="Recently used">
              <span className="chs-overline">Recently used</span>
              <div className="recent-row">
                {recent.map(t => (
                  <ToolLink key={t.id} tool={t} className="recent-btn">
                    <span className="recent-icon"><Icon name={t.icon} size={18} /></span>{t.name}
                  </ToolLink>
                ))}
              </div>
            </section>
          )}

          {groups.map(g => (
            <section key={g.name} className="stack-10" aria-label={g.name}>
              <div className="group-head">
                <span className="group-stripes" aria-hidden="true">
                  <span style={{ background: g.c1 }} /><span style={{ background: g.c2 }} />
                </span>
                <h4>{g.name}</h4>
                <span className="mono group-count">{g.tools.length}</span>
              </div>
              <div className="tool-grid">
                {g.tools.map(t => <ToolCard key={t.id} tool={t} />)}
              </div>
            </section>
          ))}
        </div>

        {hasAnnouncements && (
          <aside className="stack-10" aria-label="Announcements">
            <span className="chs-overline">Announcements</span>
            <div className="card card-stripes announcements">
              {announcements.map(a => (
                <article key={a.id} className="announcement">
                  <div className="announcement-meta">
                    {a.pinned && <span className="badge badge-orange">Pinned</span>}
                    <span className="caption">{a.date} · {a.author}</span>
                  </div>
                  <span className="announcement-title">{a.title}</span>
                  <span className="body-sm">{a.body}</span>
                </article>
              ))}
            </div>
          </aside>
        )}
      </div>
    </main>
  )
}

/* Overview: the phone's two home screens in one (old: mpRenderToday and
   mpRenderOverview). "Yours" is the account manager's Today: their loans,
   what needs doing and what's coming up, shown when the sign-in matches a
   person on the tracker's team with loans of their own, or an account
   manager. "Everyone" is the Service & Projects overview: how much is out,
   what's waiting on a transfer, overdue, or still to be tested, and each
   account manager's loans. Every row opens that loan in Loans. */
import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { Badge } from '../../../shared/ui/index.jsx'
import { fmtDate, loanSections, overviewOf, roleOf, yoursOf } from './model.js'

/** Loans, opened at one loan (Loans.jsx reads ?open=). */
export const loanLink = (g) => '#/loans?open=' + encodeURIComponent(g.kind + ':' + g.key)
const loansLink = (params = {}) => { const q = new URLSearchParams(params).toString(); return '#/loans' + (q ? '?' + q : '') }
const devices = (n) => `${n} ${n === 1 ? 'device' : 'devices'}`

export default function Overview({ s }) {
  const sections = useMemo(() => loanSections({ equipment: s.equipment, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, today: s.today, testMode: s.testMode }),
    [s.equipment, s.upcoming, s.loanMeta, s.loanDocs, s.today, s.testMode])
  const ov = useMemo(() => overviewOf(sections, { equipment: s.equipment, upcoming: s.upcoming, loanMeta: s.loanMeta, today: s.today, testMode: s.testMode }),
    [sections, s.equipment, s.upcoming, s.loanMeta, s.today, s.testMode])

  // A booking waiting on a transfer opens as the loan it's part of, if any.
  const all = [...sections.needsReassign, ...sections.upcoming, ...sections.current, ...sections.longTerm]
  const stuckLink = (u) => loanLink(all.find((g) => g.batchId === u.id) || { kind: 'booking', key: u.id })
  // …which is under Needs reassigning once some of it has gone out, else still under Upcoming.
  const stuckAt = ov.stuck.length && all.find((g) => g.batchId === ov.stuck[0].id)?.kind === 'loan' ? 'needsReassign' : 'upcoming'

  const me = s.me // the sign-in's place on the tracker's team (store.jsx)
  const mine = me ? yoursOf(ov, me.name) : null
  // A true/false, never a count: a bare 0 here would be drawn on the page.
  const showMine = !!mine && (roleOf(me) === 'am' || mine.active.length > 0 || mine.ahead.length > 0 || mine.stuck.length > 0)

  return (
    <div className="eq-overview">
      {showMine && <Yours me={me} mine={mine} today={s.today} stuckLink={stuckLink} />}
      <Everyone ov={ov} today={s.today} stuckLink={stuckLink} stuckAt={stuckAt} heading={showMine} />
      {!s.extrasReady && !me && <p className="eq-note">Your own loans show here once the team list has loaded.</p>}
    </div>
  )
}

function Yours({ me, mine, today, stuckLink }) {
  const alerts = [
    ...mine.stuck.map((u) => ({ key: 's' + u.id, tag: 'Transfer due', tone: 'purple', who: u.loanTo, what: `${devices((u.items || []).length)} to transfer today`, href: stuckLink(u) })),
    ...mine.overdue.map((g) => ({ key: 'o' + g.kind + g.key, tag: 'Overdue', tone: 'critical', who: g.loanTo, what: 'Due ' + fmtDate(g.endDate), href: loanLink(g) })),
  ]
  const am = { am: me.name }
  return (
    <section className="eq-ov-part" aria-labelledby="eq-ov-yours">
      <div>
        <h2 id="eq-ov-yours" className="eq-ov-hello">Kia ora, {me.name.split(' ')[0]}</h2>
        <p className="eq-note">Your loans · {fmtDate(today)}</p>
      </div>
      <div className="eq-tiles">
        <Tile href={loansLink(am)} value={mine.active.length} label="Active loans" />
        <Tile href={loansLink({ ...am, overdue: '1' })} value={mine.overdue.length} label="Overdue" tone={mine.overdue.length ? 'critical' : ''} />
        <Tile href={loansLink({ ...am, at: 'upcoming' })} value={mine.ahead.length} label="Upcoming" tone="brand" />
      </div>
      {alerts.length > 0 && (
        <List title="Action required">
          {alerts.map((a) => <Row key={a.key} href={a.href} who={a.who} what={a.what} side={<Badge tone={a.tone}>{a.tag}</Badge>} />)}
        </List>
      )}
      <List title="Coming up" empty="Nothing booked ahead.">
        {mine.ahead.slice(0, 5).map((g) => (
          <Row key={g.kind + g.key} href={loanLink(g)} who={g.loanTo} what={'Starts ' + fmtDate(g.startDate)}
            date={new Date(g.startDate + 'T12:00:00')} />
        ))}
      </List>
    </section>
  )
}

function Everyone({ ov, today, stuckLink, stuckAt, heading }) {
  const pct = (n) => (ov.total ? (n / ov.total) * 100 : 0)
  const ok = Math.max(0, ov.out - ov.overdueOut - ov.dueTodayOut)
  return (
    <section className="eq-ov-part" aria-labelledby="eq-ov-all">
      <div>
        <h2 id="eq-ov-all" className={heading ? 'eq-section-title' : 'eq-ov-hello'}>{heading ? 'Everyone' : 'Fleet overview'}</h2>
        <p className="eq-note">{ov.total} assets · all account managers · {fmtDate(today)}</p>
      </div>
      <div className="card eq-util">
        <div className="eq-util-head"><span>Utilisation</span><span className="eq-mono">{ov.out} of {ov.total} out</span></div>
        <div className="eq-util-bar" role="img" aria-label={`${ov.out} of ${ov.total} out: ${ov.dueTodayOut} due back today, ${ov.overdueOut} overdue`}>
          <span style={{ width: pct(ok) + '%' }} className="ok" />
          <span style={{ width: pct(ov.dueTodayOut) + '%' }} className="today" />
          <span style={{ width: pct(ov.overdueOut) + '%' }} className="late" />
        </div>
        <div className="eq-util-key" aria-hidden="true">
          <span><i className="ok" />On loan</span><span><i className="today" />Due back today</span>
          <span><i className="late" />Overdue</span><span><i />Available</span>
        </div>
      </div>
      <div className="eq-tiles eq-tiles-4">
        <Tile href={loansLink()} value={ov.active.length} label="Loans active" />
        <Tile href={loansLink({ overdue: '1' })} value={ov.overdue.length} label="Overdue" tone={ov.overdue.length ? 'critical' : ''} />
        <Tile href={loansLink({ at: 'upcoming' })} value={ov.ahead.length} label="Upcoming loans" tone="brand" />
        <Tile href={loansLink({ at: stuckAt })} value={ov.stuck.length} label="Transfers due" tone="brand" />
      </div>
      {ov.stuck.length > 0 && (
        <List title="Waiting on a transfer">
          {ov.stuck.map((u) => (
            <Row key={u.id} href={stuckLink(u)} who={u.loanTo} what={`${u.accountManager || 'Unassigned'} · waiting since ${fmtDate(u.startDate)}`}
              side={<Badge tone="critical">{devices((u.items || []).length)}</Badge>} />
          ))}
        </List>
      )}
      {ov.overdue.length > 0 && (
        <List title="Awaiting return">
          {ov.overdue.map((g) => (
            <Row key={g.kind + g.key} href={loanLink(g)} who={g.loanTo} what={`Due ${fmtDate(g.endDate)} · ${g.am || '—'}`}
              side={<Badge tone="critical">{devices(g.items.length)}</Badge>} />
          ))}
        </List>
      )}
      {ov.needsTesting.length > 0 && (
        <List title="Upcoming, needs testing">
          {ov.needsTesting.map((g) => (
            <Row key={g.kind + g.key} href={loanLink(g)} who={g.loanTo} what={`Starts ${fmtDate(g.startDate)} · ${g.am || '—'}`}
              side={<Badge tone="neutral">{devices(g.items.length)}</Badge>} />
          ))}
        </List>
      )}
      <List title="By account manager" empty="No active loans.">
        {ov.byAM.map((v) => (
          <Row key={v.am} href={loansLink({ am: v.am === 'Unassigned' ? '' : v.am, ...(v.overdue ? { overdue: '1' } : {}) })} who={v.am}
            side={<>{v.overdue > 0 && <Badge tone="critical">{v.overdue} overdue</Badge>}<span className="eq-mono eq-ov-n">{v.n}</span></>} />
        ))}
      </List>
    </section>
  )
}

function Tile({ href, value, label, tone = '' }) {
  return (
    <a href={href} className="card eq-tile">
      <span className={`eq-tile-val${tone ? ' ' + tone : ''}`}>{value}</span>
      <span className="eq-tile-label">{label}</span>
    </a>
  )
}

function List({ title, empty, children }) {
  const rows = [children].flat(2).filter(Boolean)
  return (
    <div className="eq-ov-list">
      <h3 className="eq-section-title">{title}</h3>
      <div className="card eq-rows">{rows.length ? rows : <p className="eq-note eq-rows-empty">{empty}</p>}</div>
    </div>
  )
}

function Row({ href, who, what, side, date }) {
  return (
    <a href={href} className="eq-row">
      {date && <span className="eq-date-chip" aria-hidden="true"><span>{date.toLocaleDateString('en-NZ', { weekday: 'short' })}</span><span>{date.getDate()}</span></span>}
      <span className="eq-row-main"><span className="eq-strong">{who}</span>{what && <span className="eq-small">{what}</span>}</span>
      {side && <span className="eq-row-side">{side}</span>}
      <ChevronRight size={16} aria-hidden="true" className="eq-row-go" />
    </a>
  )
}

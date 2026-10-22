import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { getCurrentWeekStart, DAY_SHORT } from '../utils/week'
import { shortNames } from '../utils/names'
import { teamLabel } from '../utils/teams'
import { filterPlaces, placesInWeek } from '../utils/places'
import { useUsers, useSchedules, useOnCall } from '../hooks/useScheduleData'
import WeekNav from '../components/WeekNav'
import { Loading, Tag } from '../components/ui'

/**
 * Who's where this week, by place: pick a hospital or site and see who is there and on which days.
 * The same data as Team week (their entries, with the on-call roster's customer calls folded in), turned round.
 */
export default function Places() {
  const [weekOffset, setWeekOffset] = useState(0)
  const weekStart = getCurrentWeekStart(weekOffset)
  const { users, loading: usersLoading } = useUsers()
  const { byWeek, loading: schedLoading } = useSchedules([weekStart])
  const { byWeek: oncallByWeek } = useOnCall([weekStart])
  return (
    <PlacesView
      weekStart={weekStart} weekOffset={weekOffset} onWeek={setWeekOffset}
      users={users} schedules={byWeek[weekStart] || {}} oncall={oncallByWeek[weekStart]} loading={usersLoading || schedLoading}
    />
  )
}

/** The page itself, from data it's given (so it can be looked at without the database). */
export function PlacesView({ weekStart, weekOffset, onWeek, users, schedules, oncall, loading }) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false) // also the office, remote support and working from home
  const names = useMemo(() => shortNames(users), [users])

  const places = useMemo(
    () => placesInWeek({ weekStart, users, schedules, oncall, names, all }),
    [weekStart, users, schedules, oncall, names, all]
  )
  const shown = filterPlaces(places, query)

  return (
    <div className="page">
      <WeekNav
        weekStart={weekStart}
        isThisWeek={weekOffset === 0}
        onPrev={() => onWeek(weekOffset - 1)}
        onNext={() => onWeek(weekOffset + 1)}
        onThisWeek={() => onWeek(0)}
      />
      <div className="people-filter">
        <label className="search-input">
          <Search size={18} aria-hidden="true" />
          <input type="search" value={query} placeholder="Filter by place, e.g. Waikato" aria-label="Filter by place" onChange={e => setQuery(e.target.value)} />
        </label>
        <div className="tag-row" data-no-ptr>
          <Tag selected={!all} onClick={() => setAll(false)}>Away from the office</Tag>
          <Tag selected={all} onClick={() => setAll(true)}>Every place</Tag>
        </div>
      </div>

      <div className="day-title-row">
        <h1 className="page-title">Who’s where this week</h1>
        {!loading && <span className="page-sub">{shown.length} {shown.length === 1 ? 'place' : 'places'}{query.trim() ? ` matching “${query.trim()}”` : ''}</span>}
      </div>

      {loading ? <Loading /> : shown.length === 0 ? (
        <p className="page-sub">{places.length ? 'No place matches that.' : all ? 'Nobody has a place entered this week.' : 'Nobody is away from the office this week.'}</p>
      ) : (
        <div className="day-groups">
          {shown.map(p => (
            <section key={p.key} className="day-group" aria-label={p.place}>
              <div className="day-group-head">
                <span className="day-group-label">{p.place}</span>
                <span className="day-group-count">{p.people.length}</span>
              </div>
              <div className="day-group-people">
                {p.people.map(who => (
                  <div key={who.uid} className="day-person place-person">
                    <span className="day-person-name">{who.name}</span>
                    <span className="day-person-meta">{teamLabel(who.team || null)}</span>
                    <span className="place-days" aria-label={`Days: ${who.days.map(d => DAY_SHORT[d]).join(', ')}`}>
                      {DAY_SHORT.map((d, i) => <span key={d} className={who.days.includes(i) ? 'place-day on' : 'place-day'} aria-hidden="true">{d[0]}</span>)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

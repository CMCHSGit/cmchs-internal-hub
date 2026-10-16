/* Asks for the one app's Ctrl+K (apps/hub/src/Palette.jsx). Loaded the first
   time the search opens: the asks this person can see (the same query, and so
   the same security rules, as Asks itself), by title, details, who asked, who
   has it and what it is waiting on. An ask opens in Asks with its panel open. */
import { getBackend } from './backend.js'
import { dueLabel, statusOf, todayISO } from './model.js'
import { scoreOf, words } from '../../hub/src/search.js'

/** Starts watching; calls onData with the latest whenever anything changes. Returns stop(). */
export function start(user, onData) {
  let stop = () => {}
  let stopped = false
  const quiet = () => {}
  getBackend().then(async (be) => {
    // Asks sent to a team need the person's team, which is on their profile.
    let profile = {}
    try { profile = (await be.profile(user.uid)) || {} } catch { /* no profile yet: their own asks only */ }
    if (stopped) return
    const me = { uid: user.uid, name: profile.displayName || user.displayName || '', team: profile.team || '', role: profile.role || 'user' }
    stop = be.watchAsks(me, (asks) => onData({ asks }), quiet)
  }).catch(quiet)
  return () => { stopped = true; stop() }
}

export function search(q, state) {
  const toks = words(q)
  if (!toks.length || !state?.asks?.length) return []
  const today = todayISO()
  return state.asks
    .map((a) => {
      const status = statusOf(a.status).label
      const score = scoreOf(toks, a.title, `${a.details || ''} ${a.createdByName || ''} ${a.ownerName || ''} ${a.waitingOn || ''} ${status}`)
      return score && {
        key: 'ask:' + a.id,
        group: 'asks',
        title: a.title,
        sub: [
          a.status === 'waiting' && a.waitingOn ? `Waiting on ${a.waitingOn}` : status,
          a.createdByName && `from ${a.createdByName}`,
          a.ownerName && `${a.ownerName} has it`,
          a.status !== 'done' && a.due && dueLabel(a.due, today),
        ].filter(Boolean).join(' · '),
        href: `/asks/#/all?ask=${encodeURIComponent(a.id)}`,
        // Outstanding asks before done ones that match as well.
        score: score + (a.status === 'done' ? 0 : 1),
      }
    })
    .filter(Boolean)
}

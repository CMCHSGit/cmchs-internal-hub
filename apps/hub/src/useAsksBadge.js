// The red count on the header's Asks tab: how many of your asks have something new on them (a comment, someone
// picking it up, ...) that you haven't opened yet. The same count the home panel shows as "N new", worked out
// here for every page so it's there whichever section is open. It lands in shared/badges.js like the demo
// tracker's, so it also reaches the phone's bottom tabs and the app icon.
import { useEffect } from 'react'
import { setBadge } from '../../../shared/badges.js'
import { readSeen, unreadAsks, watchMyAsks } from './asks.js'

/** Fired by Asks when an ask is opened in this tab: localStorage's own event only reaches other tabs. */
export const SEEN_EVENT = 'asks:seen'

export default function useAsksBadge(user, enabled) {
  useEffect(() => {
    if (!enabled || !user) return
    let live = true
    let off = () => {}
    let data = null
    const show = () => setBadge('asks', unreadAsks(data, readSeen()))
    watchMyAsks(user, d => { data = d; show() }).then(u => { if (live) off = u; else u() })
    const storage = e => { if (e.key === 'asks:seen') show() }
    const back = () => { if (document.visibilityState === 'visible') show() }
    window.addEventListener(SEEN_EVENT, show)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', back)
    return () => {
      live = false; off()
      window.removeEventListener(SEEN_EVENT, show); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', back)
    }
  }, [user, enabled])
}

// Each person's home page: which tools and links sit in the round-icon row, and in what order.
// Saved on their own record (users/{uid}.homeLayout = { quick: [...] }) so it follows them to every
// device, and kept in this browser too so it shows at once and still works if the save is refused
// (until the Firestore rules that allow it are published).
//
// An entry is a tool's id ("asks") or a link the person added ({ label, url }).
import { useCallback, useEffect, useState } from 'react'
import { SERVICE_TOOL_IDS, tools } from './tools.js'

const MAX_ENTRIES = 30
const localKey = uid => 'hub:home-layout:' + uid

/** What everyone starts with: every tool except the service ones (they're in the Service menu). */
export const defaultEntries = () => tools.filter(t => !SERVICE_TOOL_IDS.includes(t.id)).map(t => t.id)

/** Link addresses people can add: a full https:// address, or a page on this site. */
export const safeUrl = u => /^https:\/\/[^\s/]+\.[^\s]+$/i.test(u) || /^\/[A-Za-z0-9_\-./?#=&%]*$/.test(u)

/** Only what is valid: known tools once each, links with a label and a safe address. */
export function cleanEntries(list) {
  const seen = new Set(), out = []
  for (const e of Array.isArray(list) ? list : []) {
    if (typeof e === 'string') {
      if (tools.some(t => t.id === e) && !seen.has(e)) { seen.add(e); out.push(e) }
    } else if (e && typeof e.label === 'string' && typeof e.url === 'string' && e.label.trim() && safeUrl(e.url.trim())) {
      out.push({ label: e.label.trim().slice(0, 40), url: e.url.trim() })
    }
  }
  return out.slice(0, MAX_ENTRIES)
}

/** Entries as things the hero can draw: { key, tool } where a link is shaped like a tool. */
export function resolveEntries(entries) {
  return cleanEntries(entries).map((e, i) => {
    if (typeof e === 'string') return { key: e, tool: tools.find(t => t.id === e) }
    const external = /^https:/i.test(e.url)
    // The site's own icon (asked of Google's favicon service by site name, nothing else); the link icon if there isn't one.
    const favicon = external ? 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(new URL(e.url).hostname) : ''
    return { key: 'link:' + i + e.url, tool: { id: 'link:' + i, name: e.label, short: e.label, description: e.url, link: e.url, icon: 'link', favicon, opens: external ? 'tab' : 'here' } }
  })
}

function readLocal(uid) {
  try { const v = JSON.parse(localStorage.getItem(localKey(uid)) || 'null'); return v ? cleanEntries(v) : null } catch { return null }
}
function writeLocal(uid, entries) {
  try { localStorage.setItem(localKey(uid), JSON.stringify(entries)) } catch { /* private window: it just won't be kept here */ }
}
function clearLocal(uid) { try { localStorage.removeItem(localKey(uid)) } catch { /* nothing to clear */ } }

async function userDoc(uid) {
  const [{ getApp }, fs] = await Promise.all([import('firebase/app'), import('firebase/firestore')])
  const db = (await import('../../../shared/firestore.js')).firestore(getApp())
  return { fs, ref: fs.doc(db, 'users', uid) }
}

/**
 * The person's row of icons: [entries, save, reset]. save/reset resolve to '' or a message when it
 * couldn't be kept on their record (it is still kept in this browser).
 */
export function useHomeLayout(uid) {
  const [entries, setEntries] = useState(() => (uid && readLocal(uid)) || defaultEntries())

  useEffect(() => {
    if (!uid) return undefined
    let off = false
    userDoc(uid).then(({ fs, ref }) => fs.getDoc(ref)).then(snap => {
      const remote = snap.data()?.homeLayout?.quick
      if (off || !Array.isArray(remote)) return
      const clean = cleanEntries(remote)
      if (clean.length) { setEntries(clean); writeLocal(uid, clean) }
    }).catch(() => { /* signed out or no sign-in configured: keep what this browser has */ })
    return () => { off = true }
  }, [uid])

  const save = useCallback(async next => {
    const clean = cleanEntries(next)
    setEntries(clean); writeLocal(uid, clean)
    try {
      const { fs, ref } = await userDoc(uid)
      await fs.updateDoc(ref, { homeLayout: { quick: clean } })
      return ''
    } catch (e) {
      return e?.code === 'permission-denied'
        ? 'Saved on this device only: saving to your account needs a rules change that isn’t published yet.'
        : 'Saved on this device only: ' + (e?.message || 'couldn’t reach your account.')
    }
  }, [uid])

  const reset = useCallback(async () => {
    clearLocal(uid); setEntries(defaultEntries())
    try {
      const { fs, ref } = await userDoc(uid)
      await fs.updateDoc(ref, { homeLayout: fs.deleteField() })
      return ''
    } catch (e) { return e?.code === 'permission-denied' ? 'Reset on this device only (rules not published yet).' : '' }
  }, [uid])

  return [entries, save, reset]
}

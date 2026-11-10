// New tools to announce: when a tool appears in tools.json, Manage → News
// offers a ready-made "Tool updates" draft for it. Nothing is posted until
// someone checks it and presses Post; "Don't announce" puts it away for
// everyone.
//
// A tool counts as announced when it was here before this feature (KNOWN_TOOLS),
// when a post carries its id (announcements/{id}.toolId, set when the draft is
// posted), or when someone chose not to announce it (settings/toolNews.dismissed).
// If that settings record can't be written (its rule not published yet) the
// choice is kept in this browser instead, and Manage says so.
import { isoToday } from './news.js'

/** Every tool in tools.json when this started (11 Nov 2026): none of these is offered. Never add to this list. */
export const KNOWN_TOOLS = [
  'schedule', 'demo', 'asks', 'service-orders', 'ansur', 'testbench', 'new-equipment', 'pdf-editor', 'simpro',
  'simpro-search', 'maintenance', 'oncall', 'checklists', 'knowledge', 'projects', 'outlook', 'teams',
]

export const SITE = 'https://internal.chsnz.co.nz'
export const isToolId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id)

/** The tools still to announce, in tools.json order. `tools` are the visible ones (tools.js). */
export function toolsToAnnounce(tools, announcements = [], dismissed = []) {
  const done = new Set([...KNOWN_TOOLS, ...dismissed, ...announcements.map(a => a.toolId).filter(Boolean)])
  return tools.filter(t => isToolId(t.id) && !done.has(t.id))
}

/** Where someone finds it, in words. `service`: it's in the header's Service menu (SERVICE_TOOL_IDS in tools.js). */
function whereOf(tool, service) {
  if (service) return 'from the Service menu in the hub’s header'
  return tool.category ? `from the ${tool.category} section on the hub’s home page` : 'from the hub’s home page'
}

/** A tool -> the fields AnnouncementEditor starts from. */
export function toolDraft(tool, { service = false, today = isoToday() } = {}) {
  const desc = String(tool.description || '').trim().replace(/[.\s]+$/, '')
  const address = /^https?:\/\//i.test(tool.link || '') ? tool.link : tool.link ? SITE + tool.link : ''
  const open = `Open it ${whereOf(tool, service)}${address ? `, or go to ${address}` : ''}.`
  return {
    category: 'Tool updates',
    title: `New tool: ${tool.name}`.slice(0, 200),
    body: [desc ? `${desc}.` : '', open].filter(Boolean).join('\n\n'),
    toolId: tool.id,
    date: today,
    regions: [],
    pinned: false,
  }
}

// ── Who chose not to announce what (settings/toolNews) ────────────────────

const devMode = import.meta.env?.DEV && !import.meta.env?.VITE_FIREBASE_API_KEY
const LOCAL_KEY = 'hub:tool-news-dismissed'
const MAX_DISMISSED = 200

function readLocal() {
  try { const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); return Array.isArray(v) ? v.filter(isToolId) : [] } catch { return [] }
}
function writeLocal(ids) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(ids)) } catch { /* private window: not kept */ }
}

async function settingsDoc() {
  const { fs } = await import('./news.js')
  const { f, db } = await fs()
  return { f, db, ref: f.doc(db, 'settings', 'toolNews') }
}

/** Ids nobody needs to announce: everyone's choices, plus any kept only in this browser. */
export async function loadDismissed() {
  const here = readLocal()
  if (devMode) return here
  try {
    const { f, ref } = await settingsDoc()
    const snap = await f.getDoc(ref)
    const there = (snap.data()?.dismissed || []).filter(isToolId)
    return [...new Set([...there, ...here])]
  } catch { return here }
}

/** "Don't announce": resolves to '' or a message when it is kept in this browser only. */
export async function dismissTool(id) {
  if (!isToolId(id)) return ''
  writeLocal([...new Set([...readLocal(), id])])
  if (devMode) return ''
  try {
    const { f, db, ref } = await settingsDoc()
    await f.runTransaction(db, async tx => {
      const snap = await tx.get(ref)
      const was = (snap.data()?.dismissed || []).filter(isToolId)
      tx.set(ref, { dismissed: [...new Set([...was, id])].slice(-MAX_DISMISSED) })
    })
    const { log } = await import('./log.js')
    log('Chose not to announce a new tool')
    return ''
  } catch (e) {
    return e?.code === 'permission-denied'
      ? 'Put away on this device only: doing it for everyone needs a rules change that isn’t published yet.'
      : 'Put away on this device only: ' + (e?.message || 'couldn’t reach the hub.')
  }
}

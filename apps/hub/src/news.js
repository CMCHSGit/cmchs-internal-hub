// Company news: announcements posted from Manage, shown on the home page and
// exported as a team-wide email.
//
//   announcements/{id}       title, body, category, section, regions, people,
//                            pinned, date, author, authorUid, batchId, hasPhoto,
//                            photoCount
//   announcementPhotos/{id}  the first photo (a JPEG data URL), kept apart so the
//                            home page only downloads the ones it shows; any more
//                            are {id}-2, {id}-3 … up to MAX_NEWS_PHOTOS
//
// Everyone signed in reads them; anyone on a team (the same people who edit
// the project tracker) or an admin posts; the author, an admin or HR edits
// and deletes. firestore.rules enforces that.
//
// The announcements.json that used to feed the home page still shows, under
// anything in Firestore with the same id, until an admin moves it across
// (Manage → News → "Move into Manage").
import legacy from '../../../announcements.json' with { type: 'json' }
import { REGIONS, SECTIONS } from './emailSplit.js'

export const CATEGORIES = ['Announcements', 'Team news', 'Events', 'Tool updates']
export const TONE = { Announcements: 'purple', 'Team news': 'green', Events: 'green', 'Tool updates': 'orange' }
export { REGIONS, SECTIONS }

export const categoryOf = a => (CATEGORIES.includes(a.category) ? a.category : 'Announcements')
export const isoToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Monday of the week a date is in (a Sunday belongs to the week just gone). */
export function mondayOf(iso) {
  const d = new Date(iso + 'T00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return isoToday(d)
}
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return isoToday(d) }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-10-09" -> "9 Oct". */
export const shortDate = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? `${Number(s.slice(8))} ${MON[Number(s.slice(5, 7)) - 1]}` : s || '')

/** Pinned first, then newest, then in the order they were posted (a pasted email keeps its order). */
export function sortNews(list) {
  return [...list].sort((a, b) =>
    (b.pinned === true) - (a.pinned === true) || (b.date || '').localeCompare(a.date || '') || (a.order ?? 0) - (b.order ?? 0))
}

/**
 * Firestore's announcements plus the legacy JSON ones it doesn't replace. A
 * deleted JSON one stays in Firestore marked `deleted`, so it doesn't come back.
 */
export function mergeNews(stored, old = legacy) {
  const ids = new Set(stored.map(a => a.id))
  return sortNews([...stored.filter(a => !a.deleted), ...old.filter(a => !ids.has(a.id)).map(a => ({ ...a, legacy: true, regions: [], people: [] }))])
}

const STOP = new Set('the and for with from this that are was were has have its our new next week all off out into onto about'.split(' '))
const words = s => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)))

/**
 * The existing post a pasted draft looks like a repeat of (StepUp4ICU in
 * this week's email when it already has its own post), or null. Compares
 * titles, over the last 60 days; one shared word is enough only when it is
 * a title on its own and a distinctive one ("StepUp4ICU").
 */
export function findSimilar(draft, list, today = isoToday()) {
  const mine = words(draft.title)
  if (!mine.size) return null
  const since = addDays(today, -60)
  let best = null, bestScore = 0
  for (const a of list) {
    if (a.deleted || (a.date || '') < since) continue
    const theirs = words(a.title)
    const shared = [...mine].filter(w => theirs.has(w))
    const score = shared.length / Math.min(mine.size, theirs.size || 1)
    const enough = shared.length >= 2 || (shared.length === 1 && Math.min(mine.size, theirs.size) === 1 && shared[0].length >= 6)
    if (enough && score >= 0.6 && score > bestScore) { best = a; bestScore = score }
  }
  return best
}

/** What the home page's Team news panel shows: the newest week of Team news, split by section. */
export function teamNews(list) {
  const team = list.filter(a => categoryOf(a) === 'Team news')
  if (!team.length) return null
  const latest = team.reduce((m, a) => ((a.weekOf || mondayOf(a.date)) > m ? (a.weekOf || mondayOf(a.date)) : m), '')
  const week = team.filter(a => (a.weekOf || mondayOf(a.date)) === latest).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return {
    weekOf: latest,
    been: week.filter(a => a.section === 'been'),
    next: week.filter(a => a.section === 'next'),
    other: week.filter(a => a.section !== 'been' && a.section !== 'next'),
    regions: REGIONS.filter(r => week.some(a => (a.regions || []).includes(r))),
  }
}

export const canPost = me => !!me && (me.role === 'admin' || ['Admin', 'Management', 'Engineers', 'Sales', 'Application'].includes(me.team))
export const canEdit = (me, a) => !!me && !a.legacy && (me.role === 'admin' || me.hr === true || a.authorUid === me.uid)

/** Turns URLs in plain text into [text, url] pieces, for rendering links without innerHTML. */
export function linkParts(text) {
  const parts = []
  const re = /(https?:\/\/[^\s)]+[^\s).,;:!?])/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push([text.slice(last, m.index), null])
    parts.push([m[1], m[1]])
    last = m.index + m[1].length
  }
  if (last < text.length) parts.push([text.slice(last), null])
  return parts
}

// ── The team-wide email ───────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const htmlText = s => linkParts(s).map(([t, url]) => (url ? `<a href="${esc(url)}" style="color:#554596">${esc(t)}</a>` : esc(t))).join('').replace(/\n/g, '<br>')
const FONT = 'font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1d1d1d'
const H = color => `font-family:Calibri,Arial,sans-serif;font-size:14pt;font-weight:bold;color:${color};margin:18px 0 6px`

/**
 * Selected announcements -> the body of the team-wide email, as HTML (pastes
 * into Outlook with its formatting) and plain text.
 * opts: { groupBy: 'section'|'region', greeting, signoff, photos: { [id]: dataUrl | dataUrl[] } }
 */
export function buildEmail(items, { groupBy = 'section', greeting = 'Hi All,', signoff = '', photos = {} } = {}) {
  const sorted = [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (b.date || '').localeCompare(a.date || ''))
  const features = sorted.filter(a => categoryOf(a) !== 'Team news')
  const team = sorted.filter(a => categoryOf(a) === 'Team news')
  const line = a => [a.title, a.body].filter(Boolean).join(' – ')
  const html = [`<div style="${FONT}">`, `<p style="${FONT}">${esc(greeting)}</p>`]
  const text = [greeting, '']

  for (const a of features) {
    html.push(`<p style="${H('#554596')}">${esc(a.title)}</p>`)
    if (a.body) html.push(`<p style="${FONT};margin:0 0 8px">${htmlText(a.body)}</p>`)
    for (const p of [photos[a.id] || []].flat()) html.push(`<p style="margin:0 0 8px"><img src="${p}" alt="" width="480" style="max-width:480px;border-radius:6px"></p>`)
    text.push(a.title.toUpperCase(), ...(a.body ? [a.body] : []), '')
  }

  const list = (heading, color, rows) => {
    if (!rows.length) return
    html.push(`<p style="${H(color)}">${esc(heading)}</p><ul style="${FONT};margin:0 0 8px 0">`)
    for (const a of rows) html.push(`<li style="margin:0 0 3px">${htmlText(line(a))}</li>`)
    html.push('</ul>')
    text.push(heading, ...rows.map(a => `• ${line(a)}`), '')
  }

  if (groupBy === 'region') {
    const groups = new Map()
    for (const a of team) {
      const r = !a.regions?.length ? 'Around the office and elsewhere' : a.regions.length > 1 ? 'On the road' : a.regions[0]
      groups.set(r, [...(groups.get(r) || []), a])
    }
    const order = [...REGIONS, 'On the road', 'Around the office and elsewhere']
    for (const r of order) {
      const rows = groups.get(r) || []
      if (!rows.length) continue
      const tag = a => (a.section === 'next' ? ' (next week)' : '')
      list(r, '#554596', rows.map(a => ({ ...a, title: a.title + tag(a) })))
    }
  } else {
    list(SECTIONS.been + ':', '#5f8c00', team.filter(a => a.section === 'been'))
    list(SECTIONS.next + ':', '#ef7d00', team.filter(a => a.section === 'next'))
    list('Also:', '#554596', team.filter(a => a.section !== 'been' && a.section !== 'next'))
  }

  if (signoff) {
    html.push(`<p style="${FONT};margin-top:16px">${htmlText(signoff)}</p>`)
    text.push(signoff)
  }
  html.push('</div>')
  return { html: html.join('\n'), text: text.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' }
}

// ── Pictures ──────────────────────────────────────────────────────────────

export const NEWS_PHOTO_MAX_CHARS = 600000

/** A picked image -> a JPEG data URL at most 1000px wide, small enough for a Firestore document. */
export async function newsPhotoFromFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('That isn’t a picture. Pick a JPEG or PNG.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Couldn’t read that picture. Try a JPEG or PNG.'))
      i.src = url
    })
    for (const [w, q] of [[1000, 0.8], [800, 0.7], [640, 0.6]]) {
      const scale = Math.min(1, w / img.naturalWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL('image/jpeg', q)
      if (data.length < NEWS_PHOTO_MAX_CHARS) return data
    }
    throw new Error('Couldn’t make that picture small enough. Try another.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── Backend ───────────────────────────────────────────────────────────────

const devMode = import.meta.env?.DEV && !import.meta.env?.VITE_FIREBASE_API_KEY
let fsPromise = null
export async function fs() {
  if (!fsPromise) {
    fsPromise = Promise.all([import('firebase/app'), import('firebase/firestore')]).then(([{ getApp }, f]) => ({ f, db: f.getFirestore(getApp()) }))
  }
  return fsPromise
}
const local = { news: new Map(), photos: new Map() }
// `npm run dev` without a .env: one post with reactions and comments, to see them (comments: social.js).
if (devMode) {
  local.news.set('dev-sample', {
    title: 'StepUp4ICU: week two done', category: 'Events', date: isoToday(), author: 'Dev User', authorUid: 'dev', pinned: false,
    body: 'Two weeks down! Theresa is still out in front, with Jack closing in.\nThere’s still time to join: https://example.org/stepup',
    reactions: { a: 'love', b: 'love', c: 'clap', d: 'like', e: 'celebrate' }, commentCount: 2, regions: [], people: [],
  })
}
const photoCache = new Map()

/** Everything, newest first. Falls back to the JSON alone if Firestore can't be read (rules not published, offline). */
export async function loadNews() {
  if (devMode) return mergeNews([...local.news].map(([id, a]) => ({ id, ...a })))
  try {
    const { f, db } = await fs()
    const snap = await f.getDocs(f.collection(db, 'announcements'))
    return mergeNews(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (e) {
    console.warn('Announcements from Firestore unavailable:', e.code || e)
    return mergeNews([])
  }
}

/** How many photos an announcement has (older ones only say hasPhoto). */
export const photoCountOf = a => (Number.isFinite(a.photoCount) ? a.photoCount : a.hasPhoto ? 1 : 0)
// The first photo is announcementPhotos/{id}, the rest {id}-2, {id}-3 …
const photoDoc = (id, i) => (i ? `${id}-${i + 1}` : id)

/** The first (cover) photo, by document id. */
export async function loadPhoto(id) {
  if (photoCache.has(id)) return photoCache.get(id)
  let photo = ''
  if (devMode) photo = local.photos.get(id) || ''
  else {
    try {
      const { f, db } = await fs()
      const s = await f.getDoc(f.doc(db, 'announcementPhotos', id))
      photo = s.exists() ? s.data().photo : ''
    } catch { photo = '' }
  }
  photoCache.set(id, photo)
  return photo
}

/** All of an announcement's photos, in order. */
export async function loadPhotos(a) {
  const all = await Promise.all(Array.from({ length: photoCountOf(a) }, (_, i) => loadPhoto(photoDoc(a.id, i))))
  return all.filter(Boolean)
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max)
function record(a, me) {
  return {
    title: clean(a.title, 200),
    body: clean(a.body, 4000),
    category: CATEGORIES.includes(a.category) ? a.category : 'Announcements',
    section: a.category === 'Team news' && ['been', 'next'].includes(a.section) ? a.section : '',
    regions: (a.regions || []).filter(r => REGIONS.includes(r)),
    people: (a.people || []).slice(0, 30),
    pinned: !!a.pinned,
    date: /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : isoToday(),
    weekOf: /^\d{4}-\d{2}-\d{2}$/.test(a.weekOf || '') ? a.weekOf : mondayOf(a.date || isoToday()),
    order: Number.isFinite(a.order) ? a.order : 0,
    batchId: a.batchId || '',
    author: a.author || me.displayName || me.email || '',
    authorUid: a.authorUid || me.uid,
    hasPhoto: photoCountOf(a) > 0,
    photoCount: photoCountOf(a),
    // A photo by address instead (announcements.json's "news/x.jpg", or a URL)
    image: clean(a.image, 500),
  }
}

export const MAX_NEWS_PHOTOS = 6

/**
 * Saves one announcement (new when it has no id). `photos`: the full list of
 * data URLs, in order ([] for none), or undefined to leave them alone. Only
 * the photos that changed are uploaded. Returns the saved record.
 */
export async function saveAnnouncement(me, a, photos) {
  if (!clean(a.title, 200)) throw new Error('Give it a title.')
  const before = photoCountOf(a)
  const list = photos === undefined ? null : photos.slice(0, MAX_NEWS_PHOTOS)
  const photoCount = list ? list.length : before
  const old = list && a.id ? await loadPhotos(a) : []
  if (devMode) {
    const id = a.id || Math.random().toString(36).slice(2)
    const rec = record({ ...a, photoCount }, me)
    local.news.set(id, rec)
    if (list) {
      for (let i = 0; i < Math.max(before, list.length); i++) {
        const key = photoDoc(id, i)
        i < list.length ? local.photos.set(key, list[i]) : local.photos.delete(key)
        photoCache.delete(key)
      }
    }
    return { id, ...rec }
  }
  const { f, db } = await fs()
  const ref = a.id ? f.doc(db, 'announcements', a.id) : f.doc(f.collection(db, 'announcements'))
  const rec = record({ ...a, photoCount }, me)
  const batch = f.writeBatch(db)
  // notifyTeam: ticked "Notify everyone" when posting; the proxy only sends for a post that says so (social.js).
  batch.set(ref, { ...rec, updatedAt: f.serverTimestamp(), ...(a.id && !a.legacy ? {} : { createdAt: f.serverTimestamp() }), ...(a.id ? {} : { notifyTeam: !!a.notifyTeam }) }, { merge: true })
  const touched = []
  if (list) {
    for (let i = 0; i < Math.max(before, list.length); i++) {
      const key = photoDoc(ref.id, i)
      if (i >= list.length) batch.delete(f.doc(db, 'announcementPhotos', key))
      else if (list[i] !== old[i]) batch.set(f.doc(db, 'announcementPhotos', key), { photo: list[i] })
      else continue
      touched.push(key)
    }
  }
  await batch.commit()
  touched.forEach(k => photoCache.delete(k))
  return { id: ref.id, ...rec }
}

/**
 * Posts the ticked drafts of a pasted email together, keeping their order.
 * Returns { count, firstId }; the first one's id is what the proxy is given
 * to send the one "Team update" push for the lot.
 */
export async function postDrafts(me, drafts, { date, weekOf, notifyTeam = false }) {
  const batchId = `email-${date}-${Math.random().toString(36).slice(2, 7)}`
  const recs = drafts.map((d, i) => record({ ...d, date, weekOf, order: i, batchId, author: undefined, authorUid: undefined }, me))
  if (devMode) { recs.forEach(r => local.news.set(Math.random().toString(36).slice(2), r)); return { count: recs.length, firstId: null } }
  const { f, db } = await fs()
  let firstId = null
  for (let i = 0; i < recs.length; i += 400) {
    const batch = f.writeBatch(db)
    for (const r of recs.slice(i, i + 400)) {
      const ref = f.doc(f.collection(db, 'announcements'))
      firstId = firstId || ref.id
      batch.set(ref, { ...r, notifyTeam, createdAt: f.serverTimestamp() })
    }
    await batch.commit()
  }
  return { count: recs.length, firstId }
}

export async function deleteAnnouncement(a) {
  // One moved from announcements.json is kept as a marker, or the JSON copy would show again.
  const inJson = legacy.some(x => x.id === a.id)
  const photoKeys = Array.from({ length: photoCountOf(a) }, (_, i) => photoDoc(a.id, i))
  if (devMode) { inJson ? local.news.set(a.id, { ...local.news.get(a.id), deleted: true }) : local.news.delete(a.id); photoKeys.forEach(k => local.photos.delete(k)); return }
  const { f, db } = await fs()
  // Comments first: a subcollection outlives its document.
  const comments = await f.getDocs(f.collection(db, 'announcements', a.id, 'comments')).catch(() => ({ docs: [] }))
  for (let i = 0; i < comments.docs.length; i += 400) {
    const b = f.writeBatch(db)
    comments.docs.slice(i, i + 400).forEach(d => b.delete(d.ref))
    await b.commit()
  }
  const batch = f.writeBatch(db)
  const ref = f.doc(db, 'announcements', a.id)
  if (inJson) batch.set(ref, { deleted: true, pinned: false, photoCount: 0, hasPhoto: false, updatedAt: f.serverTimestamp() }, { merge: true })
  else batch.delete(ref)
  for (const k of photoKeys) batch.delete(f.doc(db, 'announcementPhotos', k))
  await batch.commit()
}

/** Admin: copies the old announcements.json entries into Firestore, same ids, so they can be edited here. */
export async function moveLegacy(me, items) {
  for (const a of items) await saveAnnouncement(me, { ...a, authorUid: me.uid })
}

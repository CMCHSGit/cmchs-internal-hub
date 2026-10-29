// The People page's data: the staff directory and each person's HR profile.
//
// Three layers of visibility, and Firestore's rules (chs-equipment's
// cmchs-staff-schedule/firestore.rules) are what enforce them — the page only
// avoids asking for what it can't have:
//
//   users/{uid}              everyone signed in   name, team, work email, work mobile
//   staffPhotos/{email}      everyone signed in   profile picture (a small JPEG data URL)
//   staffPrivate/{email}     the person + HR      birthday, personal contact, address, emergency contacts
//   staffEmployment/{email}  the person + HR      job title, start date, type, manager (HR edits; the person can change their job title)
//
// The private ones are keyed by work email, not uid: someone HR adds before
// their first sign-in only has a placeholder id ("pending-jo-bloggs"), which is
// thrown away when they sign in. Their email is the one thing that stays put.
//
// HR = admins, plus anyone an admin has given `hr: true` on their users record.
import { shortNames } from '../../schedule/src/utils/names.js'
import { TEAMS, teamLabel } from '../../schedule/src/utils/teams.js'

export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Fixed-term', 'Casual', 'Contractor']
export const RELATIONSHIPS = ['Partner', 'Spouse', 'Parent', 'Sibling', 'Child', 'Friend', 'Other']
export const PHOTO_PX = 192
// Firestore's rules refuse anything bigger; a 192px JPEG is ~15 KB.
export const PHOTO_MAX_CHARS = 200000

/** Doc id for a person's private records. Null when they have no work email yet. */
export const profileKey = email => (email || '').trim().toLowerCase() || null

export const isHR = me => !!me && (me.role === 'admin' || me.hr === true)

const clean = (v, max = 200) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v)

/** What the Personal and Emergency tabs save — trimmed, capped, unknown keys dropped. */
export function cleanPrivate(p = {}) {
  const a = p.address || {}
  return {
    dateOfBirth: isDate(p.dateOfBirth) ? p.dateOfBirth : '',
    personalEmail: clean(p.personalEmail, 120),
    personalPhone: clean(p.personalPhone, 40),
    address: { street: clean(a.street), suburb: clean(a.suburb, 80), city: clean(a.city, 80), postcode: clean(a.postcode, 10) },
    emergency: (p.emergency || []).slice(0, 2).map(e => ({
      name: clean(e.name, 120), relationship: clean(e.relationship, 40), phone: clean(e.phone, 40),
    })).filter(e => e.name || e.phone),
  }
}

/** What the Job tab saves. */
export function cleanEmployment(e = {}) {
  return {
    jobTitle: clean(e.jobTitle, 120),
    startDate: isDate(e.startDate) ? e.startDate : '',
    employmentType: EMPLOYMENT_TYPES.includes(e.employmentType) ? e.employmentType : '',
    managerUid: clean(e.managerUid, 128),
  }
}

/** "3 years 2 months" since a start date, or '' when there isn't one (or it's in the future). */
export function tenure(startDate, now = new Date()) {
  if (!isDate(startDate)) return ''
  const [y, m, d] = startDate.split('-').map(Number)
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m) - (now.getDate() < d ? 1 : 0)
  if (months < 0) return ''
  if (months === 0) return 'Started this month'
  const yrs = Math.floor(months / 12)
  months %= 12
  const part = (n, w) => n ? `${n} ${w}${n === 1 ? '' : 's'}` : ''
  return [part(yrs, 'year'), part(months, 'month')].filter(Boolean).join(' ')
}

/**
 * How much of your own profile is filled in, for the nudge on "My profile".
 * Only the things a person can fill in themselves count.
 */
export function completeness({ user = {}, photo, priv = {} }) {
  const a = priv.address || {}
  const checks = [
    ['a profile picture', !!photo],
    ['your work mobile', !!user.workMobile],
    ['a personal phone', !!priv.personalPhone],
    ['your home address', !!(a.street && a.city)],
    ['an emergency contact', !!(priv.emergency || []).some(e => e.name && e.phone)],
  ]
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label)
  return { percent: Math.round(100 * (checks.length - missing.length) / checks.length), missing }
}

function initials(name) {
  return (name || '?').split(/[\s-]+/).filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase()
}

/**
 * The directory: everyone on the roster, with what anyone may see. `today` is
 * loadToday()'s result (for where each person is), or null if the schedule
 * couldn't be read. Pure, so it's tested without Firestore.
 */
export function buildDirectory({ users, photos = {}, today = null }) {
  const names = shortNames(users)
  const where = new Map((today?.people || []).map(p => [p.uid, p]))
  return users.map(u => {
    const t = where.get(u.uid)
    const key = profileKey(u.email)
    return {
      uid: u.uid,
      key,
      name: u.displayName || names.get(u.uid) || u.email || 'Unnamed',
      shortName: names.get(u.uid) || u.displayName || '',
      initials: initials(u.displayName || u.email),
      email: u.email || '',
      workMobile: u.workMobile || '',
      team: u.team || '',
      teamName: u.team ? teamLabel(u.team) : 'No team',
      pending: !!u.pending,
      role: u.role || 'user',
      hr: u.hr === true,
      photo: (key && photos[key]) || '',
      where: t?.where || '',
      swatch: t?.swatch || '',
      onCall: !!t?.onCall,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** Directory search: name, team, email or mobile digits. */
export function searchPeople(people, q, teams = []) {
  const s = q.trim().toLowerCase()
  const digits = s.replace(/\D/g, '')
  return people.filter(p =>
    (!teams.length || teams.includes(p.team)) &&
    (!s || `${p.name} ${p.teamName} ${p.email}`.toLowerCase().includes(s) ||
      (digits.length >= 3 && p.workMobile.replace(/\D/g, '').includes(digits))))
}

/** A tel: link for a phone number typed any way ("021 123 4567", "+64 21 123 4567"); '' when there are no digits. */
export const telHref = n => { const d = String(n || '').replace(/[^\d+]/g, ''); return /\d/.test(d) ? 'tel:' + d : '' }

/** The placeholder id the schedule's Admin uses too, so the two never create duplicates. */
export const placeholderId = name => 'pending-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')

export const TEAM_OPTIONS = TEAMS.map(t => ({ id: t, name: teamLabel(t) }))

// ── Pictures ──────────────────────────────────────────────────────────────

/** A picked image file -> a square, centre-cropped JPEG data URL, small enough for Firestore. */
export async function photoFromFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('That isn’t a picture. Pick a JPEG or PNG.')
  if (file.size > 15 * 1024 * 1024) throw new Error('That picture is too big (over 15 MB).')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Couldn’t read that picture. Try a JPEG or PNG.'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = PHOTO_PX
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, PHOTO_PX, PHOTO_PX)
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, PHOTO_PX, PHOTO_PX)
    for (const q of [0.85, 0.7, 0.55]) {
      const data = canvas.toDataURL('image/jpeg', q)
      if (data.length < PHOTO_MAX_CHARS) return data
    }
    throw new Error('Couldn’t make that picture small enough. Try another.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── Backend ───────────────────────────────────────────────────────────────
// Firestore in real builds. `npm run dev` without a .env gets an in-memory
// stand-in seeded from dev-fixture.js, where the pretend Dev User is an admin.

const devMode = import.meta.env?.DEV && !import.meta.env?.VITE_FIREBASE_API_KEY

let fsPromise = null
async function fs() {
  if (!fsPromise) {
    fsPromise = Promise.all([import('firebase/app'), import('firebase/firestore'), import('../../../shared/firestore.js')]).then(([{ getApp }, f, s]) => ({ f, db: s.firestore(getApp()) }))
  }
  return fsPromise
}

let local = null
async function localStore() {
  if (!local) {
    const { default: fixture } = await import('./dev-fixture.js')
    const { users } = fixture()
    local = {
      users: new Map([['dev', { displayName: 'Dev User', email: 'dev.user@cass.co.nz', team: 'Engineers', role: 'admin', workMobile: '021 555 0100' }],
        ...users.map(u => [u.uid, { ...u, email: `${u.displayName.toLowerCase()}@cass.co.nz` }])]),
      photos: new Map(), private: new Map(), employment: new Map(),
    }
  }
  return local
}

/** Everyone, with their public fields and pictures, plus today's whereabouts. */
export async function loadDirectory(me, loadToday) {
  const todayP = loadToday().catch(() => null)
  if (devMode) {
    const s = await localStore()
    const users = [...s.users].map(([uid, u]) => ({ ...u, uid }))
    return { users, directory: buildDirectory({ users, photos: Object.fromEntries(s.photos), today: await todayP }) }
  }
  const { f, db } = await fs()
  const [usersSnap, photoSnap, today] = await Promise.all([
    f.getDocs(f.collection(db, 'users')),
    // Pictures are a nicety: if the rules for them aren't published yet, carry on without.
    f.getDocs(f.collection(db, 'staffPhotos')).catch(e => { console.warn('Profile pictures unavailable:', e.code || e); return null }),
    todayP,
  ])
  const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }))
  const photos = {}
  for (const d of photoSnap?.docs || []) photos[d.id] = d.data().photo
  return { users, directory: buildDirectory({ users, photos, today }) }
}

/** A person's private and job details. Throws (permission-denied) for anyone else's unless you're HR. */
export async function loadProfile(key) {
  if (!key) return { priv: cleanPrivate(), employment: cleanEmployment() }
  if (devMode) {
    const s = await localStore()
    return { priv: cleanPrivate(s.private.get(key)), employment: cleanEmployment(s.employment.get(key)) }
  }
  const { f, db } = await fs()
  const [p, e] = await Promise.all([f.getDoc(f.doc(db, 'staffPrivate', key)), f.getDoc(f.doc(db, 'staffEmployment', key))])
  return { priv: cleanPrivate(p.exists() ? p.data() : {}), employment: cleanEmployment(e.exists() ? e.data() : {}) }
}

async function activity(me, summary) {
  if (devMode) return
  try {
    const { logActivity } = await import('../../../shared/activity.js')
    await logActivity(me, summary, { app: 'hub' })
  } catch (e) {
    console.error('Activity log failed:', e)
  }
}

/** Public fields on the users record: name and work mobile (yours), plus team and email (HR). */
export async function saveUser(me, person, changes) {
  const data = {}
  if ('displayName' in changes) data.displayName = clean(changes.displayName, 80)
  if ('workMobile' in changes) data.workMobile = clean(changes.workMobile, 40)
  if ('team' in changes) data.team = TEAMS.includes(changes.team) ? changes.team : null
  if ('email' in changes) data.email = profileKey(changes.email) || ''
  if ('hr' in changes) data.hr = !!changes.hr
  if ('displayName' in data && !data.displayName) throw new Error('A name is needed.')
  if (devMode) { Object.assign((await localStore()).users.get(person.uid), data); return data }
  const { f, db } = await fs()
  await f.updateDoc(f.doc(db, 'users', person.uid), data)
  if (me.uid !== person.uid) {
    const what = Object.keys(data).map(k => ({ displayName: 'name', workMobile: 'work mobile', team: 'team', email: 'work email', hr: 'HR access' })[k]).join(', ')
    activity(me, `Updated ${person.name}'s ${what} on People.`)
  }
  return data
}

export async function savePrivate(me, person, priv) {
  if (!person.key) throw new Error('Add their work email first: private details are kept against it.')
  const data = cleanPrivate(priv)
  if (devMode) { (await localStore()).private.set(person.key, data); return data }
  const { f, db } = await fs()
  await f.setDoc(f.doc(db, 'staffPrivate', person.key), { ...data, updatedAt: f.serverTimestamp(), updatedBy: me.uid })
  if (me.uid !== person.uid) activity(me, `Updated ${person.name}'s personal details on People.`)
  return data
}

/** HR saves the whole Job tab; a person changing their own job title saves just that. */
export async function saveEmployment(me, person, employment, { titleOnly = false } = {}) {
  if (!person.key) throw new Error('Add their work email first: job details are kept against it.')
  const all = cleanEmployment(employment)
  const data = titleOnly ? { jobTitle: all.jobTitle } : all
  if (devMode) { const s = await localStore(); s.employment.set(person.key, { ...s.employment.get(person.key), ...data }); return data }
  const { f, db } = await fs()
  await f.setDoc(f.doc(db, 'staffEmployment', person.key), { ...data, updatedAt: f.serverTimestamp() }, { merge: true })
  if (me.uid !== person.uid) activity(me, `Updated ${person.name}'s job details on People.`)
  return data
}

export async function savePhoto(me, person, photo) {
  if (!person.key) throw new Error('Add their work email first: the picture is kept against it.')
  if (devMode) { const s = await localStore(); photo ? s.photos.set(person.key, photo) : s.photos.delete(person.key); return }
  const { f, db } = await fs()
  const ref = f.doc(db, 'staffPhotos', person.key)
  if (photo) await f.setDoc(ref, { photo, updatedAt: f.serverTimestamp() })
  else await f.deleteDoc(ref)
}

/**
 * HR adds someone who hasn't signed in yet. Same placeholder the schedule's
 * Admin makes, plus their work email, so their first sign-in claims it (and
 * the private details saved against that email are already theirs).
 */
export async function addEmployee(me, people, { name, email, team, workMobile }) {
  const displayName = clean(name, 80)
  const key = profileKey(email)
  if (!displayName) throw new Error('Add their full name.')
  if (!key || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) throw new Error('Add their work email (the one they sign in with).')
  if (!TEAMS.includes(team)) throw new Error('Pick a team.')
  if (people.some(p => p.key === key)) throw new Error('Someone already has that work email.')
  if (people.some(p => p.name.toLowerCase() === displayName.toLowerCase())) throw new Error(`${displayName} is already on the list.`)
  const uid = placeholderId(displayName)
  const data = { displayName, email: key, team, role: 'user', pending: true, workMobile: clean(workMobile, 40) }
  if (devMode) { (await localStore()).users.set(uid, data); return { uid, ...data } }
  const { f, db } = await fs()
  await f.setDoc(f.doc(db, 'users', uid), { ...data, createdAt: f.serverTimestamp() })
  activity(me, `Added ${displayName} (${teamLabel(team)}) on People.`)
  return { uid, ...data }
}

/**
 * Takes someone off the roster: their users record and everything kept against
 * their email. Their past schedule weeks stay (nothing shows them once the
 * person is gone). If they can still sign in, a new, empty profile is made for
 * them, so this is for people who have left and lost their Microsoft account.
 */
export async function removeEmployee(me, person) {
  if (devMode) {
    const s = await localStore()
    s.users.delete(person.uid)
    for (const m of [s.photos, s.private, s.employment]) m.delete(person.key)
    return
  }
  const { f, db } = await fs()
  const batch = f.writeBatch(db)
  batch.delete(f.doc(db, 'users', person.uid))
  if (person.key) for (const c of ['staffPhotos', 'staffPrivate', 'staffEmployment']) batch.delete(f.doc(db, c, person.key))
  await batch.commit()
  activity(me, `Removed ${person.name} from the staff list on People.`)
}

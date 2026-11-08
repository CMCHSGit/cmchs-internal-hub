/* Asks' live data and every change to it, shared with the screens through
   React context. Everything is a live listener: when someone picks an ask
   up, everyone else involved sees it within a second, without refreshing. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getBackend } from './backend.js'
import { logActivity } from '../../../shared/activity.js'
import { cleanAsk, cleanComment, eventOf, findMentions, myCount, peopleOf, todayISO, LIMITS } from './model.js'
import { toBlob } from './files.js'

const Ctx = createContext(null)
export const useStore = () => useContext(Ctx)

// When this browser last looked at each ask, so newer activity shows a dot.
// Prefixed: every tool on internal.chsnz.co.nz shares one localStorage.
const SEEN_KEY = 'asks:seen'
function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') } catch { return {} }
}

const union = (...lists) => [...new Set(lists.flat().filter(Boolean))]

export function StoreProvider({ children }) {
  const [be, setBe] = useState(null)
  const [user, setUser] = useState(undefined) // undefined = not known yet
  const [profile, setProfile] = useState(null)
  const [users, setUsers] = useState(null)
  const [asks, setAsks] = useState(null)
  const [stats, setStats] = useState([])
  const [error, setError] = useState(null)
  const [seen, setSeen] = useState(readSeen)
  const [pushOn, setPushOn] = useState(false)
  const [notice, setNotice] = useState(null) // how the last notification went, for the toast

  // ── sign-in ──
  useEffect(() => {
    let unsub = () => {}
    getBackend().then((b) => {
      setBe(b)
      setPushOn(b.push.enabledHere())
      unsub = b.watchAuth(async (u) => {
        setUser(u)
        if (!u) return setProfile(null)
        try { setProfile(await b.profile(u.uid)) } catch { setProfile({}) }
      })
    }).catch((e) => setError('Asks could not start: ' + (e.message || e)))
    return () => unsub()
  }, [])

  const me = useMemo(() => (user && profile ? {
    uid: user.uid, name: profile.displayName || user.name, team: profile.team || '', role: profile.role || 'user',
  } : null), [user, profile])

  // ── live data ──
  useEffect(() => {
    if (!be || !me) return
    const fail = (what) => (e) => setError(e?.code === 'permission-denied'
      ? `Firestore refused to read the ${what}. The security rules for Asks may not be published yet.`
      : `Could not load the ${what}: ${e?.message || e}`)
    const subs = [
      be.watchUsers(setUsers, fail('people')),
      be.watchAsks(me, setAsks, fail('asks')),
      be.watchStats(setStats, fail('company counts')),
    ]
    return () => subs.forEach((u) => u())
  }, [be, me])

  const today = todayISO()
  const userById = useMemo(() => new Map((users || []).map((u) => [u.uid, u])), [users])
  const askById = useMemo(() => new Map((asks || []).map((a) => [a.id, a])), [asks])
  const counts = useMemo(() => (me && asks ? myCount(asks, me, today) : { total: 0, overdue: 0, urgent: 0 }), [asks, me, today])

  const markSeen = useCallback((id) => {
    setSeen((s) => {
      const next = { ...s, [id]: Date.now() }
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)) } catch { /* private mode: this visit only */ }
      // The header's Asks count (apps/hub/src/useAsksBadge.js) drops now; later, so nothing re-renders while this renders.
      setTimeout(() => window.dispatchEvent(new CustomEvent('asks:seen')), 0)
      return next
    })
  }, [])
  /** Something happened on it, by someone else, since this browser last opened it. */
  const isNew = useCallback((a) => {
    if (!me || !a.event || a.event.by === me.uid) return false
    return (a.event.atMs || 0) > (seen[a.id] || 0)
  }, [me, seen])

  // ── changes ──
  const actions = useMemo(() => {
    if (!be || !me) return {}

    // The hub's activity log (shared/activity.js). Says what was done, never which ask or what it said:
    // asks are private to the people on them, and the log is read by every admin.
    const ASK_DOES = {
      created: 'Sent an ask', claimed: 'Took an ask', handed: 'Handed an ask back', given: 'Gave an ask to someone', waiting: 'Marked an ask as waiting',
      done: 'Marked an ask done', reopened: 'Reopened an ask', added: 'Added people to an ask', comment: 'Commented on an ask',
    }
    const note = (type) => logActivity(me, ASK_DOES[type] || 'Changed an ask', { app: 'asks' })

    /** Tell the people concerned, then say how it went (Shell shows it). */
    const tell = (id) => be.notify(id).then((r) => { if (r && !r.already) setNotice({ ...r, at: Date.now() }) })

    /** Change an ask in a transaction; tell people if the change carries an event. */
    async function change(a, fn) {
      // A change reads the ask first (a transaction), which can't be done with no connection: say so at once.
      if (navigator.onLine === false) throw new Error('You’re offline. Try again when you’re back online.')
      let notify = false, kind = ''
      const next = await be.mutate(a.id, (cur) => {
        const r = fn(cur)
        if (!r) return null
        notify = !!r.patch.event
        kind = r.patch.event?.type || ''
        return { ...r, patch: { ...r.patch, updatedAtMs: Date.now() } }
      })
      if (next && notify) { tell(a.id); note(kind) }
      return next
    }
    const photoDocs = (askId, photos, commentId = '') => photos.map((p) => ({
      id: be.newId(`asks/${askId}/photos`),
      data: { uid: me.uid, data: p.data, w: p.w, h: p.h, atMs: Date.now(), commentId },
    }))
    // Files from files.js readFile: { name, type, bytes, parts }.
    const fileDocs = (askId, files, commentId = '') => files.slice(0, LIMITS.files).map((f) => ({
      id: be.newId(`asks/${askId}/files`),
      meta: { uid: me.uid, name: f.name, type: f.type, bytes: f.bytes, parts: f.parts.length, atMs: Date.now(), commentId },
      parts: f.parts,
    }))

    return {
      async create(input, photos = [], files = []) {
        const { cc, ...f } = cleanAsk(input)
        const copied = cc.filter((u) => u !== me.uid)
        const id = be.newId()
        const now = Date.now()
        const pics = photoDocs(id, photos.slice(0, LIMITS.photos))
        const docs = fileDocs(id, files)
        const asking = be.create(id, {
          ...f,
          // Only written when someone's copied in, so an ask without needs nothing new of the rules.
          ...(copied.length ? { cc: copied } : {}),
          createdBy: me.uid, createdByName: me.name, createdAtMs: now, updatedAtMs: now,
          people: peopleOf({ createdBy: me.uid, assignees: f.assignees, cc: copied }),
          owner: '', ownerName: '', status: 'open', waitingOn: '', doneAtMs: 0, doneBy: '',
          photoCount: pics.length, commentCount: 0, lastCommentAtMs: 0, lastCommentBy: '',
          // Only written when there are some, like cc.
          ...(docs.length ? { fileCount: docs.length } : {}),
          event: eventOf('created', me),
        }, pics)
        // Each file is its own write, queued straight after the ask's (so it also waits on this device when offline),
        // and the people are told once they're all there.
        const attaching = docs.map((f) => be.addFile(id, f))
        attaching.forEach((p) => p.catch(() => {})) // reported below, once
        const saving = asking.then(() => Promise.all(attaching)).catch(async (e) => {
          await asking // the ask itself failed: that error, nothing was sent
          throw Object.assign(new Error(`The ask was sent, but a file didn’t upload (${e?.message || e}). Open the ask and add it in a comment.`), { sentId: id })
        })
        if (navigator.onLine === false) {
          // No connection: the ask is kept on this device and goes when it's back, which can be long after this form
          // closes, so don't wait for it. The people are told when it arrives: from here if it's quick (the server
          // only takes a tell within ten minutes), otherwise by the server's own sweep (sweepAsks in the proxy).
          saving.then(() => { note('created'); if (Date.now() - now < 9 * 60 * 1000) tell(id) }).catch((e) => console.warn('[asks] queued ask not sent', e))
          markSeen(id)
          return id
        }
        try {
          await saving
        } finally {
          // Sent, even if a file didn't make it (sentId): tell people about it either way.
          const sent = await asking.then(() => true, () => false)
          if (sent) { markSeen(id); tell(id); note('created') }
        }
        return id
      },

      claim: (a) => change(a, (cur) => {
        if (cur.status === 'done') throw new Error('This ask is already done.')
        if (cur.owner === me.uid) return null
        if (cur.owner) throw new Error(`${cur.ownerName || 'Someone'} has already picked this up.`)
        return { patch: { owner: me.uid, ownerName: me.name, status: 'picked', people: union(cur.people, [me.uid]), event: eventOf('claimed', me) } }
      }),

      handBack: (a) => change(a, () => ({
        patch: { owner: '', ownerName: '', status: 'open', waitingOn: '', event: eventOf('handed', me) },
      })),

      giveTo: (a, person) => change(a, (cur) => (cur.owner === person.uid ? null : {
        patch: { owner: person.uid, ownerName: person.name, status: 'picked', waitingOn: '', people: union(cur.people, [person.uid]), event: eventOf('given', me, { to: [person.uid] }) },
      })),

      /** Waiting on a supplier or customer. Picks it up first if nobody has. */
      setWaiting: (a, on) => change(a, (cur) => ({
        patch: {
          status: 'waiting', waitingOn: String(on || '').trim().slice(0, LIMITS.waitingOn),
          ...(cur.owner ? {} : { owner: me.uid, ownerName: me.name, people: union(cur.people, [me.uid]) }),
          event: eventOf('waiting', me),
        },
      })),

      resume: (a) => change(a, () => ({ patch: { status: 'picked', waitingOn: '' } })),

      /** Done. Whoever finishes one nobody had picked up becomes its owner, so it says who did it. */
      markDone: (a) => change(a, (cur) => (cur.status === 'done' ? null : {
        patch: {
          status: 'done', doneAtMs: Date.now(), doneBy: me.name, waitingOn: '',
          ...(cur.owner ? {} : { owner: me.uid, ownerName: me.name, people: union(cur.people, [me.uid]) }),
          event: eventOf('done', me),
        },
      })),

      reopen: (a) => change(a, (cur) => ({
        patch: { status: cur.owner ? 'picked' : 'open', doneAtMs: 0, doneBy: '', event: eventOf('reopened', me) },
      })),

      /** The asker (or an admin) edits it. Only people, teams and copied-in people newly added are told. */
      edit: (a, input) => change(a, (cur) => {
        const { cc: ccIn, ...f } = cleanAsk(input)
        const cc = ccIn.filter((u) => u !== me.uid)
        const curCc = cur.cc || []
        const added = f.assignees.filter((u) => !cur.assignees.includes(u) && u !== me.uid)
        const newCc = cc.filter((u) => !curCc.includes(u))
        const newTeams = f.teams.filter((t) => !cur.teams.includes(t))
        // Taken off: no longer sees it, unless they asked, have it, or are still on it another way.
        const staying = new Set([cur.owner, cur.createdBy, ...f.assignees, ...cc])
        const removed = [...cur.assignees, ...curCc].filter((u) => !staying.has(u))
        const people = union(cur.people.filter((u) => !removed.includes(u)), f.assignees, cc)
        return {
          patch: {
            ...f, people, ...(cc.length || cur.cc ? { cc } : {}),
            ...(cur.checklist && !f.checklist ? { checklist: null } : {}),
            ...(added.length || newTeams.length || newCc.length ? { event: eventOf('added', me, { to: added, teams: newTeams, cc: newCc }) } : {}),
          },
        }
      }),

      /**
       * A comment, with any photos taken and files added for it. @mentioned people are told and can then see the ask.
       * The files go first (too big for the comment's transaction), so they're there when people are told; if the
       * comment then doesn't save, they're taken away again.
       */
      comment: async (a, text, photos = [], files = []) => {
        const body = cleanComment(text)
        if (!body && !photos.length && !files.length) return null
        const mentions = findMentions(body, users || []).filter((u) => u !== me.uid)
        const cid = be.newId(`asks/${a.id}/comments`)
        const pics = photoDocs(a.id, photos, cid)
        const docs = fileDocs(a.id, files, cid)
        await Promise.all(docs.map((f) => be.addFile(a.id, f)))
        try {
          return await change(a, (cur) => {
            if ((cur.photoCount || 0) + pics.length > LIMITS.photos * 3) throw new Error('This ask has as many photos as it can hold.')
            return {
              patch: {
                commentCount: (cur.commentCount || 0) + 1, lastCommentAtMs: Date.now(), lastCommentBy: me.name,
                photoCount: (cur.photoCount || 0) + pics.length,
                ...(docs.length ? { fileCount: (cur.fileCount || 0) + docs.length } : {}),
                people: union(cur.people, [me.uid], mentions),
                event: eventOf('comment', me, { to: mentions, ref: cid }),
              },
              writes: [
                { path: ['asks', a.id, 'comments', cid], data: { uid: me.uid, name: me.name, text: body, atMs: Date.now(), mentions, photoIds: pics.map((p) => p.id), ...(docs.length ? { fileIds: docs.map((f) => f.id) } : {}) } },
                ...pics.map((p) => ({ path: ['asks', a.id, 'photos', p.id], data: p.data })),
              ],
            }
          })
        } catch (e) {
          if (docs.length) await be.removeFiles(a.id, docs.map((f) => ({ id: f.id, parts: f.parts.length }))).catch(() => {})
          throw e
        }
      },

      /** files: the thread's files that belong to this comment. */
      async removeComment(a, c, files = []) {
        await be.removeComment(a.id, c, files)
        await change(a, (cur) => ({
          patch: {
            commentCount: Math.max(0, (cur.commentCount || 0) - 1), photoCount: Math.max(0, (cur.photoCount || 0) - (c.photoIds || []).length),
            ...(files.length ? { fileCount: Math.max(0, (cur.fileCount || 0) - files.length) } : {}),
          },
        }))
      },

      /** A file's contents as a Blob (files.js decides what it may be opened as). */
      openFile: async (a, file) => toBlob(await be.fileParts(a.id, file), file.type),

      remove: async (a) => { await be.remove(a.id); logActivity(me, 'Deleted an ask', { app: 'asks' }) },

      async enablePush() {
        await be.push.enable(me.uid)
        setPushOn(true)
      },
    }
  }, [be, me, users, markSeen])

  const push = be ? { supported: be.push.supported(), needsInstall: be.push.needsInstall(), on: pushOn } : { supported: false }

  const value = {
    be, user, me, users: users || [], userById, asks: asks || [], askById, stats, counts, today, error,
    ready: !!(me && users && asks), isNew, markSeen, push, notice,
    onForegroundPush: (cb) => be.push.onForeground(cb),
    signIn: () => be?.signIn(),
    watchThread: (id, cb, onError) => be.watchThread(id, cb, onError),
    ...actions,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

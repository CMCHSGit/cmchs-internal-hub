/* Asks' live data and every change to it, shared with the screens through
   React context. Everything is a live listener: when someone picks an ask
   up, everyone else involved sees it within a second, without refreshing. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getBackend } from './backend.js'
import { cleanAsk, cleanComment, eventOf, findMentions, myCount, peopleOf, todayISO, LIMITS } from './model.js'

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

    /** Tell the people concerned, then say how it went (Shell shows it). */
    const tell = (id) => be.notify(id).then((r) => { if (r && !r.already) setNotice({ ...r, at: Date.now() }) })

    /** Change an ask in a transaction; tell people if the change carries an event. */
    async function change(a, fn) {
      let notify = false
      const next = await be.mutate(a.id, (cur) => {
        const r = fn(cur)
        if (!r) return null
        notify = !!r.patch.event
        return { ...r, patch: { ...r.patch, updatedAtMs: Date.now() } }
      })
      if (next && notify) tell(a.id)
      return next
    }
    const photoDocs = (askId, photos, commentId = '') => photos.map((p) => ({
      id: be.newId(`asks/${askId}/photos`),
      data: { uid: me.uid, data: p.data, w: p.w, h: p.h, atMs: Date.now(), commentId },
    }))

    return {
      async create(input, photos = []) {
        const { cc, ...f } = cleanAsk(input)
        const copied = cc.filter((u) => u !== me.uid)
        const id = be.newId()
        const now = Date.now()
        const pics = photoDocs(id, photos.slice(0, LIMITS.photos))
        await be.create(id, {
          ...f,
          // Only written when someone's copied in, so an ask without needs nothing new of the rules.
          ...(copied.length ? { cc: copied } : {}),
          createdBy: me.uid, createdByName: me.name, createdAtMs: now, updatedAtMs: now,
          people: peopleOf({ createdBy: me.uid, assignees: f.assignees, cc: copied }),
          owner: '', ownerName: '', status: 'open', waitingOn: '', doneAtMs: 0, doneBy: '',
          photoCount: pics.length, commentCount: 0, lastCommentAtMs: 0, lastCommentBy: '',
          event: eventOf('created', me),
        }, pics)
        markSeen(id)
        tell(id)
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
            ...(added.length || newTeams.length || newCc.length ? { event: eventOf('added', me, { to: added, teams: newTeams, cc: newCc }) } : {}),
          },
        }
      }),

      /** A comment, with any photos taken for it. @mentioned people are told and can then see the ask. */
      comment: (a, text, photos = []) => {
        const body = cleanComment(text)
        if (!body && !photos.length) return Promise.resolve(null)
        const mentions = findMentions(body, users || []).filter((u) => u !== me.uid)
        const cid = be.newId(`asks/${a.id}/comments`)
        const pics = photoDocs(a.id, photos, cid)
        return change(a, (cur) => {
          if ((cur.photoCount || 0) + pics.length > LIMITS.photos * 3) throw new Error('This ask has as many photos as it can hold.')
          return {
            patch: {
              commentCount: (cur.commentCount || 0) + 1, lastCommentAtMs: Date.now(), lastCommentBy: me.name,
              photoCount: (cur.photoCount || 0) + pics.length,
              people: union(cur.people, [me.uid], mentions),
              event: eventOf('comment', me, { to: mentions, ref: cid }),
            },
            writes: [
              { path: ['asks', a.id, 'comments', cid], data: { uid: me.uid, name: me.name, text: body, atMs: Date.now(), mentions, photoIds: pics.map((p) => p.id) } },
              ...pics.map((p) => ({ path: ['asks', a.id, 'photos', p.id], data: p.data })),
            ],
          }
        })
      },

      async removeComment(a, c) {
        await be.removeComment(a.id, c)
        await change(a, (cur) => ({ patch: { commentCount: Math.max(0, (cur.commentCount || 0) - 1), photoCount: Math.max(0, (cur.photoCount || 0) - (c.photoIds || []).length) } }))
      },

      remove: (a) => be.remove(a.id),

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

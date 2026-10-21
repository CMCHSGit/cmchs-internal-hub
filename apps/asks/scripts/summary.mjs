/**
 * apps/asks/scripts/summary.mjs — run by .github/workflows/asks-summary.yml at
 * 8:30am NZ time, Monday to Friday. Everyone with asks to do (sent to them or
 * their team and not picked up yet, or picked up by them) gets one push:
 * "You have 3 open asks". People with no phone set up get an email instead,
 * once RESEND_API_KEY and RESEND_FROM are set. Nobody with nothing to do
 * hears anything. An admin can switch someone off on the hub's Admin
 * settings → Notifications (users/{uid}.notifications.asksSummary).
 *
 * GitHub's timers are in UTC and New Zealand has daylight saving, so the
 * workflow fires at both 19:30 and 20:30 UTC and this only carries on for the
 * one that is 8:30 in Auckland that day (SCHEDULE is the cron that fired).
 *
 * Env (GitHub Actions secrets): FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
 * FIREBASE_PRIVATE_KEY, and optionally RESEND_API_KEY + RESEND_FROM.
 * DRY_RUN=true reads everything and prints the counts it would send.
 * The repo is public and so are its Action logs — only ever log counts.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { isMineToDo, isOverdue } from '../src/model.js'

const APP_URL = 'https://internal.chsnz.co.nz/asks/#/mine'
// The Firebase SDK shows it itself (apps/hub/src/sw.js), so the icon comes with it.
const ICON = 'https://internal.chsnz.co.nz/icons/icon-192.png'
const DEAD_TOKEN_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'])

/** Hours ahead of UTC in Auckland right now: 13 in daylight saving, 12 otherwise. */
export function aucklandOffset(d = new Date()) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Auckland', timeZoneName: 'shortOffset' }).formatToParts(d)
    .find((p) => p.type === 'timeZoneName')?.value || 'GMT+12'
  return Number(s.replace('GMT', '')) || 12
}
/** Today in Auckland, YYYY-MM-DD. */
export function aucklandToday(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(d)
}

/** One person's summary, or null when they have nothing to do. */
export function summaryFor(user, asks, today) {
  const me = { uid: user.uid, team: user.team || '' }
  const mine = asks.filter((a) => isMineToDo(a, me))
  if (!mine.length) return null
  const toPick = mine.filter((a) => !a.owner).length
  const overdue = mine.filter((a) => isOverdue(a, today)).length
  const urgent = mine.filter((a) => a.urgent).length
  const parts = []
  if (toPick) parts.push(`${toPick} waiting for someone to pick up`)
  if (mine.length - toPick) parts.push(`${mine.length - toPick} you’re on`)
  if (overdue) parts.push(`${overdue} overdue`)
  if (urgent) parts.push(`${urgent} urgent`)
  return {
    title: `You have ${mine.length} open ask${mine.length === 1 ? '' : 's'}`,
    body: parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.',
    count: mine.length,
  }
}

function db() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    })
  }
  return getFirestore()
}

async function sendEmail(to, msg) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [to],
      subject: msg.title,
      html: `
        <div style="font-family: 'Source Sans 3', 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #575756;">
          <div style="height: 4px; background: linear-gradient(90deg, #554596 33.3%, #80bd01 33.3% 66.6%, #ef7d00 66.6%); margin-bottom: 24px;"></div>
          <h2 style="font-size: 20px; margin: 0 0 8px; color: #1d1d1d;">${esc(msg.title)}</h2>
          <p style="line-height: 1.6; margin-bottom: 24px;">${esc(msg.body)}</p>
          <a href="${APP_URL}" style="display: inline-block; background: #554596; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 16px; font-weight: 600;">Open my asks</a>
          <p style="color: #747577; font-size: 13px; margin-top: 32px;">You got this by email because notifications aren't turned on for Asks on your phone.</p>
        </div>`,
    }),
  })
  if (!res.ok) throw new Error('Resend error ' + res.status)
}

async function main() {
  const schedule = process.env.SCHEDULE || ''
  if (schedule) {
    const want = schedule.startsWith('30 19') ? 13 : 12
    if (aucklandOffset() !== want) { console.log('This timer is not 8:30 in Auckland today; the other one is. Nothing to do.'); return }
  }
  const store = db()
  const today = aucklandToday()
  const [usersSnap, asksSnap] = await Promise.all([
    store.collection('users').get(),
    store.collection('asks').where('status', 'in', ['open', 'picked', 'waiting']).get(),
  ])
  const asks = asksSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const users = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => !u.pending)
  const off = users.filter((u) => u.notifications?.asksSummary === false).length
  const due = users.filter((u) => u.notifications?.asksSummary !== false)
    .map((u) => ({ u, msg: summaryFor(u, asks, today) })).filter((x) => x.msg)

  if (process.env.DRY_RUN === 'true') {
    const withPhone = due.filter((x) => (x.u.fcmTokens || []).length).length
    console.log(`Dry run: ${asks.length} open asks, ${due.length} people would get a summary (${withPhone} with a phone set up), ${off} switched off in Admin. Nothing sent.`)
    return
  }

  const emailOn = !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM)
  let pushSent = 0, pushFailed = 0, emailSent = 0, emailFailed = 0, unreached = 0
  for (const { u, msg } of due) {
    const tokens = u.fcmTokens || []
    if (tokens.length) {
      const r = await getMessaging().sendEachForMulticast({ tokens, notification: { title: msg.title, body: msg.body }, data: { url: APP_URL }, webpush: { notification: { icon: ICON, badge: ICON } } })
      pushSent += r.successCount
      pushFailed += r.failureCount
      const dead = r.responses.map((x, i) => (!x.success && DEAD_TOKEN_CODES.has(x.error?.code) ? tokens[i] : null)).filter(Boolean)
      if (dead.length) await store.collection('users').doc(u.uid).update({ fcmTokens: FieldValue.arrayRemove(...dead) })
    } else if (emailOn && u.email) {
      try { await sendEmail(u.email, msg); emailSent++ } catch { emailFailed++ }
    } else {
      unreached++
    }
  }
  console.log(`Asks summary: ${asks.length} open asks, ${due.length} people with some; push ${pushSent} sent/${pushFailed} failed; email ${emailOn ? `${emailSent} sent/${emailFailed} failed` : 'off (Resend not set up)'}; ${unreached} not reached; ${off} switched off in Admin`)
  if (emailFailed) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('summary.mjs')) {
  main().catch((err) => { console.error('Asks summary failed:', err.message); process.exit(1) })
}

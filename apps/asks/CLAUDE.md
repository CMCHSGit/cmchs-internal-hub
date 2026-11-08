# Asks — read this before changing anything here

Claude loads this file when working under `apps/asks/`. It is the short map; the detail lives in:

- `README.md` (repo root), section **Asks** — what people see and how it behaves today.
- `src/model.js` — the header comment lists **every field on an ask**; the functions are who-sees/who-owns, buckets and counts.
- `rules/firestore.rules` — `canSeeAsk`, `isAsk`, `askStatsOf`, and the `asks/{id}` / `askStats/{id}` matches.
- `backend/apps-script/proxy/Code.js` — `notifyAsk_`, `askRecipients_`, `askMessage_`, `sweepAsks` (the pushes and emails).

## What it is

Quick requests between staff, instead of a text or an email: "test the new mode on the A7", "raise this with Mindray". Sent to
people and/or whole teams; whoever can do it taps **I'll take it** and everyone involved sees who has it. Statuses
`open | picked | waiting | done`. Comment thread with @mentions, photos, files, an optional attached checklist. Live at
`internal.chsnz.co.nz/asks/`. It is a **section of the hub's one app** (no build of its own): `src/section.jsx` is lazy-loaded by
`apps/hub/src/App.jsx`; inside, Asks routes on `#/mine`, `#/all`, `#/company` with `?ask=<id>` for the open panel. Those links are in
pushes, emails and the hub, so **keep them working**.

## Map

| File | What it owns |
|---|---|
| `src/model.js` | Pure (no React/Firebase, tested): fields, `STATUSES`, `LIMITS`, `canSee`, `sentTo`, `isCopied`, `isMineToDo`, `canClaim`, `sortAsks`, `myBuckets`, `myCount`, `statsOf`, `companyCounts`, `cleanAsk`, mentions, `activityOf`, `eventOf`. |
| `src/store.jsx` | React context: live listeners and **every change** (`create`, `claim`, `handBack`, `giveTo`, `setWaiting`, `resume`, `markDone`, `reopen`, `edit`, `comment`, `removeComment`, `remove`). Activity-log lines and the notify call live here. |
| `src/backend.js` | Picks the backend: Firestore (`backend-firebase.js`) in a real build or with a `.env`; a localStorage stand-in (`backend-local.js`, people from `sample.js`) in dev without one. **Both expose the same calls — change both.** |
| `src/backend-firebase.js` | Queries, `mutate` (a transaction, so two people can't both claim), batched create/remove, file parts, `notify` → proxy. |
| `src/photos.js`, `src/files.js` | Photos shrunk to a JPEG data URL ≤ 480,000 chars, one doc each. Files ≤ 5 MB split into ≤ 10 base64 parts of 700,000 chars. **No Firebase Storage**, by design. Only PDF and images open in the browser; anything else downloads (`canView`), so an uploaded HTML/SVG can't run as the hub. |
| `src/App.jsx`, `views/`, `AskPanel.jsx`, `NewAsk.jsx`, `AskList.jsx`, `ui.jsx`, `asks.css` | Screens: shell and tabs, My asks / All / Company, the ask panel, the new/edit form. |
| `src/search-source.js` | Asks in the hub's Ctrl+K (`apps/hub/src/Palette.jsx`), same query as Asks. |
| `scripts/summary.mjs` | 8:30am weekday push/email "You have N open asks" (`.github/workflows/asks-summary.yml`, fires at two UTC times for daylight saving). |

**Outside this folder, using `model.js`:** the hub home panel and header badge (`apps/hub/src/asks.js`, `AsksPanel.jsx`,
`useAsksBadge.js`, `needs.js`), the emulator seed (`scripts/emulator-seed.mjs`), the checklists store (`apps/checklists/src/store.js`
`shareWith`, used when an ask attaches a list). Rename or change a `model.js` export → search the repo for it.

## Where data lives

- **Firestore, in the staff schedule's Firebase project:** `asks/{id}` with subcollections `comments`, `photos`, `files/{fid}/parts/{n}`;
  and `askStats/{id}`, a text-free copy of the counting fields (`statsOf`) that everyone can read for the Company page.
- **Per browser:** localStorage `asks:seen` (when each ask was last opened; the hub reads the same key, and Asks fires the
  `asks:seen` window event so the header badge updates in the same tab).
- **Backup:** nightly to Drive, "CMCHS Asks Backups" (`backend/apps-script/backup/Code.js`): JSON, a spreadsheet, photos and files.

## Rules for changes

- **Privacy is the point.** An ask is seen only by `people` (asker, assignees, cc, owner, @mentioned) and members of its `teams` —
  **not admins** (they stopped seeing every ask on 20 Oct 2026). `canSee` in `model.js` must stay the same test as `canSeeAsk` in the
  rules, and queries must only ask for what the rules can prove readable (`people array-contains`, `teams array-contains`), or
  Firestore refuses the whole query.
- **Changing the shape of an ask means changing the rules too.** `isAsk` lists the allowed keys and limits; `LIMITS` in `model.js`
  mirrors them; `askStats` must equal `askStatsOf(ask)` exactly. New fields are added **only when used** (as `cc`, `fileCount`,
  `checklist` are) so older asks stay valid. A rules change is not published by a push: paste the whole `rules/firestore.rules`
  into the Firebase console and say so (`rules/README.md`). Publish rules **before** pushing code that needs them.
- **Every change goes through `mutate`** (read-modify-write in a transaction, which also rewrites `askStats`). A change that should
  tell people sets `event: eventOf(type, me, …)`; who hears it is decided **server-side** by `askRecipients_` in the proxy, which
  re-reads the ask and only accepts the caller's own event within ten minutes. A new event type needs `activityOf` (model.js),
  `ASK_DOES` (store.jsx), `askRecipients_` and `askMessage_` (proxy) together. Proxy changes need `clasp push` **and**
  `clasp deploy -i <id>` (`backend/README.md`).
- **Offline:** a new ask queues on the device and goes when back online; `sweepAsks` (proxy timer, every 5 min) tells people about
  asks that arrived too late for the browser's own notify. Other changes refuse at once when offline (a transaction needs the network).
- **Activity log:** one line per change, saying what was done ("Marked an ask done") — **never** the title, text, or who it was for.
- **Logs and the summary workflow print counts only**; the repo and its Action logs are public.

## Run and verify

```bash
npm test -w apps/asks
```

Covers who sees/owns what, cc, counts, files, checklist and the proxy's `sweepAsks` (run from `Code.js` in a sandbox). Plus the repo's
`npm run build`, `npm test -w apps/schedule`, `npm test -w apps/hub` (the hub tests cover its Asks panel and search).

Locally: `npm run dev` (the hub) without a `.env` runs Asks on the localStorage stand-in at `/asks/`; add `?as=mike` (or jess, sam,
lee) so two tabs act as two people. `npm run dev:emulators` runs it against the Firestore emulators with the real rules. Pushes can
only be checked on the live site with two people (README, "Ask push" in the checklist). After pushing, reload `/asks/` live and
confirm the change.

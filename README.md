# CMCHS Internal Hub

**internal.chsnz.co.nz**: one Microsoft sign-in, then every internal tool. Hosted on GitHub Pages; every push to `main` deploys.

**Install it as an app** (Chrome: install icon in the address bar; iOS Safari: Share → Add to Home Screen) and every tool opens *inside* that app window — no address bar, no bouncing out to a browser tab. That only works for pages on this domain, which is why tools move in here rather than staying on their own subdomain.

| Path | What | Source |
|---|---|---|
| `/` | Hub home: tools by category, search, announcements | `apps/hub` (Vite + React) |
| `/schedule/` | Staff schedule: team week, my week, day, leave, on call, out of town, and its own Settings for admins | `apps/schedule` (React, react-router inside), a section of the hub's one app (no build of its own) |
| `/simprosync/` | SimproSync: updates and adds customer assets in Simpro from an asset list (admins, and anyone given Simpro access) | `apps/simprosync`, a section of the hub's one app (no build of its own). Moved in with its working code as it is (`app.js` drives `page.html` by id; `mount.js` starts it), restyled onto the kit; a component rewrite waits until it can be tested against Simpro |
| `/maintenance/` | Maintenance schedule: planned maintenance by site, what's due and what's done. Its PM types are in Settings → Maintenance | `apps/maintenance`: its data and import modules, and `src/` the page (React on the kit), a section of the hub's one app (no build of its own) |
| `/ansurtopdf/` | Ansur PVT Report Builder: Fluke Ansur records (.mtr) into PDF reports, on the device, and attached to a Simpro job | `apps/ansurtopdf`, a section of the hub's one app (no build of its own). Moved in with its working code as it is (`builder.js` and `simpro.js` drive `page.html` by id; pdf-lib in `vendor/`), restyled onto the kit; a component rewrite waits until it can be checked against real records |
| `/equipment/` | The new demo tracker, being built (INTEGRATION-PLAN.md step 4): so far the equipment and loans, read-only. Replaces `/demo/` once it does everything the old one does | `apps/equipment`, a section of the hub's one app, on the old tracker's Realtime Database (`src/db.js`) |
| `/settings/` | Settings, from the header's gear. Everyone: appearance (light, dark, match the device; where the hub opens) and their own notifications. Admins: people and access (teams, roles, Simpro access, demo tracker roles) and everyone's notifications, behind the admin password. And each section's own: the staff schedule's (locations, Excel import, activity log) and the project tracker's. `/admin/`, `/schedule/settings` and `/projects/#/settings` forward there. | `apps/settings` (React, react-router inside), a section of the hub's one app; its pages are `apps/admin`'s, the schedule's and the tracker's own screens |
| `/service-orders/` | Service Orders: the service order spreadsheet, with the parser built in | `apps/service-orders`: its data and parsing modules, and `src/` the page (React on the kit), a section of the hub's one app (no build of its own) |
| `/demo/` | Demo equipment tracker, the full app (same live data as demo.chsnz.co.nz) | `apps/demo` (built from the chs-equipment repo) |
| `/projects/` | Project tracker: the project team's job register and weekly timeline in one, with demo equipment availability, an archive and Ctrl+K search | `apps/projects`, a section of the hub's one app (no build of its own) |
| `/asks/` | Asks: quick requests between staff. Send to people or whole teams; the first to pick it up has it, and everyone involved sees who | `apps/asks`, a section of the hub's one app (no build of its own) |

Also here, not web pages: `backend/` (the Apps Script proxy and nightly backup, Tile sync; see `backend/README.md`) and `rules/` (the Firestore and Realtime Database rules; see `rules/README.md`). Everything is being merged into one app: `INTEGRATION-PLAN.md`.

### Project tracker

Replaces the project team's two linked sheets (the job register and the weekly "who is where" sheet) with views of the same live data: Home, Table, Timeline (by job or by person), Equipment, Archive and Settings, plus a side panel per job and Ctrl+K search over active and archived jobs. Several people can edit at once; changes show for everyone straight away, and each job keeps its own history.

- **Data** is Firestore in the staff schedule's project: `projectJobs`, `projectAssignments` (one record per person, job, week and activity, so it can feed the staff schedule later), `projectComments`, `projectHistory`, `projectPresence` and `projectSettings/main`. The rules are in `rules/firestore.rules` (`canEditProjects`): everyone signed in reads; admins and anyone on a team edit.
- **Nothing real lives in this repo.** Jobs come in through Settings → Import from a file: a job register from Excel/CSV, or a project tracker import file (.json: jobs, staff weeks, staff and activity colours together). Keep those files out of git; the sheets carry customer details.
- **Demo pool sizes** are typed in Settings until the demo tracker feed is connected (the Equipment view and job panels say so).
- `npm run dev` (the hub) without a `.env`, then `/projects/`, runs on a local stand-in with sample jobs (`src/backend-local.js`, never in a real build); two tabs act as two people. `npm test -w apps/projects` checks the dates, availability, clash and search logic (`src/model.js`).

### Asks

Instead of a text or another email: anyone raises an ask ("test the new mode on the A7 at Middlemore", "raise this with Mindray"), sends it to people and/or whole teams, and whoever can do it taps **I'll take it**. Everyone involved then sees who has it, and it leaves the others' lists. States: open (nobody has it), picked up, waiting (on a supplier, the customer…), done. Each ask has a comment thread with @mentions and photos from the phone (shrunk in the browser, stored in Firestore, so no Firebase Storage). Pages: My asks (to pick up, on it, asked, recently done), All, and Company (everyone's load).

- **Who sees what** (`firestore.rules`, `canSeeAsk`): only the people involved — the asker, the people and teams it was sent to, whoever picked it up or was @mentioned (`people`) — plus admins. `askStats` mirrors the counts with no text, for the Company page, which everyone sees; its rule checks it matches the ask exactly.
- **Data**: `asks/{id}` with `comments` and `photos` subcollections, and `askStats/{id}`. Fields are described in `apps/asks/src/model.js`.
- **Push for each change**: the browser sends the ask's id to the Apps Script in `backend/apps-script/proxy` (action `notifyAsk`; the same script that sends the hub's other pushes — Asks doesn't use Simpro). It reads the ask back, checks the change is the caller's and new, and pushes to the people concerned; anyone with no phone set up gets an email once `RESEND_API_KEY` and `RESEND_FROM` are in its Script Properties.
- **8:30am weekday summary**: `.github/workflows/asks-summary.yml` runs `apps/asks/scripts/summary.mjs` (push, or email with the `RESEND_*` Actions secrets). Switch people off in Settings → Everyone's notifications (or they switch themselves off in Settings → Your notifications).
- `npm run dev -w apps/asks` without a `.env` runs on a local stand-in with made-up people; add `?as=mike` (or jess, sam, lee) to be someone else. `npm test -w apps/asks` checks who sees and owns what, the counts and the summary.

### Settings: one place for every setting

`/settings/` (`apps/settings`), from the header's gear. **You** (anyone): Appearance (light, dark or match the device, and which page this device opens on, `hub:start`) and Your notifications (turn this phone on; your own schedule reminder and Asks summary). **Admin** (admins, behind the admin password): People and access, and Everyone's notifications, described below (their screens are `apps/admin/src/Admin.jsx`). **Sections**: the staff schedule's settings (below), the project tracker's (`apps/projects/src/settings-page.jsx` hosts its screen), and a link to Maintenance's until it is rebuilt. Old addresses forward (`movedTo` in `apps/hub/src/router.js`).

**People and access** sets each person's team, role and Simpro access (the shared `users` collection), and their **demo tracker role** (Account manager / Service & Projects), which lives in the tracker's own database (`accountManagers`, chs-equipment project). `apps/admin/src/tracker.js` reaches it the same way the tracker does: a database pass from the Simpro proxy (`rtdbToken`), then the REST API, saving with an ETag check so a save from the tracker is never overwritten.

**Everyone's notifications** has a switch per person per tool, plus how many devices each has turned notifications on for (every phone or browser; ones that no longer exist are removed each Monday by `.github/workflows/prune-devices.yml`). Missing means on.
- Staff schedule Thursday reminder: `users/{uid}.notifications.scheduleReminder`; `scripts/remind.mjs` (cmchs-staff-schedule repo) skips anyone with it false.
- Asks 8:30am summary: `users/{uid}.notifications.asksSummary`; `apps/asks/scripts/summary.mjs` skips anyone with it false.
- Demo tracker loan reminders: `accountManagers[].notify`; the Apps Script senders (`backend/apps-script/proxy`, `sendPushToPerson_`) skip anyone with it false. Test sends still go through.

A switch can only stop notifications: getting them at all needs the person to turn them on on their own phone, which the hub home offers on phones until that phone is on (`apps/hub/src/PushPrompt.jsx`), as does Settings → Your notifications. People can turn their own schedule reminder and Asks summary on and off there (`isOwnNotifications` in `rules/firestore.rules`); demo tracker reminders are admins' to set.

One device registration covers every tool. Demo reminders go to the phones turned on here (`users/{uid}.fcmTokens`), sent by the Simpro proxy through the staff schedule's Firebase project with links into `/demo/` ("HUB PUSH" in `backend/apps-script/proxy/Code.js`). Someone with no phone here still gets them on phones set up at demo.chsnz.co.nz, shown in Everyone's notifications as "(old demo app)". This needs the proxy's service account granted *Firebase Cloud Messaging API Admin* and *Cloud Datastore Viewer* in the staff schedule's Google Cloud project; `checkHubPush()` in the Apps Script editor says whether it is.

**Adding notifications to a new tool:** don't add another "turn on" step. Send to the same `users/{uid}.fcmTokens` through the staff schedule's Firebase project (as `apps/schedule/scripts/remind.mjs` and `apps/asks/scripts/summary.mjs` do), with a `data.url` into the tool; add its switch as a column on Settings → Everyone's notifications (and, if people may set it themselves, to Your notifications and `isOwnNotifications` in `rules/firestore.rules`); and if a tap should open somewhere other than `/schedule/`, check `notificationclick` in `apps/hub/src/sw.js` (it opens the tool named by the URL's first path segment).

**Staff schedule settings** (locations, the Excel import, the activity log) are the schedule's own screen (`apps/schedule/src/pages/Settings.jsx`) at `/settings/schedule`, behind the same admin role and password. `/schedule/settings` and old `/admin/#locations`, `#excel` and `#activity` links forward there.

### /demo/ is generated, not copied

Nothing of the tracker lives in this repo. `apps/demo/build.mjs` downloads the current `index.html` from CMCHSGit/chs-equipment on every build and injects `apps/demo/embed.js` as the first script. So `/demo/` is always the same app as demo.chsnz.co.nz, on the same database: a loan made at either address shows at both. `deploy.yml` also runs hourly to pick up tracker changes. **Change the tracker in chs-equipment, never here.**

`embed.js` skips the tracker's team password (the hub sign-in replaces it; the admin password for delete/retire/edit still applies), turns off its service worker and push so they can't collide with the hub's one worker and the schedule's push (demo push notifications stay on demo.chsnz.co.nz), and always uses the desktop layout. The build **fails** if `embed.js` isn't the first script on the page.

`READ_ONLY = true` at the top of `embed.js` turns `/demo/` into a read-only copy (every write refused before it leaves the browser, editing buttons dimmed, a banner). It ran that way for its first day; it's there if it's ever needed again. Remember the database itself is still world-readable.

To build from a local checkout instead of GitHub: `DEMO_SRC=../chs-equipment node apps/demo/build.mjs`.

### The schedule move is mid-flight

**SimproSync and Ansur have moved for good** — the old copies are deleted, these are the only ones.

**The schedule runs in two places on purpose.** It's live here, and still live at `schedule.chsnz.co.nz` from the cmchs-staff-schedule repo. Same Firestore, so nothing is split — it's one app at two addresses, and the old one is the rollback. `tools.json` now points here.

**The Thursday reminder is here** (`.github/workflows/remind.yml`, `apps/schedule/scripts/remind.mjs`, `APP_URL` without a trailing slash). Its timer only runs once the repo variable `HUB_REMINDERS` is `true`, set in the same sitting as switching the old repo's workflow off, so nobody is reminded twice. A manual run is a dry run by default: it counts who would be reminded and sends nothing. It needs the `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` secrets (the schedule's service account).

Still to do (cmchs-staff-schedule `TODO.md` #36–#40): watch two Thursdays from here, tell staff to re-add the app from the new address, retire the old site with a tombstone, and move the Excel job.

`remind.mjs`'s exit code only reflects email failures, so a run where every push failed still shows a green tick. After cutover read the printed `push N sent/M failed` line, not the check mark.

**Don't delete the old domain to retire it.** Its service worker precaches the app at scope `/`, so pulling DNS leaves every already-installed copy serving from cache and writing to live Firestore — people would keep filling in schedules in an app we think is gone. Retiring it means actively shipping a `sw.js` at the same path that unregisters itself and deletes its caches.

## Sign-in
Microsoft sign-in through Firebase Auth, using **the staff schedule's Firebase project** (locked to the Cass Medical tenant). Every app on this domain shares that one session, so people sign in once at the hub and never again, including after closing the browser, until they sign out. The code is in `shared/session.js`.

Plain HTML pages join in with two lines at the top of `<head>` (the retired Service Order Parser was the last page to use them; it's in git history before it became `/service-orders/`):

```html
<script>document.documentElement.style.visibility='hidden'</script>
<script type="module" src="/shared/gate.js"></script>
```

Signed in: the page shows, with a slim "Internal Hub" bar on top unless it has its own "‹ Internal Hub" pill. Signed out: they go to the hub's sign-in, then straight back.

**The site files are public** (GitHub Pages can't password-protect them). Anything confidential must come from Firebase behind its security rules, never sit in this repo. This repo is public too, so **no API keys** — and remember the sign-in gate is not a wall: anything served from here can be fetched without it.

SimproSync is the pattern to copy for a tool that needs a third-party key: the Simpro key lives in a Script Property on the Apps Script proxy, the browser sends only the user's Firebase ID token, and the proxy checks that token belongs to an admin, or to someone given Simpro access in Settings → People and access (`users/{uid}.simproAccess`), before relaying an allowlisted call. The key never reaches the page.

## Add a tool
Every tool sits at the top level, `internal.chsnz.co.nz/<name>/` (the hub's category, not the address, says what it's for).

1. A single-file tool: put it at `apps/<name>/index.html`, add the two gate lines, put the "‹ Internal Hub" pill first in its header (markup and styles in `shared/hub-back.css`; `shared/tool-chrome.css` already includes it), and add `{ dir: 'apps/<name>', path: '<name>', output: '.' }` to `APPS` in `scripts/build.mjs`.
2. Add an entry to `tools.json`:
   ```json
   { "id": "quote", "name": "Quote builder", "description": "One line, shown under the name",
     "link": "/quote/", "category": "Sales", "icon": "calculator", "opens": "here", "visible": true, "short": "Quotes" }
   ```
   - `category`: Everyday, Demo, Service, Schedule, Sales, Clinical, Admin or Microsoft 365 (shown in that order; new names go at the end).
   - `opens`: `here` (same tab, for pages on this site) or `tab` (new tab, for other sites).
   - `short` (optional): the label under its round button in the home page hero; falls back to `name`.
   - `icon`: a [Lucide](https://lucide.dev/icons) name that's listed in `apps/hub/src/Icon.jsx` (add it there if not).
3. Push to `main`.

**Moving a tool's address:** add the old path to `MOVED` in `apps/hub/public/404.html` so bookmarks forward (e.g. `/order-parser/` → `/service-orders/`).

## The home page

Built from `design/CMCHS Internal Hub v2.dc.html` (notes in `design/UPGRADE-v2.md`). What feeds each part:

- **News and announcements, Team news**: posted from Manage (below). The old `announcements.json` still shows until an admin presses "Move into Manage"; its format was `{ "id", "title", "body", "date": "2026-10-14", "author", "pinned", "category", "image" }`. `category` is Announcements, Events or Tool updates (the filter tags; anything else counts as Announcements). `image` is optional: a photo in `apps/hub/public/news/` written as `"news/photo.jpg"`, or a full URL; without one the card shows a grey block. Pinned first, then newest; three show, the rest behind "Show all".
- **Calendar**: `events.json`, `{ "date": "2026-10-21", "title", "time": "Cass Office · 9:00 am", "tag": "Training" }`. NZ public holidays are added automatically from the staff schedule's own list, so don't type them in; `"kind": "holiday"` adds a one-off closure.
- **At a glance, Who's where today, the hero's "out today / on call" line, people in search**: read live from the staff schedule's Firestore (`users`, this week's `schedules`, `oncall`) by `apps/hub/src/today.js`, using the schedule's own code (`apps/schedule/src/utils`) to read each entry, so the two never disagree. At the weekend they show Monday. If the schedule can't be read, those blocks are hidden. "See all people" and each person open the People page.
- **Tools**: `tools.json`, as above. Recent tools come from this browser's history.

`npm run dev` without a `.env` uses sample people (`apps/hub/src/dev-fixture.js`, never in real builds). `npm test -w apps/hub` checks how entries are read.

## People (`/#/people`)

The staff directory and HR profiles, in the hub itself (`apps/hub/src/People.jsx`, data in `people.js`), laid out like BambooHR or Employment Hero. Hash routes: `#/people`, `#/people/me`, `#/people/<uid>`.

| Who | Sees | Edits |
|---|---|---|
| Everyone signed in | everyone's name, team, today's location, work email, work mobile, picture | their own name, work mobile, picture, personal details, emergency contacts and job title |
| HR (admins, or `hr: true` on their `users` record) | everyone's whole profile | everyone's profile (team, manager, start date, employment type too); adds and removes people |

Only an admin can give someone HR access (Job tab → HR access). HR can't remove an admin.

Where it's kept, all in the staff schedule's Firestore: public fields on `users/{uid}` (`displayName`, `email`, `team`, `workMobile`); `staffPhotos/{email}` (a 192px JPEG data URL, made in the browser, ~15 KB); `staffPrivate/{email}` (birthday, personal email and phone, address, emergency contacts); `staffEmployment/{email}` (job title, start date, type, manager). The private ones are keyed by lower-case work email because someone HR adds before they first sign in has only a placeholder id (`pending-jo-bloggs`), which is replaced on that sign-in; the schedule's AuthContext claims a placeholder by its exact email first. **Firestore's rules are what keep private details private** (`isHR`, `isMyEmail` in `firestore.rules`), not the page.

Removing someone deletes their `users` record and the three email-keyed records; their past schedule weeks stay. If they can still sign in, they come back with an empty profile, and the Excel import re-adds anyone still in the spreadsheet.

## Manage (`/#/manage`)

`apps/hub/src/Manage.jsx`. Three tabs:

- **News** (`news.js`). Anyone on a team, or an admin, posts announcements (title, message, category, regions, optional photo, pinned); the author, an admin or HR edits and deletes. Categories: Announcements, Team news, Events, Tool updates. Team news is the project team's weekly update, one line per item, with a section ("The week that's been" / "Next week") and regions; the home page shows the newest week of it in its own panel, filterable by region, and the other categories as the usual three cards.
  - **Paste an email** (`emailSplit.js`): paste the weekly email straight from Outlook (its HTML is read, so links and bullets survive). Each bullet becomes an announcement under its section; a heading with paragraphs (a fundraiser, say) becomes one; the greeting, "And lots more…", sign-off and signature are dropped; the intro is kept but unticked. Regions come from place names, hospitals and the team's abbreviations (`PLACES`: add new ones there); people from the staff list. Everything is a draft to tick, edit, merge or split before posting. `tests/emailSplit.test.mjs` holds an anonymised copy of the real email; if the email's shape changes, start there.
  - **Suggestions from the project tracker** (`suggest.js`): this week's and next week's assignments, by job and activity, and who's on leave, phrased like the email.
  - **Export for email**: pick a range (default: the latest team update and anything posted that week), group Team news by section or region, edit the greeting and sign-off, then "Copy for Outlook" (HTML, pastes formatted) or plain text. Photos are embedded; if Outlook drops them, attach them instead.
  - Stored in `announcements` and, apart, `announcementPhotos` (a JPEG data URL up to ~1000px, so the home page only fetches the photos it shows).
- **Tool requests** and **Feedback** (`requests.js`), one `hubRequests` collection. Anyone requests a tool (everyone sees requests and can +1 them) or rates a tool out of five with what works and what should change (only they and the engineering team see it). The engineering team (Engineers, and admins) sets a status (New, Under review, Planned, Built, Not now) and replies; the person sees the reply. A new one pushes the team's phones through the Simpro proxy (`notifyHubRequest`, `backend/apps-script/proxy`), which re-reads the request and only sends for a new one the caller made, so it can't be used to push arbitrary text.

**A whole new app** (its own build, like the schedule): add a folder under `apps/`, build it with its own base path (e.g. Vite `base: '/schedule/'`), and add it to `APPS` in `scripts/build.mjs`. Prefix any localStorage keys with the app name, because every app shares this origin. Don't give it its own manifest or service worker — see below.

⚠️ **In a Vite app, a root-absolute path in `index.html` is not what gets served.** Vite rewrites `src`/`href` on `<img>`, `<link rel="icon">` and `apple-touch-icon` through `base`, so `/brand/logo-mark.png` ships as `/<app>/brand/logo-mark.png` — a 404 unless that app has its own copy in `public/`. It leaves `<a href>` and `<link rel="manifest">` alone, which is why the back button and the shared manifest work unchanged. It does preserve query strings (`?v=2` survives). Static passthrough apps get no rewriting at all, so root-absolute paths there reach the hub's copies. **Check the built file, not the source**, whenever a path matters.

## The app shell: one manifest, one service worker

There is **exactly one of each on the origin**, both owned by the hub. A second manifest would create a second installable app, and a second service worker would fight this one over the same pages.

- `apps/hub/public/manifest.webmanifest` — `scope: "/"` is what makes every tool open inside the installed app.
- `apps/hub/src/sw.js` → served as `/sw.js`, scope `/`. Registered by `shared/register-sw.js`, which every app calls (`main.jsx`, `gate.js`, …). Calling it from more than one place is a no-op, and it means someone who only ever opens one tool still gets the update check.

Two things about the build are easy to trip over:

1. **The worker is built on its own**, by `apps/hub/vite.sw.config.js` (`format: 'iife'`), not as another input of the hub's build. Rollup would otherwise be free to split shared code into a chunk the worker has to `import`, which makes it a module worker — and `importScripts`, needed for the Firebase compat SDK's background push, throws in one.
2. **Its precache list is generated last, over the assembled `dist/`.** No individual app's build can see the other apps' files. The worker build emits `sw-src.js` with an empty `self.__WB_MANIFEST`; `scripts/build.mjs` runs workbox's `injectManifest` over the whole site at the end and writes the real `sw.js`. A new app's files are picked up automatically — nothing to add.

If you add a page people should be able to install *from* (iOS reads only the metas of the page being added, not the manifest's), copy the `<link rel="manifest">` block out of `apps/hub/index.html`.

## Run it locally
```
npm install
npm run dev                  # the one app at http://localhost:5173 with a pretend "Dev User" (no .env needed)
npm test -w apps/schedule    # the schedule's unit tests
npm run build                # whole site into dist/
npm run preview              # serve dist/ at http://localhost:4173 (needs .env for real sign-in)
```

The service worker only registers in a real build, so `npm run dev` never installs one — use `npm run build && npm run preview` to exercise it. Deep links are the other thing `dev` won't show you honestly: Vite's dev server has its own SPA fallback, so `/schedule/my` just works there, while on GitHub Pages it goes through `404.html`. The schedule, Admin and anything else reading Firestore need the `.env` to show their screens; without one they show the shell's "didn't load" message.
For real sign-in locally, copy `.env.example` to `.env` and fill it in with the schedule's Firebase web config.

## Deploy setup (one-time)
- **Secrets:** Settings → Secrets and variables → Actions: the `VITE_*` values from `.env.example`, same values as the cmchs-staff-schedule repo. `VITE_FIREBASE_VAPID_KEY` is the one to watch — an empty value doesn't fail, it quietly falls back to a default key and mints working push tokens, which all rotate the day the real key is added. Set it before anyone enrols for notifications.
- **Pages:** Settings → Pages → Source: **GitHub Actions**; Custom domain `internal.chsnz.co.nz`; Enforce HTTPS.
- **DNS:** CNAME `internal` → `cmchsgit.github.io`.
- **Firebase:** console → Authentication → Settings → Authorized domains → add `internal.chsnz.co.nz`.

## Design
`design/` is the original design handoff (`design/HANDOFF.md`), the v2 home page (`design/CMCHS Internal Hub v2.dc.html`, `design/UPGRADE-v2.md`) and prototypes. Reference only, not shipped. Colours, type and spacing come from the Connected Healthcare Systems design system in `shared/tokens/`.

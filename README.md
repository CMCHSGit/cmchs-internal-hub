# CMCHS Internal Hub

**internal.chsnz.co.nz**: one Microsoft sign-in, then every internal tool. Hosted on GitHub Pages; every push to `main` deploys.

**Install it as an app** (Chrome: install icon in the address bar; iOS Safari: Share → Add to Home Screen) and every tool opens *inside* that app window — no address bar, no bouncing out to a browser tab. That only works for pages on this domain, which is why tools move in here rather than staying on their own subdomain.

| Path | What | Source |
|---|---|---|
| `/` | Hub home: tools by category, search, announcements | `apps/hub` (Vite + React) |
| `/schedule/` | Staff schedule | `apps/schedule` (Vite + React) |
| `/simprosync/` | Simpro Asset Sync | `apps/simprosync` (Vite) |
| `/ansurtopdf/` | Ansur PVT Report Builder | `apps/ansurtopdf` (single static page) |
| `/order-parser/` | Service Order Parser | `apps/order-parser` (single static page) |
| `/demo/` | Demo equipment tracker, the full app (same live data as demo.chsnz.co.nz) | `apps/demo` (built from the chs-equipment repo) |

### /demo/ is generated, not copied

Nothing of the tracker lives in this repo. `apps/demo/build.mjs` downloads the current `index.html` from CMCHSGit/chs-equipment on every build and injects `apps/demo/embed.js` as the first script. So `/demo/` is always the same app as demo.chsnz.co.nz, on the same database: a loan made at either address shows at both. `deploy.yml` also runs hourly to pick up tracker changes. **Change the tracker in chs-equipment, never here.**

`embed.js` skips the tracker's team password (the hub sign-in replaces it; the admin password for delete/retire/edit still applies), turns off its service worker and push so they can't collide with the hub's one worker and the schedule's push (demo push notifications stay on demo.chsnz.co.nz), and always uses the desktop layout. The build **fails** if `embed.js` isn't the first script on the page.

`READ_ONLY = true` at the top of `embed.js` turns `/demo/` into a read-only copy (every write refused before it leaves the browser, editing buttons dimmed, a banner). It ran that way for its first day; it's there if it's ever needed again. Remember the database itself is still world-readable.

To build from a local checkout instead of GitHub: `DEMO_SRC=../chs-equipment node apps/demo/build.mjs`.

### The schedule move is mid-flight

**SimproSync and Ansur have moved for good** — the old copies are deleted, these are the only ones.

**The schedule runs in two places on purpose.** It's live here, and still live at `schedule.chsnz.co.nz` from the cmchs-staff-schedule repo. Same Firestore, so nothing is split — it's one app at two addresses, and the old one is the rollback. `tools.json` now points here.

Still to do: move the scheduled jobs (`remind.yml`, `excel-sync.yml`) across with `APP_URL` set to `https://internal.chsnz.co.nz/schedule` (**no trailing slash** — `remind.mjs` builds `${APP_URL}/my`), run both in parallel for 2–3 weeks spanning two Thursdays, then replace the old site with a tombstone.

`remind.mjs`'s exit code only reflects email failures, so a run where every push failed still shows a green tick. After cutover read the printed `push N sent/M failed` line, not the check mark.

**Don't delete the old domain to retire it.** Its service worker precaches the app at scope `/`, so pulling DNS leaves every already-installed copy serving from cache and writing to live Firestore — people would keep filling in schedules in an app we think is gone. Retiring it means actively shipping a `sw.js` at the same path that unregisters itself and deletes its caches.

## Sign-in
Microsoft sign-in through Firebase Auth, using **the staff schedule's Firebase project** (locked to the Cass Medical tenant). Every app on this domain shares that one session, so people sign in once at the hub and never again, including after closing the browser, until they sign out. The code is in `shared/session.js`.

Plain HTML pages join in with two lines at the top of `<head>` (see `apps/order-parser`):

```html
<script>document.documentElement.style.visibility='hidden'</script>
<script type="module" src="/shared/gate.js"></script>
```

Signed in: the page shows with a slim "Internal Hub" bar on top. Signed out: they go to the hub's sign-in, then straight back.

**The site files are public** (GitHub Pages can't password-protect them). Anything confidential must come from Firebase behind its security rules, never sit in this repo. This repo is public too, so **no API keys** — and remember the sign-in gate is not a wall: anything served from here can be fetched without it.

SimproSync is the pattern to copy for a tool that needs a third-party key: the Simpro key lives in a Script Property on the Apps Script proxy, the browser sends only the user's Firebase ID token, and the proxy checks that token is a real admin before relaying an allowlisted call. The key never reaches the page.

## Add a tool
Every tool sits at the top level, `internal.chsnz.co.nz/<name>/` (the hub's category, not the address, says what it's for).

1. A single-file tool: put it at `apps/<name>/index.html`, add the two gate lines, and add `{ dir: 'apps/<name>', path: '<name>', output: '.' }` to `APPS` in `scripts/build.mjs`.
2. Add an entry to `tools.json`:
   ```json
   { "id": "quote", "name": "Quote builder", "description": "One line, shown under the name",
     "link": "/quote/", "category": "Sales", "icon": "calculator", "opens": "here", "visible": true }
   ```
   - `category`: Demo, Service, Schedule, Sales, Clinical, Admin or Microsoft 365 (shown in that order; new names go at the end).
   - `opens`: `here` (same tab, for pages on this site) or `tab` (new tab, for other sites).
   - `icon`: a [Lucide](https://lucide.dev/icons) name that's listed in `apps/hub/src/Icon.jsx` (add it there if not).
3. Push to `main`.

**Moving a tool's address:** add the old path to `MOVED` in `apps/hub/public/404.html` so bookmarks forward (e.g. `/service/order-parser/` → `/order-parser/`).

**Announcements:** `announcements.json`, `{ "id", "title", "body", "date": "2026-10-07", "author", "pinned" }`. Pinned first, then newest.

**A whole new app** (its own build, like the schedule): add a folder under `apps/`, build it with its own base path (e.g. Vite `base: '/schedule/'`), and add it to `APPS` in `scripts/build.mjs`. Prefix any localStorage keys with the app name, because every app shares this origin. Don't give it its own manifest or service worker — see below.

⚠️ **In a Vite app, a root-absolute path in `index.html` is not what gets served.** Vite rewrites `src`/`href` on `<img>`, `<link rel="icon">` and `apple-touch-icon` through `base`, so `/brand/logo-mark.png` ships as `/<app>/brand/logo-mark.png` — a 404 unless that app has its own copy in `public/`. It leaves `<a href>` and `<link rel="manifest">` alone, which is why the back button and the shared manifest work unchanged. It does preserve query strings (`?v=2` survives). Static passthrough apps (Ansur, the order parser) get no rewriting at all, so root-absolute paths there reach the hub's copies. **Check the built file, not the source**, whenever a path matters.

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
npm run dev                  # hub at http://localhost:5173 with a pretend "Dev User" (no .env needed)
npm run dev -w apps/schedule # the schedule on its own
npm test -w apps/schedule    # the schedule's unit tests
npm run build                # whole site into dist/
npm run preview              # serve dist/ at http://localhost:4173 (needs .env for real sign-in)
```

The service worker only registers in a real build, so `npm run dev` never installs one — use `npm run build && npm run preview` to exercise it. Deep links are the other thing `dev` won't show you honestly: Vite's dev server has its own SPA fallback, so `/schedule/my` just works there, while on GitHub Pages it goes through `404.html`.
For real sign-in locally, copy `.env.example` to `.env` and fill it in with the schedule's Firebase web config.

## Deploy setup (one-time)
- **Secrets:** Settings → Secrets and variables → Actions: the `VITE_*` values from `.env.example`, same values as the cmchs-staff-schedule repo. `VITE_FIREBASE_VAPID_KEY` is the one to watch — an empty value doesn't fail, it quietly falls back to a default key and mints working push tokens, which all rotate the day the real key is added. Set it before anyone enrols for notifications.
- **Pages:** Settings → Pages → Source: **GitHub Actions**; Custom domain `internal.chsnz.co.nz`; Enforce HTTPS.
- **DNS:** CNAME `internal` → `cmchsgit.github.io`.
- **Firebase:** console → Authentication → Settings → Authorized domains → add `internal.chsnz.co.nz`.

## Design
`design/` is the original design handoff (`design/HANDOFF.md`) and prototypes. Reference only, not shipped. Colours, type and spacing come from the Connected Healthcare Systems design system in `shared/tokens/`.

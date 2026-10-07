# CMCHS Internal Hub

**internal.chsnz.co.nz**: one Microsoft sign-in, then every internal tool. Hosted on GitHub Pages; every push to `main` deploys.

**Install it as an app** (Chrome: install icon in the address bar; iOS Safari: Share → Add to Home Screen) and every tool opens *inside* that app window — no address bar, no bouncing out to a browser tab. That only works for pages on this domain, which is why tools move in here rather than staying on their own subdomain.

| Path | What | Source |
|---|---|---|
| `/` | Hub home: tools by category, search, announcements | `apps/hub` (Vite + React) |
| `/service/order-parser/` | Service Order Parser | `apps/service/order-parser` |
| `/demo/`, `/schedule/` | Coming: still at demo.chsnz.co.nz and schedule.chsnz.co.nz for now | |

**Ansur PVT Report Builder** and **Simpro Asset Sync** are maintained in the cmchs-staff-schedule repo (`schedule.chsnz.co.nz/ansurtopdf/` and `/simprosync/`); the hub cards link there. They move in here with the schedule app (phase 3). Don't copy them into this repo before then, so there's only ever one version of each.

## Sign-in
Microsoft sign-in through Firebase Auth, using **the staff schedule's Firebase project** (locked to the Cass Medical tenant). Every app on this domain shares that one session, so people sign in once at the hub and never again, including after closing the browser, until they sign out. The code is in `shared/session.js`.

Plain HTML pages join in with two lines at the top of `<head>` (see `apps/service/order-parser`):

```html
<script>document.documentElement.style.visibility='hidden'</script>
<script type="module" src="/shared/gate.js"></script>
```

Signed in: the page shows with a slim "Internal Hub" bar on top. Signed out: they go to the hub's sign-in, then straight back.

**The site files are public** (GitHub Pages can't password-protect them). Anything confidential must come from Firebase behind its security rules, never sit in this repo. This repo is public too, so **no API keys** — and remember the sign-in gate is not a wall: anything served from here can be fetched without it.

SimproSync is the pattern to copy for a tool that needs a third-party key: the Simpro key lives in a Script Property on the Apps Script proxy, the browser sends only the user's Firebase ID token, and the proxy checks that token is a real admin before relaying an allowlisted call. The key never reaches the page.

## Add a tool
1. A single-file tool: put it at `apps/service/<name>/index.html` and add the two gate lines.
2. Add an entry to `tools.json`:
   ```json
   { "id": "quote", "name": "Quote builder", "description": "One line, shown under the name",
     "link": "/service/quote/", "category": "Sales", "icon": "calculator", "opens": "here", "visible": true }
   ```
   - `category`: Demo, Service, Schedule, Sales, Clinical, Admin or Microsoft 365 (shown in that order; new names go at the end).
   - `opens`: `here` (same tab, for pages on this site) or `tab` (new tab, for other sites).
   - `icon`: a [Lucide](https://lucide.dev/icons) name that's listed in `apps/hub/src/Icon.jsx` (add it there if not).
3. Push to `main`.

**Announcements:** `announcements.json`, `{ "id", "title", "body", "date": "2026-10-07", "author", "pinned" }`. Pinned first, then newest.

**A whole new app** (its own build, like the schedule): add a folder under `apps/`, build it with its own base path (e.g. Vite `base: '/schedule/'`), and add it to `APPS` in `scripts/build.mjs`. Prefix any localStorage keys with the app name, because every app shares this origin. Don't give it its own manifest or service worker — see below.

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
npm run dev        # hub at http://localhost:5173 with a pretend "Dev User" (no .env needed)
npm run build      # whole site into dist/
npm run preview    # serve dist/ at http://localhost:4173 (needs .env for real sign-in)
```
For real sign-in locally, copy `.env.example` to `.env` and fill it in with the schedule's Firebase web config.

## Deploy setup (one-time)
- **Secrets:** Settings → Secrets and variables → Actions: the `VITE_*` values from `.env.example`, same values as the cmchs-staff-schedule repo. `VITE_FIREBASE_VAPID_KEY` is the one to watch — an empty value doesn't fail, it quietly falls back to a default key and mints working push tokens, which all rotate the day the real key is added. Set it before anyone enrols for notifications.
- **Pages:** Settings → Pages → Source: **GitHub Actions**; Custom domain `internal.chsnz.co.nz`; Enforce HTTPS.
- **DNS:** CNAME `internal` → `cmchsgit.github.io`.
- **Firebase:** console → Authentication → Settings → Authorized domains → add `internal.chsnz.co.nz`.

## Design
`design/` is the original design handoff (`design/HANDOFF.md`) and prototypes. Reference only, not shipped. Colours, type and spacing come from the Connected Healthcare Systems design system in `shared/tokens/`.

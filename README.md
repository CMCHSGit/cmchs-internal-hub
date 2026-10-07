# CMCHS Internal Hub

**internal.chsnz.co.nz**: one Microsoft sign-in, then every internal tool. Hosted on GitHub Pages; every push to `main` deploys.

| Path | What | Source |
|---|---|---|
| `/` | Hub home: tools by category, search, announcements | `apps/hub` (Vite + React) |
| `/service/order-parser/` | Service Order Parser | `apps/service/order-parser` |
| `/service/ansur/` | Ansur PVT Report Builder | `apps/service/ansur` |
| `/service/simpro-sync/` | Simpro Asset Sync | `apps/service/simpro-sync` |
| `/demo/`, `/schedule/` | Coming: still at demo.chsnz.co.nz and schedule.chsnz.co.nz for now | |

## Sign-in
Microsoft sign-in through Firebase Auth, using **the staff schedule's Firebase project** (locked to the Cass Medical tenant). Every app on this domain shares that one session, so people sign in once at the hub and never again, including after closing the browser, until they sign out. The code is in `shared/session.js`.

Plain HTML pages join in with two lines at the top of `<head>` (see the three `/service` tools):

```html
<script>document.documentElement.style.visibility='hidden'</script>
<script type="module" src="/shared/gate.js"></script>
```

Signed in: the page shows with a slim "Internal Hub" bar on top. Signed out: they go to the hub's sign-in, then straight back.

**The site files are public** (GitHub Pages can't password-protect them). Anything confidential must come from Firebase behind its security rules, never sit in this repo. This repo is public too, so **no API keys**: SimproSync loads its key in the browser.

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

**A whole new app** (its own build, like the schedule): add a folder under `apps/`, build it with its own base path (e.g. Vite `base: '/schedule/'`), and add it to `APPS` in `scripts/build.mjs`. Prefix any localStorage keys with the app name, because every app shares this origin.

## Run it locally
```
npm install
npm run dev        # hub at http://localhost:5173 with a pretend "Dev User" (no .env needed)
npm run build      # whole site into dist/
npm run preview    # serve dist/ at http://localhost:4173 (needs .env for real sign-in)
```
For real sign-in locally, copy `.env.example` to `.env` and fill it in with the schedule's Firebase web config.

## Deploy setup (one-time)
- **Secrets:** Settings → Secrets and variables → Actions: the `VITE_*` values from `.env.example`, same values as the cmchs-staff-schedule repo.
- **Pages:** Settings → Pages → Source: **GitHub Actions**; Custom domain `internal.chsnz.co.nz`; Enforce HTTPS.
- **DNS:** CNAME `internal` → `cmchsgit.github.io`.
- **Firebase:** console → Authentication → Settings → Authorized domains → add `internal.chsnz.co.nz`.

## Design
`design/` is the original design handoff (`design/HANDOFF.md`) and prototypes. Reference only, not shipped. Colours, type and spacing come from the Connected Healthcare Systems design system in `shared/tokens/`.

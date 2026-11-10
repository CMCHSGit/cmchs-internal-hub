# Hub home page — read this before changing anything here

Claude loads this file when working under `apps/hub/`. That folder is two things: **the home page** (and the hub's
other own pages, People, Manage, a news post) and **the shell** every section runs inside (sign-in, header, router,
Ctrl+K, service worker). This is the short map, mostly of the home page; the detail lives in:

- `README.md` (repo root): **The home page** (what feeds each block, the `events.json` / old `announcements.json`
  formats), **Add a tool** (`tools.json`), **People**, **Manage**, **The app shell: one manifest, one service worker**.
- `INTEGRATION-PLAN.md` — step 2 (the shell and router) and how a tool moves in as a section.
- `design/CMCHS Internal Hub v2.dc.html` + `design/UPGRADE-v2.md` — the design the home page is built from.

## What it is

`internal.chsnz.co.nz/` once signed in: the first thing every staff member sees, on PCs and (installed as an app) on
phones. Top to bottom (`Home.jsx`):

1. **Hero** — date, "Kia ora, <first name>", a line with who's out today and who's on call (plus a public holiday), the
   tools-and-people search, and the round-icon **quick launch** row, which each person can **Customise**.
2. **Needs you** — one strip of what's waiting on this person; hidden when nothing is.
3. **At a glance** — In the office / On site / Remote / Out / On call this week; a card opens its list of people.
4. **Asks** panel — asks waiting for you and the latest activity on yours.
5. **News and announcements** (three cards, pinned first, filter tags, "Show all") and **Team news** (the project
   team's weekly update, by section and region).
6. **Who's where today** (directory, by team) beside **Calendar** ("Coming up").
7. **Tools** — every tool by category; then the footer.

Blocks that need data they can't read **hide themselves** rather than erroring (schedule unreadable → glance, directory
and hero line go; Asks unreadable → panel goes).

## The map

| File | What it owns |
|---|---|
| `src/Home.jsx` | The page and every block above: `Hero`, `HeroSearch`, `Glance`, `News`/`NewsCard`, `TeamNews`, `Directory`, `Tools`/`ToolCard`, `Footer`. Keeps what it last showed in a module-level `seen` so coming back from People/Manage doesn't flash. |
| `src/today.js` | Who's where: reads `users`, this week's `schedules`, `oncall` from Firestore and interprets them with **the schedule's own code** (`apps/schedule/src/utils`), so home and schedule never disagree. `buildToday` is pure (tested); weekends show Monday. Resolves `null` when unreadable. |
| `src/news.js` | Announcements: categories, sort/merge with the old `announcements.json`, Team news grouping, `canPost`/`canEdit`, photos (`announcementPhotos`), save/delete, email export. `social.js`: reactions, comments, `notifyNews`. `NewsPost.jsx`: one post's page (`#/news/<id>`). |
| `src/tool-news.js` | New tools to announce: a tool in `tools.json` that isn't in `KNOWN_TOOLS`, no post's `toolId`, nor `settings/toolNews.dismissed` → a Tool updates draft in Manage → News. Never add to `KNOWN_TOOLS`. |
| `src/asks.js`, `AsksPanel.jsx`, `useAsksBadge.js` | The Asks panel and header badge: same queries and `asks:seen` marks as Asks itself, via `apps/asks/src/model.js` (see `apps/asks/CLAUDE.md`). |
| `src/needs.js`, `NeedsYou.jsx` | "Needs you": pure `needsYou({ badges, asks })` over the header-tab counts (`shared/badges.js`) and the asks summary. A new section count shows automatically; add it to the list in `needs.js` to word it. |
| `src/tools.js` + root `tools.json` | The tool list: category order and stripe colours, `SERVICE_TOOL_IDS` (in the Service menu, not the home grid), search, recent tools (`hub:recent`), `opensInTab`, `openPhoneApp`. Icons must be in `Icon.jsx`'s map (Lucide; unknown → link icon). |
| `src/home-layout.js`, `HomeCustomise.jsx` | The quick-launch row: tool ids and `{ label, url }` links, max 30, `safeUrl` only (https or a path on this site). Saved to `users/{uid}.homeLayout = { quick: [...] }` and localStorage `hub:home-layout:<uid>`. |
| `src/Calendar.jsx` + root `events.json` | "Coming up": `events.json` plus NZ public holidays from the schedule's list (never type holidays in). |
| `src/PushPrompt.jsx` | "Turn on notifications?" on phones only, until that phone is registered (`users/{uid}.fcmTokens`). |
| `src/People.jsx` / `people.js`, `Manage.jsx` (+ `emailSplit.js`, `suggest.js`, `requests.js`) | The hub's other pages: directory/HR profiles (`#/people`), and News / Tool requests / Feedback (`#/manage`). README has their rules. |
| Styles | `hub.css` (home look; `vite.config.js` scopes it inside `.hub-page` / `body[data-section="hub"]` so it can't restyle other sections), `shell.css`, `palette.css`; components and tokens from `shared/ui`, `shared/tokens`. |
| `src/dev-fixture.js` | Made-up people for `npm run dev` without a `.env` (never in real builds). |

**The shell, same folder:** `main.jsx` (redirect restore, start page `hub:start`, link interception, service worker),
`App.jsx` (sign-in, profile creation, header, lazy-loads every section, `SectionBoundary` for chunks lost to a deploy),
`router.js` (`SECTIONS`; hub pages still route on `#/people`, `#/manage`, `#/news/<id>`), `Header.jsx`, `Palette.jsx` +
`search.js` (Ctrl+K), `sw.js` (built separately by `vite.sw.config.js`), `public/404.html` (deep links, `MOVED`),
`public/manifest.webmanifest`. Changing these affects **every** section — read README's shell section first.

## Where data lives

- **Firestore, the staff schedule's project:** `users`, `schedules`, `oncall` (read only, by `today.js`);
  `users/{uid}.homeLayout` (own record, `isHomeLayout` in `rules/firestore.rules`); `announcements` (+ `/comments`)
  and `announcementPhotos`; `settings/toolNews` (new tools not to announce); `asks` (read, via Asks' rules); `hubRequests` (Manage).
- **In the repo:** `tools.json`, `events.json`, the old `announcements.json` (until "Move into Manage"), photos in
  `apps/hub/public/news/`.
- **Per browser (localStorage, prefixed `hub:`):** `hub:home-layout:<uid>`, `hub:recent`, `hub:start`;
  `asks:seen` is shared with Asks on purpose. Session: `hub:chunkReload`.

## Rules for changes

- **Read-only on other tools' data.** The home page shows the schedule, Asks and badges; it never writes them. Reuse
  their code (`apps/schedule/src/utils`, `apps/asks/src/model.js`) instead of re-deriving meaning here.
- **Fail quiet, per block.** A block whose source can't be read hides; it never takes the page down or shows a raw error.
- **Keep the first paint light.** Firestore is imported on demand (`today.js`, `asks.js`, `home-layout.js`); sections are
  `lazy()`; big or rare assets stay out of the service worker's precache (`globIgnores` in `scripts/build.mjs`).
- **Links into sections must keep landing:** `/asks/#/mine?ask=<id>`, `#/people/<uid>`, `#/news/<id>` and every tool
  path are in pushes, emails and bookmarks. Moving a tool's address → `MOVED` in `public/404.html`.
- **New `users` field (like `homeLayout`) → change the own-record rule** in `rules/firestore.rules`. A push doesn't
  publish rules: paste the whole file into the console and say so. Saves must still work on this device if refused.
- **Activity log:** posts, reactions/comments, edits, deletes and requests log one line through `src/log.js`
  (`shared/activity.js`, `app: 'hub'`; People through `people.js`) — never post text, comments,
  or who it's about. Customising your own icon row is a personal preference, not data.
- **Phones and dark mode:** check the narrow layout (glance goes to 2 columns under 760px) and both themes.

## Verify

```bash
npm test -w apps/hub
```

Covers `today` (who's where), news, social, needs, asks, search, people, the email splitter and more. Plus the repo's
`npm run build` and `npm test -w apps/schedule`. `npm run dev` with no `.env` runs on sample people; the test copy
(`npm run dev:emulators`, README "Test copy") runs it with real rules as different people. After pushing, reload `/`
on the live site and confirm the change (the app updates itself when idle or reopened).

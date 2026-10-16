# One app: the integration plan

Agreed with Jonathan on 16 Oct 2026. Every session working on any of the
three repos follows this. **If you are about to build something, check here
first where it should live.**

## The goal

Everything at internal.chsnz.co.nz becomes **one app from one repo** (this
one): one shell, one look, one sign-in, one set of settings, one service
worker. The tools (staff schedule, demo tracker, project tracker, Asks,
service orders, maintenance, SimproSync, Ansur, People, News, admin) become
sections of it, not separate sites with a back button.

### What "consistent" means here

- **Look.** The CHS design system only: `shared/tokens` colours, Source Sans 3
  and Titillium Web, light, dark and "match my device", the three-stripe rule
  under the header. No tool defines its own palette or fonts.
- **Shell.** One header: Internal Hub, logo, the section's name, Ctrl+K search,
  notifications, the account menu. Sections in a left menu on desktop and bottom
  tabs on phones. Moving between sections never reloads the page.
- **Components.** Buttons, inputs, tags, badges, alerts, switches, cards,
  tables, dialogs, the side panel, toasts, empty and loading states come from the
  one kit (`shared/ui`). No native `confirm()` / `alert()`, no per-tool modals.
- **Behaviour.** Changes save as they're made, with a toast. Deleting asks in a
  dialog. Dates are NZ style (16-Oct, 16-Oct-2026). Live data updates without
  refreshing. One way of offering a new version (reload when idle).
- **People and permissions.** One profile per person (`users/{uid}` in the
  staff schedule's Firestore), one permissions check, `can(user, 'projects.edit')`,
  driven by role and team. No shared passwords.
- **Settings.** One Settings area. *Personal*: theme, notifications per section,
  start page. *Admin*: people, teams and roles; who can do what in each
  section; each section's own settings.
- **Notifications.** One registration per phone, at internal.chsnz.co.nz; every
  notification opens the right screen in the app.

## Decisions

1. **The demo tracker is rebuilt inside the app**, screen by screen, not patched
   into it. The 1 MB single file with separate desktop and phone versions can't
   be made consistent any other way. The old one keeps running until the new
   one matches it.
2. **The tracker's data moves to Firestore**, but only in step 5, after the
   new screens have been proven against the current Realtime Database.
3. **Private repo** (GitHub Pro, about US$4/month): recommended once
   everything is in one place. Jonathan's call; nothing below depends on it.
4. **No new separate tools.** New features go into an existing section, or
   into the shell once step 2 lands. (Asks shipped as a separate tool on 16 Oct
   before this was agreed; it moves in with the other React tools.)

## Steps

Status is kept here. Tick items as they land, with the commit.

### 0. Shared foundations
- [x] Same header layout, palette and fonts in every tool (`043dad8`;
      tracker `chs-equipment 9bfbc79`); same tab icon (`e34ed42`)
- [x] One proxy address for every tool (`shared/proxy.js`)
- [x] Shared component kit `shared/ui`: `index.jsx` (components, toasts),
      `ui.css` (tokens, base, component styles), `dark.css` (dark mode). Moved from
      the staff schedule, whose old paths re-export it. New code imports from here.
- [x] Dark mode on the hub home page, with a light/dark switch in its header
- [ ] Dark mode in the demo tracker (or wait for its rebuild, step 4)

### 1. One repo
- [x] Firestore and Realtime Database rules in `rules/` here, with their tests
      (`rules/README.md`); the old copies are gone from both repos
- [ ] The staff schedule's Excel sync job and scripts here; then switch
      schedule.chsnz.co.nz off with a tombstone service worker (its TODO #36–#40),
      after two Thursdays of the reminder running from here
- [x] Apps Script proxy and backup in `backend/apps-script/` here, with history
      (`backend/README.md`: how to deploy). Same Apps Script projects; clasp works
      from the new folders.
- [ ] Tile sync script and workflow here, with history: moved, waiting on its
      Actions secrets here and the `TILE_SYNC_HERE` switch; then the old copy in
      chs-equipment is removed
- [ ] The demo tracker's source here, with history (`git subtree`), and
      demo.chsnz.co.nz deployed from here until step 4 retires it
- [ ] Archive `chs-equipment` and `cmchs-staff-schedule` once nothing deploys
      from them

### 2. One shell
- [ ] The hub becomes the shell, with a router
- [ ] Move in the React sections: staff schedule, project tracker, Asks,
      admin, People, Manage. Remove their own headers, toasts and modals.
- [ ] One Settings area (merges Admin settings, the schedule's Settings, the
      project tracker's Settings, maintenance's settings, hub Manage, People's HR)
- [ ] Ctrl+K searches every section

### 3. Rebuild the plain tools on the kit
- [ ] Service Orders  - [ ] Maintenance  - [ ] SimproSync  - [ ] Ansur

### 4. Rebuild the demo tracker
Screen by screen, one responsive layout, on the current Realtime Database
through a small data layer. A parity checklist against the old tracker, then
switch `/demo/` over, tombstone demo.chsnz.co.nz, staff re-enable
notifications at the new address.
- [ ] Data layer  - [ ] Scan / loan  - [ ] Loans  - [ ] Database
- [ ] Calendar  - [ ] History  - [ ] Import  - [ ] Settings  - [ ] Parity check

### 5. One identity and data platform
- [x] Demo tracker reminders go to phones turned on at internal.chsnz.co.nz
      (`chs-equipment ce95adb`)
- [ ] The tracker's `accountManagers` folded into `users`; admin password
      replaced by roles
- [ ] Tracker data moved to Firestore; one Firebase project; one backup
- [ ] Notifications from one place, linking into the app

### 6. Clean-up
- [ ] Remove the duplicates (two Firebase start-ups, `chs-tokens.css` copy,
      the hub's own `.btn/.badge/.card`, per-tool update handling)
- [ ] Documentation: README, CLAUDE.md, PROJECT-CONTEXT.md

## Links between tools that must keep working

Until two sides are in the same app, these are contracts. Don't break them
while moving things:

- Project tracker → demo tracker: "Create loan form" opens `/demo/?newLoan=1&ref=…`
  in a pop-up; the tracker posts `{ type: 'chs-demo-loan-created', ref, batchId, … }`
  back (same origin only). (`apps/projects/src/JobPanel.jsx`, tracker `submitBatchLoan()`)
- Project tracker reads the demo tracker's `data/equipment` and `upcomingLoans`
  through `apps/admin/src/tracker.js` (`apps/projects/src/feed.js`).
- Hub home: news suggestions from the project tracker (`apps/hub/src/suggest.js`),
  Asks on the home page.
- Notification links: `/demo/` (with `?reassign=` etc., parsed by the tracker's
  `handleReturnLink()`), `/asks/`.
- The proxy's actions: `rtdbToken`, `testPush`, `notifyHubRequest`, `notifyAsk`,
  `simproSync`, and Simpro job create/update/close for the tracker.

## Working while everything moves

Other sessions keep pushing while this runs. To keep that safe:

- **Pull before every step and before every commit.** If something landed in
  the area being moved, fold it in first.
- **One tool at a time.** A step only freezes the tool it is moving; say so in
  its commit and here.
- **Changes in the old place after a move get carried over.** Before
  committing, check the old location's log since the move.
- **Never push someone else's unpushed work.** If `git status` shows local
  commits that aren't yours, stop and leave them.
- **When a tool moves, update its pointers**: this file, `CLAUDE.md` in every
  repo, `README.md`.

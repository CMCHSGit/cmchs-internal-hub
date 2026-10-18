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
- [x] Tile sync script and workflow here, with history; runs daily from here
      (`TILE_SYNC_HERE`, first run 16 Oct: 96/96 tiles). Old copy removed.
- [ ] The demo tracker's source here, with history (`git subtree`), and
      demo.chsnz.co.nz deployed from here until step 4 retires it
- [ ] Archive `chs-equipment` and `cmchs-staff-schedule` once nothing deploys
      from them

### 2. One shell
- [x] The hub becomes the shell, with a router (`apps/hub/src/router.js`): the
      path picks the section, a section's own #/ routes work as before, moving
      between sections never reloads. One Firebase start-up (`shared/firebase.js`).
      The kit is loaded once for every section; the hub pages' own look is
      scoped to `.hub-page` (`apps/hub/vite.config.js`) until the two are merged.
- Move in the React sections, one at a time (recipe below):
  - [x] Asks (`/asks/`), 16 Oct
  - [x] People and Manage (they were already hub pages)
  - [x] Project tracker (`/projects/`), 16 Oct. Phones now get a bottom tab
        bar instead of header tabs; on laptops the header drops the name by
        the avatar, then its search, so the five tabs fit.
  - [x] Admin settings (`/admin/`), 16 Oct. Its screens are the schedule's, so
        the schedule's stylesheets come too, scoped to the Admin section
        (`apps/hub/vite.config.js`) until they are folded into the kit.
  - [x] Staff schedule (`/schedule/`), 17 Oct. Keeps react-router inside, so
        /schedule/my and every reminder link land as before; its views are a
        row under the shell's header, and its own header, account menu,
        phone tab bar, update banner and version tag are gone. The precache
        is now just what the start page loads (`scripts/build.mjs`).
- [x] One Settings area, 17 Oct (`/settings/`, `apps/settings`): You (appearance,
      start page, your notifications), Admin (people and access, everyone's
      notifications: Admin settings' two tabs) and Sections (the schedule's and the
      tracker's own settings screens; Maintenance's is a link until step 3).
      `/admin/`, `/schedule/settings` and `/projects/#/settings` forward there.
      Not moved, on purpose: hub Manage (news people post, and the request and
      feedback queues: content, not settings) and HR access, which stays on each
      person's profile. People switch their own reminders under the Firestore
      rules' `isOwnNotifications` (published 17 Oct).
- [x] Ctrl+K searches every section, 17 Oct (`apps/hub/src/Palette.jsx`): pages and
      views, tools, people, jobs and asks, opening in place. Each section adds its
      results through a `search-source.js`. The tracker's own job search, with
      its filters, stays on its search button.

### 3. Rebuild the plain tools on the kit
Each tool keeps its data and logic modules as they are; its page is rebuilt
in React on the kit (`src/`) and moves into the shell (the step 2 recipe).
`npm run dev` without a .env gets a local stand-in for its data.
- [x] Service Orders (`/service-orders/`), 17 Oct. The kit gained `useConfirm`
      (no more `confirm()`), a danger button and `.data-table` (cards on a phone).
- [x] Maintenance (`/maintenance/`), 17 Oct. Its PM types moved into Settings →
      Maintenance; the build-version stamp went (the shell handles versions).
- [x] SimproSync (`/simprosync/`), 17 Oct: moved in with its working code as it is
      and restyled onto the kit, not rewritten, because it writes to and deletes
      from Simpro and can't be tested here. The shell's update reload now waits
      for a run to finish (`working()` in `shared/register-sw.js`).
- [x] Ansur (`/ansurtopdf/`), 17 Oct: moved in with its working code as it is and
      restyled onto the kit, like SimproSync. The PDFs are unchanged (pdf-lib draws them).
- [ ] Later: SimproSync and Ansur as real components, once they can be tested
      against Simpro and real Ansur files

### 4. Rebuild the demo tracker
Screen by screen, one responsive layout, on the current Realtime Database
through a small data layer. A parity checklist against the old tracker, then
switch `/demo/` over, tombstone demo.chsnz.co.nz, staff re-enable
notifications at the new address.

How (17 Oct, from a map of the old tracker's 15,900 lines):
- **Built at `/equipment/`** (`apps/equipment`), a section of the one app,
  while `/demo/` and demo.chsnz.co.nz carry on unchanged. Not in the header
  until it replaces `/demo/`.
- **Same data, same shape.** Both run side by side until the switch, so the
  new screens read and save exactly as the old one does: the whole `/data`
  document (equipment, history, loanMeta, `_v`) with its ETag guard and the
  same merge (`_mergeEquipmentAndHistory`), plus `upcomingLoans`,
  `loanDocs`, `kitGroups`, `retired`, `accountManagers`, `auditLog`. One
  safer difference: no unconditional save when the ETag can't be fetched.
- **Read-only first.** Screens arrive read-only, then gain their writes one
  feature at a time, each checked against the old tracker on the same data.
- **What it fixes, and what waits.** The 1 MB page (792 KB of script parsed on
  every open) goes. The big cost doesn't: every open downloads the whole
  database document, every change re-downloads it everywhere, and every save
  uploads it whole. That is the data's shape, fixed by step 5 (one Firestore
  record per item), not by new screens.
- **Kept as they are for now**: the admin password (plain text in `/config`,
  checked in the browser; step 5's roles replace it), EmailJS for loan emails,
  Simpro calls through the proxy, `nzNow()`'s fixed +12:00 timestamps.

- [x] Data layer (pass, reads, ETag save and merge, live updates), dev stand-in,
      17 Oct (`apps/equipment/src/db.js`, `store.jsx`, the rules in `model.js`, tested)
- [x] Equipment, read-only, 17 Oct: list, status filters, search, an item's record and history
      Checked against the old tracker on the live data, 17 Oct: its header's five counts
      (427 · 79 on loan · 36 booked · 312 available · 33 overdue) match exactly.
      Found: 8 items with a space typed into On Loan To / start / end, counted as
      overdue to no one by both (100027, 100039, 100109, 100126, 100226, 100269,
      100289, 100307): a data fix in the old tracker, not a rule to change here.
- [x] Equipment records and Manage, 19 Oct (`Items.jsx`, `Manage.jsx`, `TestReports.jsx`; rules tested): add and
      edit an item (a second item with the same asset number refused, which the old one allowed),
      retire (why, notes) and bring back, delete (admin password); Sold / Retired with export; kits
      (trigger devices offer their accessories when picked for a loan); import (CSV or Excel, admin
      password) and export (CSV, Excel with history); Simpro job creation on/off and loans with no
      job (make one); test mode (the old switch and people); a loan's test reports. The team is in
      Settings, People and access. Not ported: orphaned-loan recovery (the new save is one guarded
      write, so it can't leave a half-saved loan to recover).
- [x] Loans, read-only, 17 Oct: the old Loans tab's sections and rules (`loanSections`, tested),
      search, account manager, overdue only and its sorts
- [x] Overview, 17 Oct: the phone's Today and Overview in one responsive page (`Overview.jsx`,
      `overviewOf` tested). Yours when the sign-in matches someone on the tracker's team, then
      everyone's; the new tracker's landing view. Overdue is the Loans tab's rule (never a long-term
      loan), where the old phone counted a long-term loan past its end date as overdue.
- [x] First writes, 19 Oct (`LoanActions.jsx`, `store.jsx`, rules tested): testing and
      dispatch (Skip / Tested / Dispatched, with when, and undo) to `/loanMeta`; Extend for a
      loan (devices in `/data` by its ETag, a form under the old key moved, the due-soon
      reminder cleared) and for a booking; an audit entry each (`source: 'hub'`). Fixed on the
      way: the new tracker now lays `/loanMeta` over `/data`'s copy as the old one does (it read
      only the copy, so could show stale account managers and testing); the old `+12:00`
      timestamps show at the clock time written (read as moments they're an hour late in summer).
- [x] Return items and long term, 19 Oct (`returnEquipment`, `activateBookings`, `returnFollowUps`,
      tested): devices cleared with a Return entry each; any booking whose start has come takes the
      devices now free in the same save (as the old activateUpcomingLoans); an emptied loan has its
      Simpro job closed with a note and its form removed, a part-returned one its form trimmed.
      Make long-term (a BatchID adopted first if it has none, Simpro job closed with the devices
      listed, loanMeta and form marked, end dates cleared) and Return to active.
- [x] Edit and delete, 19 Oct: a loan's or booking's details (blanks keep what they had, as the
      old one; an end before the start refused), the account manager to loanMeta, contact, notes,
      shipping and demo type to its form, a new demo type added to the list; a booking whose start
      has come takes its free devices. Delete after the admin password (kept until step 5): devices
      cleared as returned with a Return entry each, the form removed; a booking cancelled.
- [x] New loan, the loan form, add items, transfer, copy, 19 Oct (`NewLoan.jsx`, `LoanForm.jsx`,
      `AssetPicker.jsx`; `planNewLoan`, `planAddItems`, `planTransfer`, `formDoc` tested): the old form's
      fields and checks (a duplicate loan refused); free devices go on, ones still out are booked to
      follow, a later non-clashing booking keeps its claim; the loan form (editable, print, email
      through the old EmailJS template) finishes a new loan with the email and the Simpro job (made
      only while /simproConfig.createJobs is on, as the old). Add items (to a loan or a booking),
      Transfer (to a loan or booking, notes on both Simpro jobs, or to a new loan), Copy. One
      deliberate fix: test mode no longer puts a made-up job number over a real one.
- [x] Scan, 19 Oct (`Scan.jsx`, `Scanner.jsx`; `countEquipment` tested): Return (scanned devices returned
      together, as Return items), Count (counted and back, or counted where it is; the count overview),
      Stocktake (each scan counted and returned, behind the admin password); typed, a scanner gun, or
      the camera (BarcodeDetector, else jsQR). New loan is its own view (above). Stored text (history
      notes, Counted, audit, Simpro notes, the printed form) uses the old DD/MM/YYYY (`oldDate`), so
      both trackers' records match and the old count overview still reads Counted.
- [x] Calendar and History, 19 Oct (`Calendar.jsx`, `History.jsx`; `calendarRows`, `filterHistory`,
      `filterAudit` tested): loans and bookings as bars across 4 to 26 weeks (coloured by state, not
      per loan as the old one), a bar opens its loan; device history searchable and by kind, a loan's
      entry opening its form; the audit log (newest 300), by kind and searchable.
- [x] Import / export (with Manage, above)
- [x] Retired, kits, test reports, account managers (in Settings), settings, test mode (with Manage, above)
- [ ] Links in (?newLoan from the project tracker, ?return / ?extend / ?reassign)
- [ ] Parity check, then switch `/demo/` over

### 5. One identity and data platform
- [x] Demo tracker reminders go to phones turned on at internal.chsnz.co.nz
      (`chs-equipment ce95adb`)
- [ ] The tracker's `accountManagers` folded into `users`; admin password
      replaced by roles
- [ ] Tracker data moved to Firestore; one Firebase project; one backup
- [ ] Notifications from one place, linking into the app

### 6. Clean-up
- [ ] Remove the duplicates (two Firebase start-ups, `chs-tokens.css` copy,
      the hub's own `.btn/.badge/.card`, per-tool update handling, the hub's,
      Asks' and the tracker's own dialogs: the kit has `Dialog` now)
- [ ] Documentation: README, CLAUDE.md, PROJECT-CONTEXT.md

## Moving a tool into the shell (step 2 recipe)

Asks was the first; do the next the same way.

1. **A section entry**: `apps/<tool>/src/section.jsx` exports a component with
   the tool's own stylesheet import, its providers and its `App`. No header,
   fonts, kit stylesheet, service worker or update handling: the shell has them.
2. **Register it**: `SECTIONS` in `apps/hub/src/router.js`, a lazy import and a
   line in `apps/hub/src/App.jsx`, a tab in `Header.jsx` (and the phone icon).
3. **Deep links**: add its prefix to `SECTIONS` in `apps/hub/public/404.html` and
   to the NavigationRoute `allowlist` in `apps/hub/src/sw.js`.
4. **Drop the separate build**: its entry in `scripts/build.mjs` `APPS` (and any
   precache line), its `index.html`, `main.jsx`, `vite.config.js`, `public/`, and the
   `dev`/`build` scripts in its `package.json` (keep `test`).
5. **Check**: its classes are all from the kit or its own stylesheet (the hub's are
   scoped away); links in and out don't reload; old links and notifications still
   land; light and dark; a phone; `npm run build` and every test.

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

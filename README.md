# CMCHS Internal Hub

**internal.chsnz.co.nz**: one Microsoft sign-in, then every internal tool. Hosted on GitHub Pages; every merge to `main` deploys (changes go in by pull request: see `CLAUDE.md`).

**Install it as an app** (Chrome: install icon in the address bar; iOS Safari: Share → Add to Home Screen) and every tool opens *inside* that app window — no address bar, no bouncing out to a browser tab. That only works for pages on this domain, which is why tools move in here rather than staying on their own subdomain.

| Path | What | Source |
|---|---|---|
| `/` | Hub home: tools by category, search, announcements | `apps/hub` (Vite + React) |
| `/schedule/` | Staff schedule: team week, my week, day, leave, on call, out of town, and its own Settings for admins | `apps/schedule` (React, react-router inside), a section of the hub's one app (no build of its own) |
| `/simprosync/` | SimproSync: updates and adds customer assets in Simpro from an asset list (admins, and anyone given Simpro access) | `apps/simprosync`, a section of the hub's one app (no build of its own). Moved in with its working code as it is (`app.js` drives `page.html` by id; `mount.js` starts it), restyled onto the kit; a component rewrite waits until it can be tested against Simpro |
| `/maintenance/` | Maintenance schedule: planned maintenance by site, what's due and what's done. Its PM types are in Settings → Maintenance | `apps/maintenance`: its data and import modules, and `src/` the page (React on the kit), a section of the hub's one app (no build of its own) |
| `/pdf-editor/` | PDF Editor: open a PDF, click its text to retype it (the old words are covered, in the page's own background colour, and the new ones set over them in a matching size, weight and colour; drag text, a picture or any area (the Move area tool) to move it, drag a corner to resize it), open several PDFs at once (a tab each) and copy and paste pages, objects, pictures and text between them, rearrange / rotate / delete / add pages, put text, pictures, shapes, highlights and whiteout on a page, save a new PDF. All on the device, nothing uploaded | `apps/pdf-editor`, a section of the hub's one app (no build of its own). pdf.js draws only the pages on screen; edits are a record (`model.js`) written into the PDF once, on Save (`save.js`, pdf-lib). Tests: `npm test -w apps/pdf-editor` |
| `/ansurtopdf/` | Ansur PVT Report Builder: Fluke Ansur records (.mtr) into PDF reports, on the device, and attached to a Simpro job | `apps/ansurtopdf`, a section of the hub's one app (no build of its own). Moved in with its working code as it is (`builder.js` and `simpro.js` drive `page.html` by id; pdf-lib in `vendor/`), restyled onto the kit; a component rewrite waits until it can be checked against real records |
| `/equipment/` | The demo equipment tracker ("Demo" in the header): equipment, loans, bookings, scanning, the calendar, history, retired items, kits, Simpro. Replaced the old one on 19 Oct 2026 | `apps/equipment`, a section of the hub's one app, on the old tracker's Realtime Database (`src/db.js`) until step 5 (`STEP-5-PLAN.md`) |
| `/settings/` | Settings, from the header's gear. Everyone: appearance (light, dark, match the device; where the hub opens) and their own notifications. Admins: people and access (teams, roles, Simpro access, demo tracker roles) everyone's notifications, background jobs and the activity log, behind the admin password. And each section's own: the staff schedule's (locations, Excel import) and the project tracker's. `/admin/`, `/schedule/settings` and `/projects/#/settings` forward there. | `apps/settings` (React, react-router inside), a section of the hub's one app; its pages are `apps/admin`'s, the schedule's and the tracker's own screens |
| `/service-orders/` | Service Orders: the service order spreadsheet, with the parser built in | `apps/service-orders`: its data and parsing modules, and `src/` the page (React on the kit), a section of the hub's one app (no build of its own) |
| `/demo/` | Forwards to `/equipment/`, keeping old links working (`?return=`, `?extend=`, `?reassign=`, `?newLoan=`) | `apps/demo` |
| `/projects/` | Project tracker: the project team's job register and weekly timeline in one, with demo equipment availability, an archive and Ctrl+K search | `apps/projects`, a section of the hub's one app (no build of its own) |
| `/knowledge/` | Knowledge base (under Service): part numbers and the other names for them, faults and fixes, what is installed where (counts by site, department, model, any column), and what was done on past jobs, with one search box | `apps/knowledge`, a section of the hub's one app (no build of its own). Rules: published 9 Nov 2026 |
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

- **Who sees what** (`firestore.rules`, `canSeeAsk`): only the people involved — the asker, the people and teams it was sent to, whoever picked it up, was @mentioned or copied in (`people`). Nobody else, admins included (until 20 Oct 2026 admins saw every ask). `askStats` mirrors the counts with no text, for the Company page, which everyone sees; its rule checks it matches the ask exactly.
- **Data**: `asks/{id}` with `comments` and `photos` subcollections, and `askStats/{id}`. Fields are described in `apps/asks/src/model.js`.
- **Push for each change**: the browser sends the ask's id to the Apps Script in `backend/apps-script/proxy` (action `notifyAsk`; the same script that sends the hub's other pushes — Asks doesn't use Simpro). It reads the ask back, checks the change is the caller's and new, and pushes to the people concerned; anyone with no phone set up gets an email once `RESEND_API_KEY` and `RESEND_FROM` are in its Script Properties.
- **8:30am weekday summary**: `.github/workflows/asks-summary.yml` runs `apps/asks/scripts/summary.mjs` (push, or email with the `RESEND_*` Actions secrets). Switch people off in Settings → Everyone's notifications (or they switch themselves off in Settings → Your notifications).
- `npm run dev` (the hub) without a `.env` runs Asks at `/asks/` on a local stand-in with made-up people; add `?as=mike` (or jess, sam, lee) to be someone else. `npm test -w apps/asks` checks who sees and owns what, the counts and the summary.

### Knowledge base

`/knowledge/` (`apps/knowledge`), under Service. Four lists, each its own Firestore collection of small flat documents: **articles** (`kbArticles`: a quirk, fault or fix, with tags and the part numbers it mentions), **parts** (`kbParts`: part number, name, the other names people use, the models it fits, a diagram link), **installed devices** (`kbDevices`: site, department, model, serial, software version, and every other column of the asset list kept as `extra`, so "SpO2 type" or "WiFi" can be searched and counted) and **past jobs** (`kbJobs`: from a Simpro export). Everyone signed in reads. Admins and anyone given the **Knowledge** switch in Settings → People and access (`users/{uid}.kbEditor`, set by an admin only) add, change, remove and import (`canEditKb` in `rules/firestore.rules`, tested in `rules/tests/kb-rules.test.mjs`).

- **Search** is on the device, over what is loaded (`src/model.js`): every word of the question must be in the record, filler like "how many" and "in" is ignored, and a part number matches however it is typed (AB-123, ab123, "ab 123") or by any of its other names. Each record stores a lower-case `search` string, so nothing is built at open and there is no server or AI. For devices the page shows the count and a "Count by" panel (site, department, model, version or any imported column); clicking a value adds it to the search. "How many N17 in Waikato CCU" is `N17 waikato ccu`.
- **Import** (admins and editors): **Word guides** (.docx, several at once; `src/docx.js`), or a parts list, an asset list or past jobs (.xlsx or .csv, headings found by name with `mapHeaders`, one record per row; the same part, job or device again replaces itself). A customer's asset workbook with no Site column takes the file's name as the site (editable in the dialog) and each sheet's name as a `Sheet` column; sheets named Retired, Sold or Disposed are skipped. Nothing is read from Simpro: past jobs come from an export a person makes and uploads. Keep exports out of git (customer details); the data lives in Firestore behind the rules.
- **Parts and repair-history CSVs** (`enrichPart`, `enrichJob` in `src/model.js`): columns beyond the fields become "Label: value" lines in the notes, so they are searchable and shown, with no rules change. A part keeps Status, Replaced by / Replaces (linked to the catalogue), Note (shown as a warning), Category, Typical faults, Seen, Used on jobs; a "pn variants seen" column becomes other names (a mistyped number finds the part); `keywords` and `search_text` are not copied (the synonym list does that). A job takes `fault_summary` as its title, then description and work done (only where the notes don't already say it), the notes, then Type, Stage, Parts named, Serials; `parts_pns` becomes its parts, so a part lists the jobs that used it.
- **Synonyms** (`src/synonyms.js`, from the team's list): a search for "screen" also looks for display, lcd and touchscreen; "vaporizer" for "vaporiser"; "defib" for the D60 and AED. Each group has **same** terms (found by each other) and **narrower** ones (found by the general word only, so "masimo" does not find every SpO2 board, "epm 12" every ePM, "d60" the D30). The page says "Also matching: …" under the box. To add a group, add a line to the file; making them editable in the app would need a rules change.
- **Word guides** become one article each, titled from the file name: paragraphs, bold, headings (as bold lines), bulleted and numbered steps (Word's own numbering, nested ones indented as "a."), tables (a row a line, cells split with " | ") and links (the address follows the words) are kept; **pictures are not** (they would not fit a Firestore document), and a `[Picture p.3]` marks where each was and on which page (from the page breaks Word recorded, `w:lastRenderedPageBreak`; a file Word never laid out, about a fifth of the first batch, gets plain `[Picture]`). The article ends with "Source file: name.docx". Save each Word file as a PDF with the same name in one SharePoint folder and paste that folder's address in the dialog (the plain address or the `AllItems.aspx?id=…` form; a sharing link `/:f:/` is refused, `fileLink`/`folderLinkProblem`): each article then ends with "Original PDF: <link>" (`sourceLink`) and each `[Picture p.3]` opens that PDF at `#page=3` (whether SharePoint's own viewer honours the page is untested; the browser's PDF viewer does). There is also an optional category. The article's id comes from the file name (`w-<name>`), so importing the same file again replaces it (the dialog says how many). A document over ~18,000 characters is cut at its headings into "(part 2 of 3)" articles. A PDF, an old .doc or a file with only pictures is listed as left out. Read in the browser with jszip (already in the bundle through exceljs), loaded only when a guide is imported. Search ignores `[Picture]` and stores each word once, so a long guide is searchable to its end.
- **Highlighting:** the words that matched are marked in result rows and in an open entry (`highlightRegex`, `splitHits` in `src/model.js`, drawn by `src/Hl.jsx`): amber for a word that was typed, purple for one found because it means the same. A row shows the part of the text around the match when it is not at the start (`snippet`). Words match across dashes and spaces, and a number typed without its dashes finds it with them.
- **Removing several** (editors only): **Select** in the page's buttons shows a tick on each result and a bar with "Select all N found" (everything the current search and tab find, not only the 40 shown), **Clear** and **Remove N**. `src/Bulk.jsx` asks first, says how many of what, offers a JSON copy to keep, and from 20 entries makes the person type "remove". Deletes go in batches of 400 (`removeRecords` in `src/store.js`); the activity log gets one line a kind, with the count. The rules already let editors delete; `rules/tests/kb-rules.test.mjs` checks a batch of 100 and of 400.
- **Body text** is plain text with `**bold**`, "- " bullets, "1. " numbered steps (indent two spaces a level) and http(s) links, drawn as React text (`richBlocks`), never as HTML. A link to an entry: `/knowledge/#/article/<id>` (also `part`, `device`, `job`). Passwords and logins in a guide are searchable by everyone signed in: leave them out of a guide before importing it.
- **Speed:** the section loads only when opened and nothing of it is in the service worker's precache; the device copy (`shared/firestore.js`) means a reopen downloads only what changed. Fine for tens of thousands of short records; beyond that, search on the server instead.
- `npm run dev` without a `.env` runs on made-up entries (`src/sample.js`). `node --test apps/knowledge/tests/*.test.mjs` checks search and synonyms, import (Word, parts, jobs), part-number matching and the body text.
- **Not built yet:** importing PDF files and pulling part numbers and diagrams out of manuals, keeping a guide's pictures, a "suggest a change" button, last-checked reminders, and results in Ctrl+K.

### Settings: one place for every setting

`/settings/` (`apps/settings`), from the header's gear. **You** (anyone): Appearance (light, dark or match the device, and which page this device opens on, `hub:start`) and Your notifications (turn this phone on; your own schedule reminder, Asks summary and demo tracker reminders). **Admin** (admins, behind the admin password): People and access, and Everyone's notifications, described below (their screens are `apps/admin/src/Admin.jsx`); Background jobs (`apps/settings/src/Jobs.jsx`: each timed job's last run, from `jobRuns`); and the Activity log (below). **Sections**: the staff schedule's settings (below), the project tracker's (`apps/projects/src/settings-page.jsx` hosts its screen), and Maintenance's PM types (`apps/maintenance/src/PmTypes.jsx`). Old addresses forward (`movedTo` in `apps/hub/src/router.js`).

**People and access** sets each person's team, role and Simpro access (the shared `users` collection), and their **demo tracker role** (Account manager / Service & Projects), which is `users/{uid}.trackerRole`: having one puts a signed-in person on the tracker's team (step 5A; the old `accountManagers` list is no longer read). `apps/admin/src/tracker.js` sets and clears it; the tracker (`teamFrom` in `model.js`) and the proxy (`trackerTeam_`) read it.

**Everyone's notifications** has a switch per person per tool, plus how many devices each has turned notifications on for (every phone or browser; ones that no longer exist are removed each Monday by `.github/workflows/prune-devices.yml`). Missing means on.
- Staff schedule Thursday reminder: `users/{uid}.notifications.scheduleReminder`; `scripts/remind.mjs` (cmchs-staff-schedule repo) skips anyone with it false.
- Asks 8:30am summary: `users/{uid}.notifications.asksSummary`; `apps/asks/scripts/summary.mjs` skips anyone with it false.
- Demo tracker loan reminders: `users/{uid}.notifications.demoReminders` (the person's own switch too); the Apps Script senders (`backend/apps-script/proxy`, `sendPushToPerson_`) skip anyone with it false. Test sends still go through.

A switch can only stop notifications: getting them at all needs the person to turn them on on their own phone, which the hub home offers on phones until that phone is on (`apps/hub/src/PushPrompt.jsx`), as does Settings → Your notifications. People can turn their own schedule reminder, Asks summary and demo tracker reminders on and off there (`isOwnNotifications` in `rules/firestore.rules`); admins can set any of them in Everyone's notifications.

One device registration covers every tool. Demo reminders go to the phones turned on here (`users/{uid}.fcmTokens`), sent by the Simpro proxy through the staff schedule's Firebase project with links into `/equipment/` ("HUB PUSH" in `backend/apps-script/proxy/Code.js`). Someone with no phone here still gets them on phones set up at demo.chsnz.co.nz, shown in Everyone's notifications as "(old demo app)". This needs the proxy's service account granted *Firebase Cloud Messaging API Admin* and *Cloud Datastore Viewer* in the staff schedule's Google Cloud project; `checkHubPush()` in the Apps Script editor says whether it is.

**Adding notifications to a new tool:** don't add another "turn on" step. Send to the same `users/{uid}.fcmTokens` through the staff schedule's Firebase project (as `apps/schedule/scripts/remind.mjs` and `apps/asks/scripts/summary.mjs` do), with a `data.url` into the tool; add its switch as a column on Settings → Everyone's notifications (and, if people may set it themselves, to Your notifications and `isOwnNotifications` in `rules/firestore.rules`); and if a tap should open somewhere other than `/schedule/`, check `notificationclick` in `apps/hub/src/sw.js` (it opens the tool named by the URL's first path segment).

**Staff schedule settings** (locations and the Excel import) are the schedule's own screen (`apps/schedule/src/pages/Settings.jsx`) at `/settings/schedule`, behind the same admin role and password. `/schedule/settings` and old `/admin/#locations` and `#excel` links forward there. **The Activity log** is its own page, Settings → Admin → Activity log (`/settings/activity`, `apps/settings/src/ActivityLog.jsx`), because it is the whole hub's log, not the schedule's; the old `#activity` links (`/settings/schedule#activity`, `/schedule/settings#activity`, `/admin/#activity`) forward there.

### /demo/ forwards to /equipment/

Until 19 Oct 2026 `/demo/` ran the old tracker (fetched from chs-equipment and adapted by `embed.js`). Now `apps/demo/build.mjs` writes a page that forwards an address carrying an old link (`?return=`, `?extend=`, `?reassign=`, `?newLoan=`, `?open=`, `?tab=`) to `/equipment/` with the same query and hash, and the new tracker reads the old addresses. A bare `/demo/` shows "This demo tracker has been retired" (11 Nov 2026), so an old copy of the app left on a phone is noticed. demo.chsnz.co.nz is a separate page in chs-equipment and still forwards everything. To go back: restore `apps/demo/build.mjs` and `embed.js` from git history, and chs-equipment's `index.html` from its tag `old-tracker-final`.

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
3. Open a pull request to `main` (see `CLAUDE.md`); merging deploys it.

**Moving a tool's address:** add the old path to `MOVED` in `apps/hub/public/404.html` so bookmarks forward (e.g. `/order-parser/` → `/service-orders/`).

## Activity log: who did what, when

One log for the whole hub (Firestore `activity`, written by `shared/activity.js`). Every tool adds a line when
someone changes something ("Waikato: moved the job later", "Loan for Hutt extended", "Marked an ask done"), and
when they sign in or out. Admins read it on **Settings → Admin → Activity log** (filter by tool, person
or words; download as CSV). Nothing in it can be edited or deleted, not even by an admin (the rules). Every night
at 3am the backup script copies the new lines to Google Drive, folder **CMCHS Hub Activity Log Backups**: a
spreadsheet a month and a JSON file a night (`backend/apps-script/backup`, `activityBackup_`). Drive keeps it for
good; the other backups keep a year.

**A new tool, or a new way to change data, must log it:**

```js
import { logActivity } from '../../../shared/activity.js'
await saveThing(...)                              // the change worked...
logActivity(null, 'Added a PM for Hutt (First PM)') // ...then say what happened, in words
```

- The tool is read from the page's address; pass `{ app: 'oncall' }` as a third argument to override it, and add a new tool's
  address and name to `APP_LABELS` in `shared/activity-core.js` (and `ACTIVITY_TOOLS` in the backup script).
- **Say what was done, not private content.** Admins read the log and it is copied to Drive. Asks log "Marked an ask done",
  never its title; project comments log "Commented on <job>", never the words. No pay, health, emergency contacts, keys or passwords.
- Log once per action, not per keystroke or tick (a checklist logs "Imported 40 devices", not every tick: each device keeps who ticked it and when).
- It never blocks the action: a failure (offline, rules not published) only means that line is lost. Call it after the write succeeds.
- **Simpro changes are logged by the proxy, not the pages** (`simproSyncAudit_` in `backend/apps-script/proxy/Code.js`), so a call made
  straight to it is recorded too: one line per call that wrote ("Simpro: changed job 7: Stage to Complete", "attached a file to
  job 7", "refused by Simpro" when it was). Job and site numbers and field names only. Shown under the tool SimproSync, whichever
  tool made the call. Tested in `apps/hub/tests/simpro-access.test.mjs` and, against the real rules, `rules/tests/simpro-audit-rules.test.mjs`.
  The proxy also refuses a job update whose Stage isn't one of Simpro's four, whose Status isn't a number, or whose Notes aren't text
  (50,000 characters at most), and an attachment marked public.

## CHS Test Bench (`/testbench/`)

The electrical-safety and performance test app (AS/NZS 3551, ESA612 and ProSim over USB), moved in 2 Nov 2026 from the
SharePoint file `ServiceCHS Test Bench.html`. Chrome or Edge on a laptop (Web Serial and the folder picker need it).

**Tabs:** Test Bench, Saved reports, Orders and **Customers** (11 Nov 2026: the old New equipment page, `/new-equipment/`, which now forwards to
`/testbench/?tab=customers`): pick a customer, set its asset list and reports folder links (Edit links), record assets that are not in the asset
list yet, and see which units have been tested.

- **The bench is its own page**, `apps/testbench/bench/index.html` (copied to `/bench-app/` by `scripts/build.mjs`), shown in a
  frame by `apps/testbench/src/section.jsx` under the hub's header. It stays exactly as built: tests in progress and finished
  tests are kept in each laptop's browser (IndexedDB `chs-test-bench`), templates still come from the SharePoint folder
  (chosen once per laptop and address), results can still go to the SharePoint Results folder. Nothing is shared between laptops
  while testing, so any number can be used at once.
- **Offline:** open it once online; the page and its fonts (kept beside it) are then cached by the service worker.
- **Saved reports** (a tab beside the bench): every file the bench saves (PDF, results file, Ansur record) is handed up to the hub and
  kept on that laptop (IndexedDB `chs-bench-reports`, `reports.js`) with the test's customer, serial, model and time, until someone
  removes it. The tab sorts them by customer or by day, filters by customer, when, search and "not yet sent", and lets you tick tests
  (or a whole customer or day) and then **download them as one zip** or **attach them to one Simpro job**. Each file remembers which
  job it went to. The bench stays loaded (hidden) behind the tab, so a test in progress and the USB link are not lost.
- **Save and Download.** When a test finishes, **Save** (purple) keeps the PDF report and the Ansur record (.mtr) in Saved reports, with nothing asked; **Download** writes the same two files into a folder chosen each time (or downloads them where the browser can't pick a folder) and does not add them to Saved reports. There is no results-file (.json) button any more; the Ansur record is the file for Simpro and reopens in the bench. In Saved reports the zip and the attach to a job include PDFs and Ansur records by default.
- **Ansur records (.mtr) for every test.** A test saved with only its results file gets an **Ansur record (.mtr) · make** button in Saved
  reports, and with "Ansur records" ticked a zip or an attach to a job includes one for each ticked test that has none. The hub asks the
  bench (behind the tab) to build it from the run inside the results file (`chs-bench:build-mtr` / `chs-bench:mtr` messages), then keeps
  it with the test's other files. Results files from before 2 Nov 2026 (version 1) have no test data and can't be converted.
- **Send to Simpro** goes through the Apps Script proxy (same as Ansur: admins or people with Simpro access). Files always go into an
  outbox on the laptop first (`outbox.js`) and leave it only once Simpro has them, so with no connection they wait and go by
  themselves when the laptop is online and signed in. Saving the same report twice for a job sends one.
- **The hub's copy is the master** (since 2 Nov 2026; the file says HUB-MASTER): change `apps/testbench/bench/index.html` here, run
  `npm test --prefix apps/testbench`, commit and push, and retire the SharePoint file so nobody edits a stale copy. Laptops get
  the new version the next time they open it online; an open tab keeps the old one until reloaded. (`scripts/update-bench.mjs
  "<file>" --force` puts a different bench file in, swapping its Google fonts for the local ones and adding the `offerToHub` hook.)
- **Template groups:** the Run a test page groups templates under headings (Anaesthesia, Monitoring, Defibrillation, Power supplies,
  Other). A template's group is set on the Templates page (the box under its description); without one it is worked out from its name.
- **Each engineer arranges the Run a test page** (`Arrange templates`): drag a template (or use the arrows and the group list) to move it, give it a highlight colour and text size, rename or reorder groups, set a page-wide text size, and list the models a template covers (e.g. Patient Monitor: ePM, uMEC, N-Series, V-Series, V200, V500, V700, VMAX). The search box above the tiles finds a template by its name, description, group or those models (N1 finds Patient Monitor; `N-Series` matches N1, N12…, `V5*` is a wildcard). The layout is the user's own (IndexedDB key `layout`); **Publish as team layout** writes `_Run a test layout.json` into the shared Templates folder (the loader ignores leading-underscore files), which is the starting point for anyone who has not changed that item themselves. Templates are never edited by this. A `highlight: true` in a template file is purple unless the user picks otherwise.
- **"Test this device" links** (`apps/testbench/src/device-link.js`): `https://internal.chsnz.co.nz/testbench/?model=…&serial=…&manufacturer=…&asset=…&custasset=…&ward=…&site=…` (optional `&template=` names a template). The hub reads it once, takes it out of the address bar and sends it to the bench (`chs-bench:open-device`); the bench picks the one template that fits the model (`Layout.bestFor`: a word with a digit such as D30 or N12 must match a template's name, models or "Models covered"), picks it, and fills in the details; with no single fit it fills the search box instead. A test in progress is never replaced. The link goes in each customer asset list as the first column of every table, "Test this device", shown as a purple button: double-click `Add test links.cmd` (in `apps/testbench/tools/`, also in SharePoint\CHS Test Bench\Tools) and choose the workbook, or run `add-test-link-column.ps1` (Excel inserts the column, so nothing else in the workbook moves; a copy goes to an `Old` folder first; run again to replace an older version). The bench itself does not write the column. Only device facts go in links, never names or secrets.
- **Firefox / no folder picker:** the build publishes `apps/testbench/templates/` at `/bench-app/templates/` (with `index.json`), and the bench loads them read-only when the browser has no `showDirectoryPicker`. SharePoint stays the master: after changing a template there run `node apps/testbench/tools/sync-templates.mjs`, then commit and push. Instrument steps still need Web Serial (Chrome or Edge).
- **Computers** is a group too (Class I and Class II computers / IT equipment). The two templates are made by
  `apps/testbench/tools/make-computer-templates.mjs` into `apps/testbench/templates/`; copy those files into the SharePoint `Templates`
  folder to use them (the folder, not this repo, is where the bench reads templates from). Their limits and what is still to confirm are in
  the generator's comments and the template descriptions.
- **Notes for anyone changing the bench:** `apps/testbench/docs/` has `esa612-protocol-notes.md` (what the real ESA612 and ProSim accept and
  refuse: read it before touching the serial driver), `bench-notes.md` (code map, data formats, the traps that have already bitten) and
  `change-log.md` (the 2 Nov 2026 features in detail).
- **The ESA612 connects by itself.** Pressing Start auto sequence (or This test only) connects any USB device the browser already knows;
  each one says whether it is an ESA612 or a ProSim, so no port is picked by hand. The first time on a laptop the browser asks once
  (it lists only the USB serial devices) and then remembers. A test with ESA612 steps also reconnects known devices when it begins.
- **A failed test in the auto sequence** (stop-on-fail is on by default) asks what to do: **Re-test** that step at once, **Continue to next
  test**, or **Stop sequence**. The failing readings are shown in the prompt.
- **Readings finish early.** Each ESA612 measurement waits up to its settle time (2 s mains, 3 s earth resistance, 4 s leakage, 5 s
  insulation) but records as soon as the reading has stopped moving: 3 or more readings over 1 s (1.5 s for insulation) within 2 %
  of each other, or a small fixed step near zero. The standard sets no minimum time; the settle time is the longest it waits.
- **Details from a customer spreadsheet.** On the start screen, **Choose spreadsheet…** opens a customer's equipment spreadsheet from the
  synced SharePoint folder (an .xlsx with one row per device and headers such as Serial Number, Device Model, CHS Asset Number,
  Ward/Location; every sheet with a "Serial Number" header is read, one per site or IT list, and Retired Assets is skipped). When the serial
  number (or an asset number) is typed or scanned it is looked up by itself (when the box is left, or after a pause), the template's details are
  filled from that row, and a box under them says **Found in the asset list** (sheet and row), or in red **Not found**, or in red that a number
  belongs to several devices. If the device is found but the list lacks details in its **red (mandatory) columns** (a header in red text, per
  sheet) they are listed in red; nothing is typed in or written back here (the bench only reads the workbook; `XlsxLite.write` is kept but
  unused). The customer is the file name, changeable on the bar; the browser remembers the file and **Read again** picks up edits. The mapping
  is `Sheet.colForField` in `apps/testbench/bench/index.html`.
- **Orders close themselves** when their Simpro job is marked **Complete** (or Archived), in Simpro or from Saved reports → Update the
  job: the hub looks at each open order's job when it opens with Simpro access. **Close order** / **Reopen** still work by hand.
- **Other devices in this test** (start screen, under the device's details): a set tested together, such as a monitor with its dock
  and handle, gets **one report**. **+ Another device in this test** adds a line (serial number, model, asset #); each is looked up in
  the asset list by itself (Found / Not found, with **Add to the asset list…** inside the hub). They are kept on the test (`run.devices`),
  listed as Device 2, 3… in the report header and the Ansur record, editable under **Device details**, and kept for a rerun; **Next
  device** keeps their models with the numbers blank. Shared, every serial number goes in the one `serial` field joined by " + "
  (the main device first), so New equipment counts the test for each device and Saved reports finds the report by any of them.
  The files are named with every serial, comma separated: "AA3F46248926, AA3D58264234 - N1 Handle 10.11.2026.pdf".
- **Start-screen defaults:** an empty Manufacturer starts as Mindray, Testing company as CHS, and Testing engineer as the engineer
  signed in to the hub (remembered on the laptop for offline use). The asset list still fills in its own values over them.
- **Not found? Add to the asset list…** (under the red Not found box, inside the hub): a form with the device's details filled in from the bench (serial, manufacturer, model, CHS asset number, ward; device type and description from another device of the same model in the list; Site ID from the sheet picked) records it as a **pending row** for the customer on the Customers tab (Firestore `pendingAssets`), to be pasted under the asset list's last row or sent through Simpro Asset Sync. Nothing is written into the workbook (writing into the synced file was tried and didn't sync). The customer is the one this file was added to before on this laptop, else the only Customers-tab customer whose name matches the report's customer or the file name, else chosen in the form. A serial already pending isn't added twice; offline, the row waits on the laptop. Bench and hub talk by `chs-bench:pending-customers` / `add-pending` / `pending-reply`; the hub side is `apps/testbench/src/newequip/from-bench.js`.
- **Saving gives both files, and asks where.** The summary's **Save PDF + Ansur file** saves the PDF report and the Ansur record (.mtr)
  together (a test opened from an Ansur record gets the PDF only), in a folder chosen each time (the picker opens where it was last; browsers
  that can't choose a folder download both). Saved reports' **Save to a folder…** does the same for the ticked tests: each gets its PDF and
  its Ansur record, made on the spot by the bench from the results file or the other file when one is missing (so attaching to a Simpro job
  sends both too).
- **A device is one customer, and a test is one test.** In Saved reports every test of a serial number shows under that serial's latest customer,
  and files with the same test start time saved under two names (a serial, model or customer corrected) are one test: saving replaces the older
  copy of the same kind, and any already stored show as one (removing the test removes the older copies).
- **Templates for the Mindray monitors and defibrillators** (4 Nov 2026, in `apps/testbench/templates/` and the SharePoint Templates folder): R700 / R12, TM80, PM-60,
  VS8 / VS9, VS-600 / VS-900 (one template, two models), Exergen, eleven modules (sidestream CO2, AG + O2, NMT+, NMT / BIS / BeneLink, rSO2, C.O.,
  CCO / SvO2, CO2 + O2, EEG, IBP, PiCCO), and the BeneHeart D1 (Pro / Public) and C / S series AED. Where each came from, the limits chosen and what
  wasn't checked against a manual is in `apps/testbench/docs/change-log.md`.
- **Print from Saved reports:** tick tests, then **Print** (one print dialog for all their reports) or **Print as booklet** (two pages to each side of a landscape sheet, in fold order; print on both sides, flipping on the short edge).
- **Templates for the Masimo monitors and the N1 set** (10 Nov 2026, made by `apps/testbench/tools/make-masimo-n1-templates.mjs` from the CHS
  Ansur records): Masimo Rad-97, Radical-7, Root and Rad-G (Promed), and the Mindray N1 with its N1 TDS and N1 Handle as one set. A template can
  name its **manufacturer** (Templates page, next to the models; the Masimo ones say Masimo), which fills an empty Manufacturer box instead of Mindray.
- **Previous tests are shared.** Inside the hub, each finished test is also kept in Firestore (`benchTests`: one small line per test;
  `benchTestData`: the whole test as one JSON string, about 50-100 KB, no step photos), so every engineer sees everyone's tests under
  Previous tests ("Shared by …"); opening one fetches it onto that PC. The PDF and the Ansur record (.mtr) aren't stored: the bench
  rebuilds them from the test. The hub does the Firestore side (`apps/testbench/src/section.jsx`, `bench-tests*.js`) and talks to the
  bench by `postMessage` (`chs-bench:run`, `…:shared-list`, `…:get-run`, `…:delete-run`). Engineers, Management, Application and admins read; the engineer
  who shared a test, or an admin, changes or removes it (**Remove for everyone**; **Just this PC** keeps the shared copy). Offline, the
  write waits in Firestore's device copy and goes when the hub is next online. Needs the rules in `rules/firestore.rules` published.
- **The device is powered to charge after the electrical tests.** When the auto sequence finishes (and when a test is finished), the
  bench switches mains on to the device from the ESA612 outlet (the same as **Power the device**), reads the current and says what it
  draws, with a warning if it is almost nothing. Not when an electrical safety test failed, the test was stopped, or the ESA612
  isn't connected; the setting is on the Devices page ("Power the device … so it charges"). **Test another device** switches it off.
- **Test another device** (end of a test) goes straight to the next device on the same template, keeping the details except the serial number.
  The **checklist answers carry over too**: on plain checklist steps, the Pass and N/A answers of the last device are filled in when the next
  test starts (the tester changes what differs, and a toast says how many were kept). A **Fail**, typed readings (battery volts…), ESA612
  measurements, ProSim steps and skipped steps do not carry; neither does anything if another template is picked.
- Tests: `npm test --prefix apps/testbench` (Simpro calls, the outbox, and that the page still has its local fonts and hook).

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
  - **New tools** (`tool-news.js`): when a tool appears in `tools.json`, News shows "New tool: <name>" to anyone who can post, with a ready-made Tool updates draft (what it does, where to find it, its address) to check and post, or **Don't announce**. A post made from it carries `toolId`, so the tool isn't offered again; "Don't announce" is kept for everyone in `settings/toolNews` (kept on that device only until its rule is published). The tools there on 11 Nov 2026 (`KNOWN_TOOLS`) are never offered.
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

## Test copy: the whole hub with made-up staff

To try a change as different people before it goes live, without touching live data or anyone's account. Sign-in and Firestore run in the Firebase emulators on your computer, with the real `rules/firestore.rules`, under a made-up project (`demo-cmchs`) that can't reach the live one.

```
npm run emulators        # terminal 1: starts the emulators (needs Java) and fills them with test data; leave it running
npm run dev:emulators    # terminal 2: the hub at http://localhost:5173 against them
```

The sign-in page then lists the test staff (`shared/test-accounts.js`): an admin, HR, two engineers, sales, applications, and someone with no team yet. Each opens the hub as that person, so you can check what they see and can change. The data (`scripts/emulator-seed.mjs`): this week's schedule, news, asks, the project tracker's sample jobs and the demo tracker's sample equipment (its data source set to Firestore). Stopping the emulators throws it all away; `npm run emulators:seed` resets it while they run. The emulators' own view of the data is at http://127.0.0.1:4000.

A brief for testing it as each person (for Cowork or anyone): [TESTING.md](TESTING.md).

Not in the test copy, because they only exist live: pushes, emails, the Apps Script proxy (Simpro, the demo tracker's database pass and team list), and Microsoft sign-in. The admin password lock opens by itself there. A real build never includes any of this (`.env.emulators` is read only by `dev:emulators`).

### Checking the live-only parts

After a change to pushes, Simpro or the proxy, someone signed in on the live site runs the part that changed. Each takes a minute.

| Check | Do this | Expect |
|---|---|---|
| Ask push | Send a test ask to a colleague who has notifications on | Asks says "Notified 1 person on 1 phone"; their phone shows "New ask from …"; tapping it opens the ask |
| Comment push | Comment on that ask with @their name | "Notified 1 person"; their phone shows your comment |
| News push | Post a news item with "Notify everyone" ticked | Phones with notifications on show it |
| Test notification | Demo tracker → Manage → test notification, to yourself | Your phone shows "Test notification" (Service & Projects only) |
| Demo reminders | Next weekday 8am | Due-back and starting-soon reminders arrive once, not twice |
| Simpro job | Return a demo loan that has a Simpro job | The job's stage becomes Complete in Simpro |
| SimproSync | Run a small sheet with one changed field | The plan shows 1 update; Apply changes it in Simpro |
| Ansur upload | Upload one report to a test job | The PDF appears on the job in Simpro |
| Proxy refuses strangers | `curl -s -L -H "Content-Type: text/plain" -d '{"action":"testPush"}' <proxy /exec URL>` | `{"success":false,"error":"Sign in to use this."}` |

If one fails, note the exact message Asks or the tool shows; the proxy's own log is in the Apps Script editor, Executions.

## Deploy setup (one-time)
- **Secrets:** Settings → Secrets and variables → Actions: the `VITE_*` values from `.env.example`, same values as the cmchs-staff-schedule repo. `VITE_FIREBASE_VAPID_KEY` is the one to watch — an empty value doesn't fail, it quietly falls back to a default key and mints working push tokens, which all rotate the day the real key is added. Set it before anyone enrols for notifications.
- **Pages:** Settings → Pages → Source: **GitHub Actions**; Custom domain `internal.chsnz.co.nz`; Enforce HTTPS.
- **DNS:** CNAME `internal` → `cmchsgit.github.io`.
- **Firebase:** console → Authentication → Settings → Authorized domains → add `internal.chsnz.co.nz`.

## Design
`design/` is the original design handoff (`design/HANDOFF.md`), the v2 home page (`design/CMCHS Internal Hub v2.dc.html`, `design/UPGRADE-v2.md`) and prototypes. Reference only, not shipped. Colours, type and spacing come from the Connected Healthcare Systems design system in `shared/tokens/`.

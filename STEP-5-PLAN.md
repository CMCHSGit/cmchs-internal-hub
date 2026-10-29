# Step 5: one identity and data platform — the plan

Written 19 Oct 2026 for Peter to pick up (Jonathan agreed step 4 finishes
first, then all of step 5). Read `INTEGRATION-PLAN.md` first; this expands its
step 5. Tick items here as they land, with the commit.

## Cutover runbook (written 29 Oct 2026, from re-reading the code; nothing here has been run on live data)

Everything that says **you** needs Jonathan's console access (Firebase, Google Cloud, GitHub, Apps Script).
Claude sessions must not run the migration against live data, move the switch, publish rules or change live
Firestore without his yes in the chat. Counts only in anything pasted back: never names or addresses.

### Decide first (three things the plan didn't settle)
1. **Freezing the old database breaks the team screens.** `rules/database.rules.json` with `.write: false` also
   stops Manage → Team in the tracker (`addMember`, `saveMember`, `removeMember`) and Settings' per-person demo
   reminders switch (`tracker.update`): both still write `/accountManagers` there (5A isn't finished;
   `setMemberRole` survives, the hub record is what counts). Recommended: freeze with that one path left open
   until 5A lands, then freeze fully:
   `{"rules":{".read":"auth != null && auth.token.staff === true",".write":false,"accountManagers":{".write":"auth != null && auth.token.staff === true"}}}`
   (a child rule may allow what its parent denies). It is not put in `rules/database.rules.json` yet, so the repo
   keeps matching what is published.
2. **When to freeze.** The plan says straight after read-only is turned off. Recommended instead: **after the
   next-morning checks pass (steps 11–13)**. "Back to the old database" only works while the old database still
   takes writes; once frozen, going back means re-publishing the old rules first.
3. **Which hour.** After the 08:00 reminders have run and away from the 03:00 backup: about 10:00–11:00 on a
   weekday. Nobody should be making loans, and no Simpro job being created (the proxy writes job numbers back to
   whichever side the switch says, so one landing mid-copy would be missed).

### Before the quiet hour (any day before; none of it changes what people see)
1. **You, Firebase console → staff schedule project → Firestore → Rules:** paste the whole of `rules/firestore.rules`
   (never a part) and Publish. It adds the tracker's collections, `settings/equipmentCutover`, `trackerRole` and
   `trackerTester`, `notifications.demoReminders`, `tileLocations` (29 Oct), and the Checklists changes that are
   already waiting (`chs-equipment/TODO.md`). Check: Equipment still loads and Manage → Data source says "old
   Realtime Database". Back: Rules → history → publish the earlier version.
2. **You, Google Cloud → IAM, staff schedule project:** give the proxy's service account (the chs-equipment one, the
   `client_email` of the key in Script Properties) **Cloud Datastore User**; it has only Viewer now. Without it the
   proxy's Firestore writes are logged ("Firestore write failed") and dropped: job numbers aren't written back and
   every reminder repeats on every run. Nothing exercises it until the switch moves, so check the role is listed.
   The nightly backup's account needs only Viewer (it has it).
3. **You, Settings → People and access:** set everyone's tracker role (and the testers). Until then the hard-coded
   `SERVICE_TEAM` fallback decides.
4. **You, two service-account keys** (Firebase console → Project settings → Service accounts → Generate new private
   key): the staff schedule project's and chs-equipment's. Save them **outside the repo**; delete them afterwards.
5. **You, dry run** (reads only): `cd backend/tracker-migration && npm install`, then with `HUB_SA` and `CHS_SA` set to
   the two key paths, `node migrate.mjs --from live`. Expect: no "WARNING: n items have no asset number" (give them
   one in the tracker first); nothing after "NOT KNOWN" (a path the migration has never seen: stop and tell Claude);
   "Documents to write" about items + history + loans + kits + 1; counts you recognise from the old tracker's
   Overview; "Reminder records" with a count.
6. **You, GitHub → Actions → Tile location sync → Run workflow, target `both`:** fills Firestore's `tileLocations`
   ahead of the day (needs step 1 for the browser to read it; the sync itself isn't held to the rules). The log ends
   "Firestore: N/N tiles written, 0 removed, 0 failed". If it can't read the switch or Firestore, look at the
   `FIREBASE_*` secrets first.

### The cutover (you and Peter, in this order; stop at any failed check)
7. **Manage → Data source → Read-only on.** Check: a second open tracker tab shows the banner within a couple of
   seconds, and saving anything is refused. (Not for hours: nobody can save.)
8. **Migration for real:** `node migrate.mjs --from live --write`. It writes, then reads Firestore back and compares
   (every item, form, meta and booking, history's order, test reports, the audit log, the Equipment view's five
   counts, and that every reminder record arrived). Check: it ends **"Everything matches."** and exits 0. Run it
   again: "Documents to write: 0". Any "DIFF" line: don't switch; tell Claude the labels (not data).
9. **Manage → Data source → Firestore on** (confirm). Every open tracker reloads onto it. Check by hand: Overview's
   numbers equal step 8's; open three loans (one with a form and notes, one booking, one with a test report that
   downloads); in test mode make a loan and return it; Settings → send yourself a test push (it opens the tracker);
   the Equipment list's Tile column still shows places (step 6's, or the old copy). Then **Read-only off** and make
   one real change that you undo. *Going back from here:* Manage → "Back to the old database" (what was made on
   Firestore since isn't in it).
10. **Tile sync by hand:** Actions → Tile location sync → Run, target `auto`. Its log line "Tracker data source:
    firestore; writing to: firestore" shows it follows the switch.

### Next morning (before freezing the old database)
11. **Backup:** the 03:00 run's log says "(from Firestore)", and `checkTrackerJsonBackup()` (backup editor) lists the
    same counts.
12. **Proxy:** Apps Script → Executions after 08:00: `sendDemoReminders` and `sendReturnReminders` ran, with no
    "Firestore write failed" and no "Cutover switch not read"; `equipmentReminders` in Firestore has records. A new
    Simpro job number lands on its loan (Loans → open it).
13. **Project tracker:** Settings → Demo pool's connection card reads the tracker (it follows the switch; never yet
    checked against live data).
14. Only now **freeze the old database** (decisions 1 and 2), published in the Firebase console → chs-equipment →
    Realtime Database → Rules. Then 5C waits a week of clean running and Jonathan's yes.

### Going back
- Before step 14: Manage → "Back to the old database". What was made on Firestore since is not in the old one
  (re-enter it from the audit log; copying it back is not built).
- After step 14: first re-publish the earlier old-database rules (writes back to staff), then the button.
- The Firestore rules and the IAM grant can stay either way.

### Checked on 29 Oct (no live credentials)
- `npm test -w apps/equipment` (92, including the proxy and the backup following the switch);
  `rules/tests/equipment-rules.test.mjs` on the emulator (63); the Tile sync tests (`backend/tile-sync`, 10).
- The migration on the Firestore emulator with the dev sample plus invented reminder records and an unknown path:
  dry run, write, a second run that writes 0, `--check` "Everything matches", the unknown path named.
- Not run: `--from live` (no keys), the proxy or the backup against live Firestore, `rules/tests/equipment-layer.test.mjs`
  (needs its own esbuild checkout; untouched since it last passed).

### Stale or contradicted (found 29 Oct)
- **Tile locations** (What's left, item 3) said the new tracker doesn't read them. It did, from the old database;
  fixed, and it now follows the switch.
- **Reminder records.** `migrate.mjs` and 5B said the proxy's sent-reminder records (`demoReminders`,
  `stuckLoanReminders`, `returnDueSoonReminders`) "stay with it". The proxy reads and writes them in Firestore's
  `equipmentReminders` once the switch says so, so without a copy every loan already reminded would be reminded
  again once. `migrate.mjs` now copies them and checks that they arrived.
- **`tileLocations`** was reported by the migration as "NOT KNOWN"; it is now listed as left (Tile sync writes it).
- **"Set the old Realtime Database read-only"** (step 2 below, and 5B) is contradicted by the team screens that
  still write `/accountManagers` (decision 1).
- Manage → Data source's own four-step list leaves out the rules, the IAM grant and Tile sync. The unticked 5B item
  "Everything else moved to Firestore" is built in every part (proxy, backup, project feed, Tile sync); tick it
  once the switch has moved.
- 5D's table still shows the pushes opening `/demo/…`; they open `/equipment/…` now.
- `CLAUDE.md` and `README.md` here still describe `/demo/` as the old tracker built in from `chs-equipment`
  ("change the tracker there"); it only forwards to `/equipment/` now.

## What's left (handover, 19 Oct evening)

Built and pushed so far: roles in place of the admin password (5A), the cutover switch and the
tracker on either database (5B), the proxy following the switch (@47, reminders open their loan,
a personal demo reminders switch) and the nightly backup following it (`backup-fs.test.mjs`).
Everything sits on the old database until the switch is moved. What's left, in order:

### 1. Jonathan's steps (need access Claude doesn't have)
- [ ] Publish `rules/firestore.rules` in the Firebase console (staff schedule project). It adds
      `settings/equipmentCutover`, `trackerRole`/`trackerTester`, `notifications.demoReminders`.
- [ ] Give the proxy's service account **Cloud Datastore User** in the staff schedule's Google Cloud
      project (it only has read today). The backup's account already has Viewer, which is enough.
- [ ] Migration dry run: `cd backend/tracker-migration && npm install`, then with `HUB_SA` and
      `CHS_SA` pointing at the two keys, `node migrate.mjs --from live`. Look at the counts.
- [ ] Set everyone's tracker role (and the testers) in Settings → People and access.

### 2. The cutover (Jonathan and Peter, a quiet hour)
- [ ] Manage → Data source: **Read-only on** (every open tracker shows the banner).
- [ ] `node migrate.mjs --from live --write` (it checks itself after; `--check` re-runs only that).
- [ ] **Firestore on**. Open a few loans and check them by hand (the migration's check did the counts); make a
      test loan in test mode and return it; send yourself a test push from Settings.
- [ ] **Read-only off**. Then set the old Realtime Database read-only (`rules/database.rules.json`:
      `.write: false`, pasted in the console).
- [ ] Next morning: the backup's log says "(from Firestore)" (`checkTrackerJsonBackup()` shows the
      counts), the proxy's reminders ran (Apps Script executions), a new Simpro job number landed
      on its loan.
- Going back: Manage → "Back to the old database". Changes made on Firestore since are not in it.

### 3. Code still to write (Peter's Claude)
- [x] **Tile locations** (29 Oct). The new tracker already read `/tileLocations` from the old database
      (the Equipment list's Tile column and the item's record); it now also shows when the Tile was last
      seen ("Seen 3h ago", worked out from the Tile's own timestamp), and `readTiles` in `db.js` reads
      Firestore `tileLocations/{tileNo}` once the switch says `firestore` (the old copy if Firestore has none yet).
      `tile_sync.py` follows the switch (`hub_firestore.py`; a manual run's `target` choice `both`
      fills Firestore ahead of the cutover) and needs **no new secret**: it uses the staff schedule's
      `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` the Thursday reminder already has.
      Rules (staff read, nobody writes from a browser) tested in `equipment-rules.test.mjs`.
      **Needs publishing:** `rules/firestore.rules` (the `tileLocations` block; until then Firestore reads of it are
      denied and the tracker falls back to the old copy). Not yet run against the live Tile account or Firestore.
- [ ] **5A, the team out of `accountManagers`:** the tracker (`store.jsx`'s team via `teamFrom`,
      `memberFor`), the proxy (`Code.js` reminders, `sendTestPush_`, `pruneDeadTokens_`,
      `SERVICE_TEAM_OPERATORS` ~410) and `apps/admin/src/tracker.js` read `users` only. Then
      `Admin.jsx`'s `setTrackerRole` stops writing the old list, `model.js`'s `SERVICE_TEAM` fallback
      goes, and 5D's `accountManagers.fcmTokens` fallback goes. Only once every role is set (step 1).
- [x] **Backup file names vs. the migration:** the backup saves report files as `<key>--<id>.txt` with
      `\ / : * ? " < > |` turned into `_`; `migrate.mjs --reports` looks for the raw name. Make it try
      both, so a restore from Drive finds every file.
- [ ] **5C, once Firestore has run cleanly for a week, and only with Jonathan's yes:** a final JSON
      export of the old database kept; delete `/config.adminPassword`; remove the `rtdbToken` proxy
      action, `CHS_KEY` and the old-database paths from `db.js` (`readOld`, the `rtdb` side of the
      switch), the backup's old-database reads and the proxy's (`fetchFirebaseJson` etc. become
      Firestore only); archive the `chs-equipment` Firebase database. `chs-equipment/sw.js` stays
      (old phones still get reminders through it) until no phone uses it.
- [ ] Tick this file and `INTEGRATION-PLAN.md` step 5 as each lands; then `PROJECT-CONTEXT.md` and
      `CLAUDE.md` (both repos) say where the tracker's data is.
- Each change: `npm test` in every app, `npm run build`, the served page checked; Apps Script via
  `backend/README.md` (push, then `deploy -i`, then the live `/exec`).

### 4. Outside step 5 (INTEGRATION-PLAN.md)
- [ ] The staff schedule's Excel sync job and scripts into this repo; after two Thursdays of its
      reminder running from here (from 22 Oct), schedule.chsnz.co.nz off with a tombstone service worker.
- [ ] "The demo tracker's source here with `git subtree`": no longer needed (it was rebuilt here);
      untick or strike it.
- [ ] Archive the `chs-equipment` and `cmchs-staff-schedule` repos once nothing deploys from them
      (demo.chsnz.co.nz's forward page and `sw.js` still do).
- [ ] Step 6: the duplicates listed there, the hourly timer in `deploy.yml` (no longer needed), docs.

## What done looks like

- **One person record.** Everything about a person is on `users/{uid}` in the
  staff schedule's Firestore: team, hub role, demo tracker role, phones. The
  tracker's own team list (`accountManagers` in its Realtime Database) is gone.
- **No shared passwords.** The demo tracker's admin password (plain text in
  `/config.adminPassword`) is replaced by the hub's roles, and deleted.
- **The tracker's data in Firestore**, one document per item and per loan,
  saved with transactions. Its Realtime Database is frozen read-only, then archived.
- **One Firebase project** (the staff schedule's), **one backup**, and
  **notifications from one place**, every one opening the right screen in the app.

## Order, and what can start now

Decision 2 in the plan: the tracker's data moves only after the new tracker
(`/equipment/`) has replaced the old one (`/demo/`). Step 4's last part (links
in, the parity check, the switch) is being finished now. So:

| Part | Can start | Touches live data? |
|---|---|---|
| 5A Roles in place of the admin password; the team into `users` | Design and rules now; the switch-over after step 4 | Yes, at the end |
| 5B Tracker data to Firestore | Schema, rules, tests, migration script, new data layer **now**, as new files nothing uses yet | Only at cutover |
| 5C One project, one backup | After 5B's cutover | Yes |
| 5D Notifications from one place | Audit now; changes after 5A | Yes |

**While step 4 finishes, don't edit** `apps/equipment/src/*` (except new
files), the old tracker (`chs-equipment/index.html`), or the proxy's demo
tracker code. New work goes in new files, not wired in until cutover.

## Where the tracker's data lives today

Realtime Database `chs-equipment-default-rtdb.asia-southeast1` (project
`chs-equipment`), reached with a pass from the proxy (`rtdbToken`):

| Path | What | Written by | Read by |
|---|---|---|---|
| `/data` | `equipment[]`, `history[]`, `loanMeta`, `_v`: one document, saved whole with an ETag | both trackers | both trackers, proxy reminders, backup, project tracker feed |
| `/loanMeta/{key}` | per loan: account manager, long term, tested/dispatched/no test | both trackers | both trackers |
| `/loanDocs/{key}` | the loan form: details, rows, notes, shipping, `simproJobId` | trackers, **the proxy** (writes `simproJobId` back) | trackers, proxy reminders |
| `/upcomingLoans/{id}` | bookings waiting on devices | trackers | trackers, proxy reminders, project tracker feed |
| `/accountManagers[]` | the team: name, email, role, `fcmTokens`, `notify` | Settings (People and access), old tracker | proxy reminders, trackers |
| `/auditLog/{id}`, `/retired[]`, `/kitGroups`, `/customDemoTypes`, `/simproConfig`, `/config` | as named | trackers | trackers, backup |
| `/testReports/{key}/{id}` + `/testReportFiles/…` | test report metadata + the files as base64 (up to 8 MB) | trackers | trackers |
| `/returnDueSoonReminders/{key}` | which due-soon pushes were sent | proxy | proxy |

Code that reads or writes it: `apps/equipment/src/db.js` and `store.jsx` (the
new tracker), `apps/admin/src/tracker.js` (Settings and the project tracker's
demo feed, `apps/projects/src/feed.js`), `backend/apps-script/proxy/Code.js`
(reminders, Simpro, `rtdbToken`), `backend/apps-script/backup/Code.js`,
`backend/tile-sync/` (Tile locations), and the old tracker until the switch.

Keys to know: a loan is keyed by its `BatchID` (`batch_<ms>`, `testbatch_…`
in test mode); loans from before BatchIDs by `loandoc_` + the encoded
`customer|||endDate`. Stored text uses DD/MM/YYYY (`oldDate` in `model.js`);
timestamps are NZ clock time marked `+12:00` all year (`nzNow`).

## 5A Roles in place of the admin password; the team into `users`

- [x] (19 Oct: Settings writes `users.trackerRole` first, the old list after; the tracker's team is `teamFrom`
      the old list with hub roles laid over and hub-only people added) `users/{uid}` gains `trackerRole` (`'am'` | `'service'`), and each person's
      demo reminders switch is `notifications.demoReminders` (bool, beside the
      schedule's and Asks' switches, which people already set for themselves;
      this was `trackerNotify`). Settings → People and access already sets the tracker role
      (`apps/admin/src/Admin.jsx`, `setTrackerRole`): make it write `users` too,
      and keep `accountManagers` in step (written from `users`) until nothing reads it.
- [x] One permission check (`can(user, 'equipment.admin')`, hub role `admin`), 19 Oct: in use. Admins
      confirm, anyone else is told it's for admins; the old admin password is no longer asked for.
      `shared/can.js` (tests: `apps/hub/tests/can.test.mjs`);
      used where the new tracker asks for the admin password today: `checkAdmin`
      in `store.jsx`, called from `AdminDialog` (`Items.jsx`), `DeleteDialog`
      (`LoanActions.jsx`), Scan's stocktake, Manage (import, Simpro on, test
      mode, retired delete). An admin just confirms; anyone else doesn't see the button.
- [x] (19 Oct: `can(profile, 'equipment.testMode')` in App.jsx and Manage.jsx) Test mode's two people (`Peter Lin`, `Jonathan Nasrun`, hard-coded in
      `App.jsx`, `Manage.jsx` and `model.js`'s `SERVICE_TEAM`) become a role or setting.
      Decided: `users.trackerTester` (admins set it; the rules already stop
      anyone else, tested), checked by `can(profile, 'equipment.testMode')`.
      `SERVICE_TEAM` is the fallback role for whoever has none: it goes once
      everyone's `trackerRole` is set (the proxy has the same list,
      `SERVICE_TEAM_OPERATORS`).
- [ ] Everything reading `accountManagers` reads `users` instead: the new tracker
      (`store.jsx` `managers`, `memberFor`), the proxy (`Code.js`: reminders around
      lines 339–1260, `sendTestPush_`, `pruneDeadTokens_`), `tracker.js`.
- [x] Firestore rules: only an admin sets `trackerRole` (the person and HR can't);
      people set their own `notifications.demoReminders`. Tested in
      `rules/tests/equipment-rules.test.mjs`. Not yet published.
- [ ] After the switch, and **only with Jonathan's yes**: delete `/config.adminPassword`
      (it's also in the nightly JSON backup in Drive; that folder must stay private).

## 5B The tracker's data to Firestore

The shape. Jonathan decided the open questions on 19 Oct: bookings are loans
with a booked status; retired items keep their own list, exactly as now; test
report files stay in the database (no Cloud Storage), downloaded from the app;
cutover as soon as it's ready.

- `equipment/{id}`: one document per item, the fields as now (`ITEM_FIELDS` in
  `model.js`).
- `retiredEquipment/{id}`: the retired list, its own collection, the same fields
  plus `RetiredDate`, `RetiredReason`, `RetiredNotes` (as `/retired` today).
- `loans/{batchId}`: one per loan, `loanMeta` and `loanDocs` merged: customer,
  location, dates, account manager, long term, island, job and demo type,
  readiness (`tested`, `testedAt`, …), the form (`rows`, `notes`, `shipping`,
  `contactNumber`), `simproJobId`, `simproClosedAt`, and `status`
  (`active` | `scheduled` | `booked` | `closed`). Bookings (`upcomingLoans` today)
  are loans with `status: 'booked'` and a `waitingFor` list of the devices still
  out elsewhere; a loan partly out and partly waiting has both its devices and
  `waitingFor` (today's same-BatchID pairing of `/data` and `/upcomingLoans`).
- `equipmentHistory/{id}`: one per entry, as now (a top-level collection, so History
  can list and search across every device).
- `equipmentAudit/{id}`, `equipmentKits/{id}`, `settings/equipment`
  (`simproConfig`, demo types).
- Test reports stay in the database, no Cloud Storage: metadata in
  `loans/{id}/reports/{id}`, the file in `loans/{id}/reports/{id}/chunks/{n}`. A
  Firestore document holds at most 1 MiB, and a report can be up to 8 MB, so the
  base64 is split into chunks of about 900 KB and joined again to download.

Work:
- [x] The schema agreed with Jonathan, 19 Oct (above).
- [x] Firestore rules for it, with emulator tests in `rules/tests/equipment-rules.test.mjs`
      (49 cases). Staff (a finished hub account) read and change it all, as
      today; admins only: deleting an item, a loan or a retired item outright,
      turning Simpro job creation on. Retire and restore may remove an item
      only by moving it to the other list in the same write. History and the
      audit log are never edited. Not yet published (nothing uses them; publish
      before the cutover). On Windows set
      `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:/Users/<you>/.uds`.
      A write carries at most 10 MiB (the emulator: 4 MiB), so a report's
      chunks go four to a batch, after the report document.
- [x] A Firestore data layer beside `db.js`, nothing using it yet:
      `apps/equipment/src/db-firestore.js` (watchTracker, commit, the audit
      log, reports), with the documents' shape in `fs-shape.js`. A loan's
      document keeps loanMeta, loanDocs and the booking whole as `meta`, `form`
      and `booking` (they overlap, and model.js reads all three), with the
      fields above worked out beside them; a loan emptied of all three is
      kept as `closed`, not deleted. Tested: `tests/fs-shape.test.mjs` (the
      state comes back exactly; a change writes only what it touches), and
      `rules/tests/equipment-layer.test.mjs` (the layer against the real
      rules on the emulator, a clash with someone else's change included).
      Moving store.jsx onto it is part of the cutover. The brief: the new
      tracker's rules are already pure functions in `model.js` (`planNewLoan`,
      `returnEquipment`, `activateBookings`, `planTransfer`, `countEquipment`…)
      that take the item list and return the new one: the new layer diffs
      before and after and writes only the changed items and loans in one
      transaction, instead of `store.jsx`'s whole-document `updateData`.
      Live updates by `onSnapshot` replace the `data/_v` watch. `db-local.js`
      (the dev stand-in) gets the same shape (done in db-firestore.js, seeded from db-local.js).
- [x] A migration script: `backend/tracker-migration/migrate.mjs` (see its
      top for how to run it). From the live database (`CHS_SA`) or a nightly
      `Demo-Tracker-*.json` with its report files; into Firestore (`HUB_SA`,
      or the emulator). A dry run unless `--write`; counts only; writes only
      what differs, so a second run writes nothing; then reads it all back and
      checks the lists, every item, form, meta and booking, history's order,
      reports, the audit log and the Equipment view's five counts. Copies the proxy's sent-reminder
      records too (`equipmentReminders`, 29 Oct). Doesn't
      copy `config` (the admin password), `accountManagers` (5A) or
      `tileLocations`, and names any top-level path it doesn't know.
      Tried on the emulator with the dev sample; **not yet run on the real
      data** (needs the two keys, and a look at the dry run's counts).
- [ ] The cutover, planned with Jonathan for a quiet hour: a read-only banner on
      the tracker, final migration, the data layer switched, the counts and a
      few loans checked by hand, the Realtime Database rules set read-only.
      **Built, 19 Oct**: `settings/equipmentCutover` ({ source: 'rtdb' | 'firestore', readOnly }) is
      the switch (Manage → Data source, admins; rules tested). `db.js` sends every read and write to
      the old database or, on Firestore, to `db-paths.js`, which answers the same paths through
      `db-firestore.js`'s `commit()`; `store.jsx`'s `updateData` commits directly. Read-only refuses
      every save, with a banner. Tried end to end on the dev stand-in on both sources (testing,
      extend, return with a booking starting, new loan and its form, test reports, retire/restore,
      count, the audit log). The project tracker's feed (`tracker.js readTracker`) follows it.
- [ ] Everything else moved to Firestore at the same cutover: the proxy's
      reminders and its Simpro write-back of `simproJobId` (`Code.js` ~226, ~1319) **(done 19 Oct, @46:
      the proxy follows the same switch; its reads of the tracker's data, the job-number write-back
      and the sent records go to Firestore once it says so; needs its write access granted first)**,
      the backup **(done 19 Oct, cb29a18)**, Tile sync (see What's left), the project tracker's demo feed **(done)** (`tracker.js`
      `readTracker`, `feed.js`). The proxy needs write access to Firestore
      first (see the 5D audit).

## 5C One Firebase project, one backup

- [ ] After 5B: the `chs-equipment` project's database archived (a final JSON
      export kept), its web app config and the `rtdbToken` proxy action removed,
      `CHS_KEY` gone from `db.js`.
- [x] (19 Oct, cb29a18: both copies follow the switch, turned back into the old tree so migrate.mjs can restore them) The backup (`backend/apps-script/backup/Code.js`): the tracker's
      spreadsheet and JSON copies read Firestore instead (or a scheduled managed
      Firestore export to Cloud Storage), kept a year as now. Check with
      `checkTrackerJsonBackup()`'s successor.
- [ ] demo.chsnz.co.nz is tombstoned in step 4; check nothing still points at the old project.

## 5D Notifications from one place

**Audit, 19 Oct** (`backend/apps-script/proxy/Code.js`). Every demo push goes
through `sendPushToPerson_(am, …)`: to the person's hub phones (`users.fcmTokens`,
found by `accountManagers` email, else name), else their old `accountManagers`
phones; skipped if an admin switched them off (`accountManagers.notify === false`).
Links are written for demo.chsnz.co.nz and turned into `/demo/…` (`hubDemoUrl_`,
`HUB_DEMO_URL`), the old tracker.

| Push | Timer | To | Opens now | Should open |
|---|---|---|---|---|
| Upcoming demo / starting today (`sendDemoReminders`) | daily | Service & Projects (`accountManagers` role, else the two hard-coded names) | `/demo/?mobile=1` (the list) | that loan |
| Stuck booking (`sendStuckLoanReminders`) | every few hours | the booking's AM (by name) | `/demo/?reassign=<booking>` | `/equipment/?reassign=` (step 4 reads it) |
| Due back soon, AM (`sendReturnDueSoonReminder_`) | daily | the loan's AM | `/demo/?return=<token>` | `/equipment/?return=` (step 4 reads it) |
| Due back soon, service team | daily | Service & Projects | `/demo/?mobile=1` | that loan |
| Test push (`sendTestPush_`) | by hand | one person | `/demo/` | `/equipment/` |

The proxy also writes to the tracker's database: its sent markers
(`demoReminders`, `stuckLoanReminders`, `returnDueSoonReminders`), Simpro's
`loanDocs/{key}/simproJobId`, and dead tokens pruned from `accountManagers`.
**Its service account can only read the hub's Firestore** (a note at
`sendHubPush_`): at 5B's cutover it needs write access there (or the job
number goes back through the tracker, which has the caller's sign-in), and
the markers need a home (e.g. `settings/equipmentReminders` or a small
collection). A permissions change: Jonathan's call.

- [ ] Demo reminders (due soon, stuck bookings) already go to hub phones
      (`users.fcmTokens`) with `accountManagers.fcmTokens` as a fallback: drop the
      fallback once 5A is done.
- [x] (19 Oct: `/equipment/` since the switch; the two service-team pushes open their loan with
      `?open=<BatchID>`, which the tracker reads) Every notification opens the new tracker at the right place: `/equipment/#/loans?open=…`
      (step 4's links in add `?return=`, `?extend=`, `?reassign=`). The first
      step is one line once step 4 switches: `HUB_DEMO_URL` to `/equipment/`.
      The two service-team pushes then need a link to their loan, which the
      new tracker would have to read (a `?open=<key>`, not there yet).
- [x] (19 Oct: the switch in Settings → Your notifications; the proxy skips anyone who turned it off,
      except an admin's test push) Each person's demo reminders on or off in Settings → Your notifications,
      like the schedule's (`notifications.demoReminders` from 5A).

## Working agreements (from `CLAUDE.md`)

Pull before you start and before you commit; commit and push to `main` once
verified (`node --check`, the page loads, the served version checked). Rules
are pasted into the Firebase console by someone with access: say so when a
change needs it. Apps Script: `clasp push` doesn't make the proxy live,
`clasp deploy -i …` does (`backend/README.md`). Secrets never in the repo,
commits or chat; logs give counts, never names. Ask Jonathan before anything
people would notice and can't undo (deleting data, changing live rules,
rotating keys, signing people out).

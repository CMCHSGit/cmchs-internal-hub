# Step 5: one identity and data platform — the plan

Written 19 Oct 2026 for Peter to pick up (Jonathan agreed step 4 finishes
first, then all of step 5). Read `INTEGRATION-PLAN.md` first; this expands its
step 5. Tick items here as they land, with the commit.

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

- [ ] `users/{uid}` gains `trackerRole` (`'am'` | `'service'`) and `trackerNotify`
      (bool). Settings → People and access already sets the tracker role
      (`apps/admin/src/Admin.jsx`, `setTrackerRole`): make it write `users` too,
      and keep `accountManagers` in step (written from `users`) until nothing reads it.
- [ ] One permission check (`can(user, 'equipment.admin')`, hub role `admin`),
      used where the new tracker asks for the admin password today: `checkAdmin`
      in `store.jsx`, called from `AdminDialog` (`Items.jsx`), `DeleteDialog`
      (`LoanActions.jsx`), Scan's stocktake, Manage (import, Simpro on, test
      mode, retired delete). An admin just confirms; anyone else doesn't see the button.
- [ ] Test mode's two people (`Peter Lin`, `Jonathan Nasrun`, hard-coded in
      `App.jsx`, `Manage.jsx` and `model.js`'s `SERVICE_TEAM`) become a role or setting.
- [ ] Everything reading `accountManagers` reads `users` instead: the new tracker
      (`store.jsx` `managers`, `memberFor`), the proxy (`Code.js`: reminders around
      lines 339–1260, `sendTestPush_`, `pruneDeadTokens_`), `tracker.js`.
- [ ] Firestore rules: only an admin sets `trackerRole`; tests in `rules/tests/`.
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
- [ ] Firestore rules for it, with emulator tests in `rules/tests/` (same
      pattern as `asks-rules.test.mjs`; on Windows set
      `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:/Users/<you>/.uds`).
- [ ] A Firestore data layer beside `db.js`, nothing using it yet. The new
      tracker's rules are already pure functions in `model.js` (`planNewLoan`,
      `returnEquipment`, `activateBookings`, `planTransfer`, `countEquipment`…)
      that take the item list and return the new one: the new layer diffs
      before and after and writes only the changed items and loans in one
      transaction, instead of `store.jsx`'s whole-document `updateData`.
      Live updates by `onSnapshot` replace the `data/_v` watch. `db-local.js`
      (the dev stand-in) gets the same shape.
- [ ] A migration script (Node, service account, from the live database or the
      nightly JSON backup): idempotent, a dry run that prints counts only (no
      names), and a check that counts match after (today about 427 items; the
      Equipment view's five counts must match exactly).
- [ ] The cutover, planned with Jonathan for a quiet hour: a read-only banner on
      the tracker, final migration, the data layer switched, the counts and a
      few loans checked by hand, the Realtime Database rules set read-only.
- [ ] Everything else moved to Firestore at the same cutover: the proxy's
      reminders and its Simpro write-back of `simproJobId` (`Code.js` ~226, ~1319),
      the backup, Tile sync, the project tracker's demo feed (`tracker.js`
      `readTracker`, `feed.js`).

## 5C One Firebase project, one backup

- [ ] After 5B: the `chs-equipment` project's database archived (a final JSON
      export kept), its web app config and the `rtdbToken` proxy action removed,
      `CHS_KEY` gone from `db.js`.
- [ ] The backup (`backend/apps-script/backup/Code.js`): the tracker's
      spreadsheet and JSON copies read Firestore instead (or a scheduled managed
      Firestore export to Cloud Storage), kept a year as now. Check with
      `checkTrackerJsonBackup()`'s successor.
- [ ] demo.chsnz.co.nz is tombstoned in step 4; check nothing still points at the old project.

## 5D Notifications from one place

- [ ] Demo reminders (due soon, stuck bookings) already go to hub phones
      (`users.fcmTokens`) with `accountManagers.fcmTokens` as a fallback: drop the
      fallback once 5A is done.
- [ ] Every notification opens the new tracker at the right place: `/equipment/#/loans?open=…`
      (step 4's links in add `?return=`, `?extend=`, `?reassign=`).
- [ ] Each person's demo reminders on or off in Settings → Your notifications,
      like the schedule's (`trackerNotify` from 5A).

## Working agreements (from `CLAUDE.md`)

Pull before you start and before you commit; commit and push to `main` once
verified (`node --check`, the page loads, the served version checked). Rules
are pasted into the Firebase console by someone with access: say so when a
change needs it. Apps Script: `clasp push` doesn't make the proxy live,
`clasp deploy -i …` does (`backend/README.md`). Secrets never in the repo,
commits or chat; logs give counts, never names. Ask Jonathan before anything
people would notice and can't undo (deleting data, changing live rules,
rotating keys, signing people out).

# Demo tracker — read this before changing anything here

Claude loads this file when working under `apps/equipment/`. It is the short map; the detail lives in:

- `README.md` (repo root): the `/equipment/` and `/demo/` rows, **Settings** (tracker roles, demo reminders) and
  **Checking the live-only parts** (test push, reminders, Simpro job).
- `STEP-5-PLAN.md` — the move of the tracker's data to Firestore: the cutover runbook (done 4 Nov 2026), the old
  database's paths, the Firestore shape, and **what is still to do (5C)**.
- `INTEGRATION-PLAN.md` — step 4 (the rebuild) and **"Links between tools that must keep working"**.
- `../chs-equipment/PROJECT-CONTEXT.md` — the old tracker's history and traps. The old tracker itself is the git tag
  `old-tracker-final` in `chs-equipment`; never change it.

## What it is

The demo equipment tracker ("Demo" in the hub header), live at `internal.chsnz.co.nz/equipment/`: CHS's demo devices,
loans to hospitals, bookings, scanning (return, count, stocktake), the calendar, history and audit log, retired items,
kits, QR asset labels, Simpro jobs for loans. Used by account managers (often on phones, on site) and Service & Projects.
Rebuilt here as a section of the hub's one app; it replaced the old tracker on **19 Oct 2026**. `/demo/` forwards
every visit here, old links (`?return=`, `?extend=`, `?reassign=`, `?newLoan=`, `?open=`, `?tab=`) with their query and
hash (`apps/demo/build.mjs` writes that page; there is nothing else in `apps/demo`). Nothing should link to `/demo/`.
demo.chsnz.co.nz is the chs-equipment repo's own page and still forwards everything.

## The map

| File | What it owns |
|---|---|
| `src/section.jsx` → `App.jsx` | The section and its views. View and filters live in the hash (`#/loans?am=…`): overview, new, scan, equipment, history, loans, calendar, manage (+ `labels`, not a tab). The Demo tab's badge (`shared/badges.js`). |
| `src/model.js` (~1,600 lines) | **Every rule, pure**: statuses, loan sections, readiness, new loan / add / transfer / return / reassign plans, the loan form (HTML/RTF), import/export, `linkTarget` (old addresses), `teamFrom`. Ported from the old tracker; each rule names its old function (`old: …`). Tested in `tests/model.test.mjs` and friends. |
| `src/store.jsx` | The data in React, every change (`write`, audit entry, `logActivity`), Simpro through the proxy, the loan confirmation email (EmailJS), test push, permissions (`can`). |
| `src/db.js` | Where the data is: reads `settings/equipmentCutover` and sends `read`/`write`/`watch` to the old Realtime Database or to `db-paths.js`. Also `readTiles`. |
| `src/db-paths.js` → `db-firestore.js` → `fs-shape.js` | The old database's paths answered from Firestore; one transaction per change, only the documents that changed; documents ⇄ the shapes `model.js` uses. |
| `src/db-local.js` | Made-up data for `npm run dev` with no `.env` (also the emulator seed's equipment). |
| Screens | `Overview`, `Items`/`BrowseEquipment`/`AssetPicker`, `Loans` + `LoanActions` (every action on a loan), `NewLoan` + `LoanForm`, `AddToLoan`, `Scan` + `Scanner` (camera: `@zxing/library`, `jsqr`), `Calendar`, `History`, `Manage`, `Labels` (lazy, `qrcode-generator`), `TestReports`. Styles in `equipment.css`, components from `shared/ui`. |

Header comments in `db-firestore.js`, `fs-shape.js` and `store.jsx` still say "not used yet" / "both trackers side by
side": **stale**. The tracker has run on Firestore since the cutover and the old tracker is gone.

## Where data lives

- **Firestore, the staff schedule's project** (since 4 Nov 2026; `settings/equipmentCutover.source = 'firestore'`):
  `equipment`, `retiredEquipment`, `loans/{batchId}` (meta + form + booking, with `status`, `waitingFor`, `assetNos`…;
  test reports in `loans/{id}/reports/{id}/chunks/{n}`, ~900 KB chunks), `equipmentHistory`, `equipmentAudit`,
  `equipmentKits`, `settings/equipment` (`simproConfig`, demo types), `tileLocations` (written only by Tile sync),
  `equipmentReminders` (the proxy's). Rules: the tracker block in `rules/firestore.rules`, tested by
  `rules/tests/equipment-rules.test.mjs`. **A push doesn't publish rules** — paste the whole file in the console and say so.
- **Old Realtime Database** (`chs-equipment` project): frozen read-only since 5 Nov. Still in the code as the `rtdb`
  side of the switch ("Back to the old database" in Manage) until 5C removes it. Don't write new code against it.
- **People:** the team is `users/{uid}.trackerRole` (`'am'` | `'service'`, set by admins in Settings → People and
  access, `apps/admin/src/tracker.js`); `trackerTester` for test mode; `notifications.demoReminders` per person.
  `accountManagers` is no longer read (5A).
- **Per device:** localStorage `testMode` (`'1'` = test mode), `dev:equipment-db`, `dev:equipment-cutover`.

Keys and formats: a loan is keyed by its `BatchID` (`batch_<ms>`; `testbatch_<ms>` in test mode); loans from before
BatchIDs by `loandoc_` + the encoded `customer|||endDate` (`legacyLoanDocKey`, `metaKey`). Stored dates in loan
records are DD/MM/YYYY (`oldDate`); timestamps are NZ clock time marked `+12:00` all year (`nzNow`). Keep both as they
are: the proxy, the backup and the project tracker read them.

## Who else reads or writes this data

Change a field and check each of these:

- **Apps Script proxy** (`backend/apps-script/proxy/Code.js`): Simpro job create/update/close, writes `simproJobId`
  back to the loan, demo/stuck/return reminders (pushes open `/equipment/…`), `testPush`, `trackerTeam_`.
  Deploying it is `clasp push` **and** `clasp deploy -i <id>`, then check the live `/exec` (`backend/README.md`).
- **Nightly backup** (`backend/apps-script/backup`), **Tile sync** (`backend/tile-sync`, GitHub Action),
  **migration** (`backend/tracker-migration`, only for the cutover; never run against live data without Jonathan's yes).
- **Project tracker's demo feed**: `apps/projects/src/feed.js` through `apps/admin/src/tracker.js`.
- **Old links that must keep landing** (`linkTarget` in `model.js`, `tests/links.test.mjs`): `?return=`, `?extend=`,
  `?reassign=`, `?newLoan=`, `?tab=`, via `/demo/` or demo.chsnz.co.nz, from old emails, bookmarks and pushes.
- **Project tracker → New loan**: "Create loan form" opens `/demo/?newLoan=1&ref=…` in a pop-up; `NewLoan.jsx` posts
  `{ type: 'chs-demo-loan-created', ref, batchId, … }` back, same origin only. Change both sides together.
- **QR labels** encode `https://internal.chsnz.co.nz/equipment/#/equipment?item=<assetNo>` (`labelUrl`). Labels are
  stuck on devices: never change that address form, only add to what it accepts.

## Rules for changes

- **Rules go in `model.js`, pure, with a test.** Screens and `store.jsx` call them; don't put a rule in a component.
- **Saves are transactions on the documents a change touches** (`db-firestore.js`): when someone else changed one first,
  their version is taken and the rule re-run. Don't add direct `setDoc` calls that bypass that from screens.
- **Test mode** (`testbatch_` loans) and the dev server never tell Simpro or send email/pushes (`simpro()` in
  `store.jsx`). Keep that true for anything new that reaches outside.
- **Permissions** are `can(profile, 'equipment.admin' | 'equipment.testMode')` (`shared/can.js`); the old admin password
  is not asked for anywhere and must not come back.
- **Activity log:** every data change logs one line (`logActivity(..., { app: 'equipment' })`, `shared/activity.js`)
  with counts and actions only — never customer names, asset details or note text — beside the tracker's own audit log.
- **Phones first:** account managers use it on site; check the narrow layout (`useNarrow.js`) and dark mode.
- **5C (removing the old database from the code, deleting `/config.adminPassword`, archiving `chs-equipment`) needs
  Jonathan's yes in the chat.** So do moving the cutover switch and anything else people would notice and can't undo.

## Verify

```bash
npm test -w apps/equipment
```

plus the repo's `npm run build`, `npm test -w apps/schedule`, `npm test -w apps/hub`; for a rules change,
`rules/tests/equipment-rules.test.mjs` on the emulator (`rules/README.md`). `npm run dev` with no `.env` runs on
made-up local data; the test copy (`npm run dev:emulators`, README "Test copy") runs it as different people. Simpro,
pushes and email only exist live — check those with README's **Checking the live-only parts**. After pushing, reload
`/equipment/` on the live site and confirm the change (the app updates itself when idle or reopened).

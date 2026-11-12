# Excel → schedule, automatically (runs on a PC)

Imports the company staff-schedule workbook into the schedule every 5 minutes, so people who still
fill in the Excel show up at internal.chsnz.co.nz/schedule without anyone pressing Import. It reads the
**OneDrive-synced copy** of the workbook on a PC, so it needs no Microsoft (Graph) permission and no IT.
The trade-off: it only runs while that PC is on, signed in, with OneDrive running — when it's off, the
next run catches up.

One direction only: Excel → app. Nothing is written to the Excel.

## What it does, and doesn't

- Same rules as **Admin settings → Excel** (`src/utils/excelPlan.js`): a change in the Excel comes in if
  the app entry hasn't been edited since the last import; an app edit is kept; if both changed, the app
  wins (counted as "kept"). A blank Excel cell does not clear an app entry that was typed in the app or edited there; but when the app still holds exactly what the last import brought in, the Excel clearing it clears it here too (a week sheet made by duplicating an earlier one and then emptied no longer leaves that copy behind).
- It runs unattended, so it only does what Admin → Excel does without being asked: **certain matches
  only** (an Excel name saved on the person, full name, or first name within the same team), and it
  **never adds people**. Names that are ambiguous, close-but-not-certain or not in the app are left out
  and counted in the log — pick them once in Admin → Excel and their Excel name is remembered, so this
  matches them from then on.
- From 2 weeks ago onwards (`weeksBack`), up to the newest sheet.
- A run that would change more than `maxChanges` entries (150) is **refused** and writes nothing, so a
  damaged or wrongly-pasted workbook can't overwrite the schedule wholesale.
- Skips runs where the workbook hasn't changed, apart from an hourly check (people sign in, so a name
  that wasn't in the app may now be).
- Logs counts only, never names: `%USERPROFILE%\.cmchs\excel-import.log`. Runs that change something
  also add a line to the activity log in Admin settings ("Excel import (automatic)").

- **Pasted copies of a week are left out (9 Nov 2026).** A week after the current one whose days for a person are exactly what the Excel says
  for that person in the current week, or in any week between (typed in the sheet, or pasted from it), is treated as a copy, not as that person's entry:
  it isn't brought into the app, and the log says "N future-week entries left out". What the app already holds for those weeks is never changed, and
  once the week is the current one it imports as usual. This only applies to this automatic import (the Admin → Excel screen imports what you pick);
  `"ignoreCopiedWeeks": false` in the config turns it off.
  **A week that is all leave or training is never treated as a copy (13 Nov 2026):** time away often runs for more than a week, so a
  second identical week of "Leave" comes in like any other entry (`allTimeAway`, read the way the Leave calendar reads leave). The app's own "Copy last week" button marks what it copies (`copiedFrom` on the schedule).
  Code: `daysSignature` and `planImport`'s `skipCopiesFrom` in `src/utils/excelPlan.js`, tests `tests/excelCopyGuard.test.mjs`.

Code: `scripts/excel-import.mjs` (the PC side), `scripts/excelImportJob.mjs` (one run, tested in
`tests/excelImportJob.test.mjs`), `src/utils/excelImportOps.js` (what gets written — shared with
Admin → Excel, so both write exactly the same thing).

## Setting it up

1. **A Firebase key for this PC.** Firebase console → the schedule's project → ⚙ Project settings →
   **Service accounts** → **Generate new private key**. Save the file as
   `%USERPROFILE%\.cmchs\firebase-service-account.json` — *not* in OneDrive and never in a repo: it
   can read and change everything in the database. It's separate from the key GitHub uses; to switch
   this off for good, delete the key in that same screen.

2. **The config**, `%USERPROFILE%\.cmchs\excel-import.json`:

   ```json
   {
     "workbook": "C:\\Users\\<you>\\Cass Medical Limited\\Cass & CHS SharePoint - Documents\\CMCHS Files\\Admin\\Cass Admin\\Staff Schedule\\CMCHS Staff Schedule 2024.xlsx",
     "serviceAccount": "C:\\Users\\<you>\\.cmchs\\firebase-service-account.json",
     "weeksBack": 2,
     "maxChanges": 150
   }
   ```

3. **A dry run** from the hub repo (after `npm install`) — shows what it would change, writes nothing:

   ```
   node apps/schedule/scripts/excel-import.mjs
   ```

   The first real import may bring in more than usual; if it's refused for that reason and the dry run
   looked right, run it once by hand with `--apply --max-changes <the number it reported>`.

4. **Schedule it** (every 5 minutes while you're signed in, no window pops up):

   ```
   powershell -ExecutionPolicy Bypass -File apps\schedule\scripts\install-excel-import-task.ps1
   ```

   `-Remove` takes it off again. It shows in Task Scheduler as "CMCHS Excel to schedule import".

## Checking on it

- The log: `%USERPROFILE%\.cmchs\excel-import.log` — "Imported", "Up to date", "REFUSED" or "FAILED"
  with a reason.
- Run once now regardless of the 5-minute timer: `node apps/schedule/scripts/excel-import.mjs --apply --force`.
- The scheduled task runs the script from this repo folder, so `git pull` updates it.

## Writing back to the Excel (app → Excel)

The other direction, so a change made in the hub also shows up in the workbook. It is **off** until the config says
`"writeBack": true`, and it runs straight after the import every 5 minutes (`scripts/excel-sync.mjs` runs both; the
scheduled task runs that).

- **How:** the changes are made in **Excel itself** (`scripts/apply-excel-edits.ps1`, through Excel's automation), on
  the OneDrive copy. So the formatting stays, and people can keep editing the file while it runs. It needs Excel (the
  desktop app) on this PC. If the workbook is already open in your Excel it is changed there; otherwise Excel opens it
  out of sight for a few seconds.
- **What it changes:** a cell where the app has an entry the Excel doesn't match, and the Excel is blank there or still
  says what it said when the import last looked (so nobody has changed it in the Excel since). A day with one place goes
  in both the AM and PM rows; "Starship / Cass Office" splits into AM and PM. The week's comment too.
- **What it never does:** clear a cell, add a person, touch a cell somebody changed in the Excel since the last
  import (the import brings their change into the app instead), or write a day with more than two places in it. It checks
  each cell just before writing it and leaves it if it has changed or holds a formula.
- **Limits:** a run that would change more than `maxCells` (60) cells is refused and writes nothing (cells on a sheet it is starting, below, have their own limit, `maxNewCells`, 1500).
- **Config keys:** `"writeBack": true` and optionally `"maxCells": 60` in the same `excel-import.json`.
- **Whole-day cells are split when the app has two halves (5 Nov 2026).** In the workbook an AM and a PM cell that say the
  same thing are merged into one (`D48:D49`). When the app has a different morning and afternoon, the write-back unmerges
  the cell and writes the two halves, as a person would by hand (`apply-excel-edits.ps1`). This includes a plan that changes
  only one half: before this, writing the merged cell changed both halves, the next plan changed them back, and one person's
  Wednesday to Friday swapped between two values every run for days ("1 of 5 cells written, 4 left", 400+ times in the log).
  A cell that already says what the plan wants counts as written. Only a merge of exactly two cells (two rows, one column) is
  split, and only while it still says what it said when the plan was made; anything else is left alone.
- **Quiet runs are skipped (4 Nov 2026).** A full pass reads every person and every recent week (about a hundred Firestore
  documents), which at every 5 minutes was most of a day's reads on a quiet hub. A run now skips when the workbook is the
  file the last pass left (`excel-export-state.json` beside the config), the last pass didn't ask to be retried (the workbook
  locked, or Excel failed), it was under `"writeBackRecheckMinutes"` (30) ago, and no schedule has changed in the app since
  (one query that reads at most one document). Rules: `scripts/excelExportSkip.mjs`, tests `tests/excelExportSkip.test.mjs`.
  Cost: a change made in the app reaches the Excel on the next 5-minute run as before, but a cell the app and Excel
  disagree on and can't be written (a "partial" run) is retried when something changes or every 30 minutes, not every 5.
  `--force` or a dry run always does the whole pass.
- **OFF since 9 Nov 2026 (`"newWeekSheets": true` in the config turns it on).** It made sheets for weeks people had copied forward or
  filled in by mistake, up to 6 weeks ahead, and people then filled in the wrong weeks. Sheets already made stay. Below is how it works if it is ever turned back on.
- **Next week's sheet is made for you (5 Nov 2026).** People fill the schedule in the hub and nobody makes the week's tab by hand any
  more, so when the app has an entry (a day with a place, or the week's comment) for a week the workbook has no sheet for, the
  write-back starts the sheet and fills it in the same run, the way a person would: a **copy of the newest week's sheet** (so the people
  and their teams, the merged AM/PM cells, the leave / customer / on-call colour rules and the column widths are exactly as they were),
  put at the end of the workbook, its day and comment cells cleared, "- OnCall" taken off the name (the colour is a rule on that word),
  the new Monday in the header (the other days are formulas from it) and a name like `9-Nov` (`Sept` for September; `9-Nov-26` if that
  name is already used by last year's sheet). Then the usual copy writes each person's days and comment onto it.
  - **Only ahead, never a gap in the past:** weeks after the newest sheet, up to 6 weeks past this one, at most 6 sheets in a run; a week
    in between with no entries is made too, so there are no holes. A mistyped date far ahead makes nothing.
  - **Safe if it fails:** if Excel fails part-way, every sheet made in that run is deleted again and nothing is saved. A sheet for that
    Monday that someone made meanwhile (by hand, or under another name) is left alone and filled as it is.
  - **Not done:** people who are in the app but not on the newest sheet are not added (a new starter appears on the sheet when someone
    adds the row by hand, as before); the on-call week is not written to the name cell (the on-call roster is the app's).
  - Code: `src/utils/excelNewWeeks.js` (what to start; tests `tests/excelNewWeeks.test.mjs`), `scripts/excelExportJob.mjs`,
    and `scripts/apply-excel-edits.ps1 -NewSheets` (the Excel side).
- **Try it first:** `node apps/schedule/scripts/excel-export.mjs` is a dry run (add `--show` to list each cell: week, row,
  column, old text, new text, never names). `--apply` writes for real (needs `writeBack`). The dry run also says which new week sheets it would start.
  To try the Excel side on a copy of the workbook, never the live file: `--edits-out e.json --sheets-out s.json` on a dry run, then
  `powershell -File apps/schedule/scripts/apply-excel-edits.ps1 -Workbook <copy.xlsx> -Edits e.json -NewSheets s.json -Result r.json`.
  (Never use `--apply` with a test config: it records in the live app what the Excel now says.)
- **Log:** the same log; lines start "Write-back:". It only logs a run that does something or is refused. Real writes
  also add "Excel write-back (automatic)" to the activity log in Admin settings.
- **After re-running the installer:** `powershell -ExecutionPolicy Bypass -File appsschedulescriptsinstall-excel-import-task.ps1`
  points the task at `excel-sync.mjs`; the import alone still works with `excel-import.mjs`.

## On-call roster → hub and schedule (5 Nov 2026)

The on-call engineer for each week is kept in the Service team's workbook, `Oncall roster.xlsx` (one sheet a year, an engineer a week).
`scripts/oncall-sync.mjs` copies it into both places the app keeps on-call, so nobody types it twice:

- **The hub's On-call roster page** (`oncallHistory`: a document a sheet, what an admin's import on that page writes). Rewritten when the file changes.
- **The schedule's weekly on-call** (`oncall/{Monday}`: who is "Name - OnCall" on the Team week, My week and the home page), from 2 weeks ago to the end of the roster.
  Checked on every run of the file (every `oncallRecheckMinutes`, 60, when the file hasn't changed).

**The roster file wins.** A week where the app says someone else is set to what the file says (so an on-call change made in the app is undone
within the hour: change the file instead, or the app's roster page will be overwritten too). A week the file leaves blank, or names someone who
isn't exactly one person in the app (two with the same first name, "Ana / Bo", a name that isn't a user), is left as it is and counted in the log.
Nothing is ever cleared. The names in the file are matched like this: the same full name, else the same first name when only one person (or only one
Engineer) has it.

- **Setting it up:** add `"oncallRoster": "C:\Users\<you>\Cass Medical Limited\...\Oncall Roster and Schedules\Oncall roster.xlsx"` to `excel-import.json`
  (optional: `"oncallWeeksBack": 2`, `"oncallRecheckMinutes": 60`). Without it nothing runs. `excel-sync.mjs` runs it first, then the import and the copy;
  its failure never stops them.
- **Try it:** `node apps/schedule/scripts/oncall-sync.mjs` is a dry run (weeks to set, to change, left, and "hub roster page: N roster sheets"); `--apply` writes.
- **Log:** the same log, lines start "On-call roster:", counts only. Real writes add "On-call roster sync (automatic)" to the activity log; each run reports to
  Settings → Background jobs ("On-call roster → hub and schedule").
- **The staff schedule Excel is not written** with the on-call week (the "- OnCall" on a name): a new week's sheet starts without it. The Excel import still
  reads that suffix, but only sets a week the app has nobody for, so it can't undo the roster.
- Code: `src/utils/onCallRoster.js` (matching and the plan), `scripts/oncallSyncJob.mjs` (one run, tested in `tests/oncallSync.test.mjs`), `apps/oncall/src/parse.js` (the file's own reader, shared with the roster page).

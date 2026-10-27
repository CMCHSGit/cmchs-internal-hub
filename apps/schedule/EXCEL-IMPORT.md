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
- **What it never does:** clear a cell, add a person or a sheet, touch a cell somebody changed in the Excel since the last
  import (the import brings their change into the app instead), or write a day with more than two places in it. It checks
  each cell just before writing it and leaves it if it has changed or holds a formula.
- **Limits:** a run that would change more than `maxCells` (60) cells is refused and writes nothing.
- **Config keys:** `"writeBack": true` and optionally `"maxCells": 60` in the same `excel-import.json`.
- **Try it first:** `node apps/schedule/scripts/excel-export.mjs` is a dry run (add `--show` to list each cell: week, row,
  column, old text, new text, never names). `--apply` writes for real (needs `writeBack`).
- **Log:** the same log; lines start "Write-back:". It only logs a run that does something or is refused. Real writes
  also add "Excel write-back (automatic)" to the activity log in Admin settings.
- **After re-running the installer:** `powershell -ExecutionPolicy Bypass -File appsschedulescriptsinstall-excel-import-task.ps1`
  points the task at `excel-sync.mjs`; the import alone still works with `excel-import.mjs`.

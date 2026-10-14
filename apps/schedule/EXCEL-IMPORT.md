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
  wins (counted as "kept"). A blank Excel cell never clears an app entry.
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

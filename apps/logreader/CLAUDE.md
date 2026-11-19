# Log Reader (`/logreader/`)

**No menu shortcut yet, on purpose:** reach it at `/logreader/`. When it is ready for everyone, add a `logreader` card to `tools.json` (category Service) and the id to `SERVICE_TOOL_IDS` in `apps/hub/src/tools.js`.

Opens a Mindray device's log export in the browser and lets you search it. **The logs
never leave the tab:** no upload, no Firestore, no localStorage / IndexedDB / cache. They are
customer logs (restricted); keep it that way, and never commit a real log or a
serial number (tests use made-up lines).

| File | What it does |
|---|---|
| `src/tar.js` | Reads a `log.tar` held in memory (ustar, GNU long names, pax). |
| `src/lzo.js` | `.lzo` (lzop) → bytes. Port of a small LZO1X decompressor, checked against a real export; corrupt data throws. |
| `src/zip.js` | Reads a `.zip` and gunzips `.gz` with the browser's own DecompressionStream (stored/deflate, no zip64, no passwords). |
| `src/alarms.js`, `AlarmsTab.jsx` | The Alarms tab: begin/end alarm records in `BackendLog` (priority High/Medium/Low/Prompt/Exclusive, type Technical/Physiological) paired into events, with filters. Shown as the device logs them. |
| `src/lines.js` | Parses `MM/DD/YY HH:MM:SS [thread] LEVEL- message [Src.cpp:12]` (thread optional, may be in brackets) and syslog (`Oct 14 21:32:54 HOST user.debug ...`, year taken from the file's date), merges files, time helpers, CSV cell. Times are "as the device wrote them" (UTC-ms only to avoid DST shifts). 01/01/70 lines are `early` and borrow a neighbour's time. |
| `src/filter.js` | Text / regex / level / time filter with context lines. |
| `src/load.js` | `openFiles` (tar, zip, .gz, nested archives, or loose files → log "families" = a log and its rotations) and `loadFamily` (decompress + parse on first use). |
| `src/profiles.js`, `src/defib.js` | Per-device knowledge: which logs to open first, which lines to mark, which tables to offer. **A new device type = a new file like `defib.js` plus a line in `profiles.js`;** the viewer is shared. |
| `src/LogView.jsx`, `ShockTable.jsx`, `App.jsx` | The page: virtualised timeline, the defibrillator's shock-to-print table, the shell. |

Tests: `npm test -w apps/logreader` (made-up tar / lzo / log lines). The shock table states what the
logs show; it does not claim a cause, and what the "power-off type" numbers mean is unknown.

**Never read:** screenshots, databases, binary data and crash dumps (`*.core*`, `coredump/`): memory images can hold anything. `load.js` `SKIP` lists them; the page says how many were left unopened. The text logs hold patient-record GUIDs (and on the A5 age/sex/height/weight), so the "nothing leaves the tab" rule matters.

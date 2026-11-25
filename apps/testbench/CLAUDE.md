# CHS Test Bench — read this before changing anything here

Claude loads this file when working under `apps/testbench/`. It is the short map; the detail lives in:

- `README.md` (repo root), section **CHS Test Bench** — every user-facing feature, how it behaves today.
- `docs/bench-notes.md` — code map of the bench page, data formats, template conventions, **17 mistakes that already happened**.
- `docs/esa612-protocol-notes.md` — what the real ESA612 and ProSim accept and refuse. **Read it before touching the serial driver.**
- `docs/change-log.md` — the 2 Nov 2026 features and where each Mindray template's limits came from.

## What it is

Electrical-safety and performance testing (AS/NZS 3551) of medical equipment, driving a Fluke ESA612B and ProSim 8 over USB
(Web Serial, FTDI, 115200 8N1). Used by several CHS engineers on laptops, often offline, in Chrome or Edge. Live at
`internal.chsnz.co.nz/testbench/`. Moved into the hub from a SharePoint HTML file on 2 Nov 2026; the hub copy is now the master.

## Two halves that talk by `postMessage`

| Half | Where | What it owns |
|---|---|---|
| **The bench page** | `bench/index.html` (one ~5,000-line file, global objects in one `<script>`), built to `/bench-app/` | Running tests, the ESA612/ProSim driver, templates, autosave, PDF (pdf-lib) and Ansur `.mtr` export/import. Data in the laptop's IndexedDB `chs-test-bench`. Works with no hub, no sign-in, no network. |
| **The hub section** | `src/section.jsx` (React, under the hub header, frames the bench with `allow="serial"`) | Saved reports, **now the bar at the right of the bench, not a tab or a pane** (`Reports.jsx` with `barOnly`): it works on the tests ticked in the bench's Previous tests table (`chs-bench:ticked`, keyed by start time), shows what was sent back in that table (`status`), and limits the table to given devices (`filter`); it hides while a test runs (`chs-bench:state`) (`reports.js`, IndexedDB `chs-bench-reports`), zip download (`zip.js`), Simpro attach via the outbox (`outbox.js`, `simpro-api.js`, `JobPicker.jsx`), shared previous tests (`bench-tests*.js`), Orders (`orders*.js`, `Orders.jsx`), "Test this device" links (`device-link.js`). |

Messages are all `chs-bench:*` (`hello`, `state`, `file`, `run`, `run-data`, `shared-list`, `get-run`, `delete-run`, `deleted`, `build-pdf`/`pdf`,
`build-mtr`/`mtr`, `sheet-state`/`get-sheet`/`sheet-file`, `pending-customers`/`add-pending`/`pending-reply`, `open-device`, `orders`, `model-colours`/`-reply`, `home`). Change both sides together, and search both files for the
name. The bench's hand-off point is `offerToHub()`. The bench stays loaded (hidden) behind the other tabs so a test and the USB link survive.

Also here: **`src/newequip/`** — the **Customers tab** of this section (customer picker and links, asset list read via Microsoft Graph,
recorded/pending assets, hand-off to Simpro Asset Sync). It was the New equipment page; `/new-equipment/` now only forwards to
`/testbench/?tab=customers` (11 Nov 2026). It is being built to replace the bench + Asset Sync + Ansur report builder eventually;
until it does everything, those keep working as they are. Its own map and rules: `src/newequip/CLAUDE.md`.

And the **MAC reader tab** (25 Nov 2026; `?tab=mac`): `src/MacReader.jsx` (camera or a photo, results as editable fields with Copy / Copy all),
`src/macRead.js` (pure, tested: picks the Device ID, WLAN MAC and LAN MAC out of the text, puts right O/0 and I/l/1 and `;` for `:`,
checks the LAN MAC against the Device ID by the asset lists' rule: Device ID without bytes 4 and 5) and `src/ocr.js` (tesseract.js in a
worker, **in the browser: nothing is uploaded**, loaded on first use). It reads nothing into the bench or a record. **Phone to PC:** with a sign-in, every read is sent by itself to the signed-in person's own inbox
(`src/macInbox.js` pure + tested, `macInbox-firebase.js`, Firestore `macInbox/{uid}`: ONE document per person, each scan replaces the last) and the
same tab on their PC shows it live at the top (`src/MacInbox.jsx`: Copy, Copy all, Remove, and a QR code to open the tab on the phone). It stays until they
remove it or scan another. **Copy all** puts just the values on the clipboard, no labels, tab-separated so they paste into one Excel row in the sheet's column order: LAN MAC, WLAN MAC (an empty cell when there isn't one, so Device ID stays in its column), Device ID (`rowsAsValues` in `macRead.js`). No customer, serial or unit is attached to a read; logs "Sent a MAC reading to the PC" (no values). Rules: `macInbox` in
`rules/firestore.rules` (own document, Bench teams only, addresses in the asset lists' shapes), tests `rules/tests/macinbox-rules.test.mjs`.
**Not built:** putting a reading into an asset list, the bench's report or Simpro. The reader's files (worker, three LSTM cores, small English data) are
served from `/ocr/<version>/` (`shared/ocr-assets.js`): `scripts/build.mjs` copies them from `node_modules`, `apps/hub/vite.config.js`
serves them in dev; **never precached, never a CDN** (tesseract.js defaults to jsDelivr). Upgrading tesseract.js = change `OCR_VERSION`
(the build stops if it doesn't match). B/8 and D/0 can't be told apart in a photo: that is why the values are editable. The camera
stops when the tab is left; the bench behind it stays loaded.

## Where data lives

- **Per laptop:** IndexedDB `chs-test-bench` (templates, runs, kv folder handles; **schema bumps must keep `onblocked`/`onversionchange`**),
  `chs-bench-reports`, the outbox, `chs-newequip-handoff`; localStorage `chsBench.prefs`, `chsBench.flow`, `newEquip.customer`.
- **Firestore** (rules in `rules/firestore.rules`): `benchTests` (one line per finished test), `benchTestData` (whole test as one JSON
  string, no photos; deleted once the test is sent and downloaded, the line stays with `size: 0`), `benchTestStatus` (jobs a test's
  report is on + download time, written by any laptop, `src/bench-status.js`), `benchOrders`, `pendingAssets`, plus the new-equipment customers. Rule changes are **not** published by a push:
  paste the whole file into the Firebase console and say so (`rules/README.md`).
- **SharePoint `CHS Test Bench` folder** (folder picker, once per laptop): `Templates` is the **master for templates**; `Results` for
  saved files. `templates/` in this repo is a copy for Firefox / no-picker browsers: after a template change in SharePoint run
  `node apps/testbench/tools/sync-templates.mjs`, commit, push. Generators in `tools/make-*-templates.mjs` write into `templates/`;
  those files must then be copied into SharePoint to be used. **A new template:** `tools/new-template.mjs` (blank starter or `--from` a copy),
  then `tools/check-templates.mjs` until clean (it reads what the bench allows from `bench/index.html`, so a new step type or lead there is
  picked up; `LEGACY` in `tools/template-lib.mjs` and in `tests/templates.test.mjs` must stay the same list).
- **Simpro:** only through the Apps Script proxy (`shared/proxy.js`); the key never reaches the page.

**No job to attach to?** The bar has a **No job yet? Create one…** button beside the job picker (`src/jobDraft.js`): it only pre-fills that tool's new-job form and leaves a way back; nothing is created from the Test Bench (see `apps/simprojobs/README.md`).

## Rules for changes

- **Never break the hardware rules** (bench-notes §6): 150 ms gap after an ESA612 reply, wait for the expected reply type, skip late `!21`,
  `IDLE` not `POL=OFF`, no `EARTH=` under earth leakage, MAP order `IDLE, MAP, AP=…, MAP=NORM, POL=N`, never the blocked ProSim commands.
  The simulator (`simPort`) passing is **not** hardware verification — say what is unverified on the real units.
- **Never change a test limit silently.** AS/NZS 3551 wins for electrical safety, the latest manufacturer manual for performance; note
  disagreements in the template `desc` and leave the decision to Jonathan (the open ones are in bench-notes §11).
- **Never overwrite a template from an older copy** — diff against the live SharePoint file first; engineers edit them there.
- **Imported Ansur records pass through unformatted.** Encodings: `.mtr` is cp1252 + CRLF; the PDF font is WinAnsi (Ω→Ohm, ≤/≥→max/min).
- **Folder pickers / `requestPermission` must run before any long `await`**, or the click is lost.
- **Keep the page offline-capable:** local fonts in `bench/fonts/`, no CDN. Templates are never precached (`scripts/build.mjs`).
- **One-file offline copy** (25 Nov 2026): `node apps/testbench/tools/build-offline.mjs` writes `dist-offline/CHS-Test-Bench-offline-<date>.html` (git-ignored): the bench page with fonts and every template inside, opened by double-click in Chrome or Edge, no hub, no folder, no internet. It patches a copy of `bench/index.html` at four anchors (fonts link, `</head>`, `Shared.init`'s "no folder" line, `</body>`) and stops the build if one is gone, so if you change those lines, run `npm test --prefix apps/testbench` (`tests/build-offline.test.mjs`). It is a snapshot: rebuild and hand out a new one after the bench or a template changes. Not tried with a real ESA612 / ProSim yet.
- **A set of devices is one test** (`run.devices`, "Other devices in this test"): every serial is in the one `benchTests.serial`
  field joined by " + " (file names: ", "). Anything that matches tests or reports by serial must use `splitSerials` (`src/bench-tests.js`).
- **Activity log:** hub-side data changes (sharing/removing tests, orders, sends to Simpro, pending assets) log one line with counts only,
  never names, emails or content (`shared/activity.js`).
- To replace the whole bench from another file: `node scripts/update-bench.mjs "<file>" --force` (swaps in local fonts and the hub hook).

## Verify

```bash
npm test --prefix apps/testbench
```

plus the repo's `npm run build`, `npm test -w apps/schedule`, `npm test -w apps/hub`. The tests also check the page
still has its local fonts and `offerToHub` hook. Web Serial does not work in embedded preview panes, so instrument steps can only be
checked on a laptop with the real units (or the bench's Devices → simulate). After pushing, reload `/testbench/` on the live site and
confirm the change; open tabs keep the old bench until reloaded.

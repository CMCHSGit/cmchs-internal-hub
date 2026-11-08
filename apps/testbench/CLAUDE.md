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
| **The hub section** | `src/section.jsx` (React, under the hub header, frames the bench with `allow="serial"`) | Saved reports (`reports.js`, IndexedDB `chs-bench-reports`), zip download (`zip.js`), Simpro attach via the outbox (`outbox.js`, `simpro-api.js`, `JobPicker.jsx`), shared previous tests (`bench-tests*.js`), Orders (`orders*.js`, `Orders.jsx`), "Test this device" links (`device-link.js`). |

Messages are all `chs-bench:*` (`hello`, `file`, `run`, `run-data`, `shared-list`, `get-run`, `delete-run`, `deleted`, `build-pdf`/`pdf`,
`build-mtr`/`mtr`, `pending-customers`/`add-pending`/`pending-reply`, `open-device`, `orders`, `model-colours`/`-reply`, `home`). Change both sides together, and search both files for the
name. The bench's hand-off point is `offerToHub()`. The bench stays loaded (hidden) behind the other tabs so a test and the USB link survive.

Also here: **`src/newequip/`** — the New equipment page at `/new-equipment/` (customer picker, asset list read via Microsoft Graph,
pending assets, hand-off to Simpro Asset Sync). It is being built to replace the bench + Asset Sync + Ansur report builder eventually;
until it does everything, those keep working as they are. Its own map and rules: `src/newequip/CLAUDE.md`.

## Where data lives

- **Per laptop:** IndexedDB `chs-test-bench` (templates, runs, kv folder handles; **schema bumps must keep `onblocked`/`onversionchange`**),
  `chs-bench-reports`, the outbox, `chs-newequip-handoff`; localStorage `chsBench.prefs`, `chsBench.flow`, `newEquip.customer`.
- **Firestore** (rules in `rules/firestore.rules`): `benchTests` (one line per finished test), `benchTestData` (whole test as one JSON
  string, no photos), `benchOrders`, `pendingAssets`, plus the new-equipment customers. Rule changes are **not** published by a push:
  paste the whole file into the Firebase console and say so (`rules/README.md`).
- **SharePoint `CHS Test Bench` folder** (folder picker, once per laptop): `Templates` is the **master for templates**; `Results` for
  saved files. `templates/` in this repo is a copy for Firefox / no-picker browsers: after a template change in SharePoint run
  `node apps/testbench/tools/sync-templates.mjs`, commit, push. Generators in `tools/make-*-templates.mjs` write into `templates/`;
  those files must then be copied into SharePoint to be used.
- **Simpro:** only through the Apps Script proxy (`shared/proxy.js`); the key never reaches the page.

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

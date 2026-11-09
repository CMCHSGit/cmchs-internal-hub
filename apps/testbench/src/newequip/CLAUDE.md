# New equipment testing — read this before changing anything here

Claude loads this file when working under `apps/testbench/src/newequip/`. The Test Bench's own `CLAUDE.md` (`apps/testbench/`)
applies too: read it first. This file is the short map of the New equipment page.

## What it is

One page for the whole job on a customer's new equipment, from recording each asset to filing its test report. Live at
`internal.chsnz.co.nz/new-equipment/`, a **section of the hub's one app** (no build of its own): `section.jsx` is lazy-loaded by
`apps/hub/src/App.jsx` (`section === 'new-equipment'`); route in `apps/hub/src/router.js`, Service menu in `apps/hub/src/tools.js`,
service-worker match in `apps/hub/src/sw.js`, activity-log app name `'new-equipment'` in `shared/activity-core.js`.

It is being built **beside** the three tools it will replace — the Test Bench (`/testbench/`), Simpro Asset Sync (`/simprosync/`) and
the Ansur report builder (`/ansurtopdf/`). Those keep working exactly as they are until this page does everything they do; the page
links to them under "Until this page does it all". Add steps here one at a time; never take a feature away from those tools to move it.

## What it does today

1. **Customer** — pick one (type-to-search combobox; remembered in localStorage `newEquip.customer`). Customers are the **project
   tracker's customer folders** (`projectSettings/main.customers`, model in `apps/projects/src/customers.js`). The page uses two sub
   folders by name: **"Equipment list"** = the asset list link, **"Test reports"** = the reports folder link. Admins and the tracker's
   teams (`TEAMS`) can add a customer or edit those two links here (a transaction, so two people adding at once keep each other's).
2. **Asset list** — the customer's workbook, **read only**, loaded one of three ways: from the stored link via **Microsoft Graph** as the
   signed-in person; **Reload** of a file chosen before on this PC (File System Access handle, Chrome/Edge); or **Choose a file…**.
   Shown one row per unit, matched **by serial number** to the latest shared bench test (`benchTests`) and to reports saved on this PC
   (`chs-bench-reports`). Tiles (units, tested, pass/fail, saved), duplicate-serial warning, search, sheet filter, first 150 rows shown.
   Each row has a **Test this device** link into the bench (`testLink` → `/testbench/?model=…&serial=…`, read by `../device-link.js`).
3. **Pending rows** — assets recorded while testing that aren't in the workbook yet (Firestore `pendingAssets`). Add from the form here
   (site, manufacturer, ward, service, job carry over to the next one), or from the bench's **Not found → Add to the asset list…**
   (`from-bench.js`, handled in `../section.jsx`). Out as **Copy rows for the workbook** or a row's own **Copy** (tab-separated, in the
   chosen sheet's own column order, to paste under the last row), **Download .csv**, or **Send to Simpro Asset Sync**. A serial already on the list or already pending is refused. **Edit** on a row opens the same form filled in and corrects it in
   place (keeps its place, who recorded it and when; stamps `editedBy`/`editedAt`); an unchanged serial never clashes.
4. **Simpro** (admins or `simproAccess`) — **Preview this list in Simpro** hands the workbook (or the pending rows as .csv) to Asset
   Sync. Nothing changes in Simpro until someone presses **Apply** there.
5. **Test reports** — zip of the PDFs saved on this PC for the list's units, and **Attach to a Simpro job…** (opens the bench's Saved
   reports with those serials). Saving straight into the reports folder is **not built**: it needs Graph write access, which comes later.

## Map

| File | What it owns |
|---|---|
| `section.jsx` | The page: auth wrapper, customer picker, Add/Edit customer dialog, links, the "other tools" card. `canEdit` / `canSimpro` live here. |
| `customers.js` / `customers-firebase.js` | Pure: sub-folder names (`ASSET_LIST`, `REPORTS`), links, search, drafts. Firestore: `watchCustomers`, `saveCustomer` (transaction). |
| `AssetList.jsx` | Loading (link / remembered file / chosen file), the table, tiles, Simpro hand-off, reports zip. Renders `Pending`. |
| `assetlist.js` | Pure: workbook → units, using **Asset Sync's own reader and rules** (`apps/simprosync/reader.js`, `core.js`) so both tools agree on what a row is. `benchByUnit`, `reportsByUnit`, `summary`, `filterUnits`, `duplicateSerials`. |
| `graph.js` / `graph-auth.js` | Graph read via the shares API (`shareId`, `fetchWorkbook`, 25 MB max, `GraphError` codes). Token: `reauthenticateWithPopup` asking `Files.Read.All`, **memory only**, ~50 min, from a click. |
| `filehandle.js` | Remembered file handles per customer, IndexedDB `chs-newequip-files`, read permission only. |
| `Pending.jsx` / `pending.js` / `pending-firebase.js` | Pending rows UI; pure `FIELDS` (key, heading, other names, loose match), `cleanPending`, `clashes`, `mapHeaders`, `toTsv`, `toHtml` (Excel paste: text format on all but dates and site/job), `toCsv` (formula-safe), `isoDate`, `sheetsToRemember`, `testLink`, `missingSite`; `editClashes`, `changedFields`; Firestore watch/add/edit/remove, `addPendingQueued` for offline laptops. |
| `from-bench.js` | Pure: which New equipment customer a bench request means (`matchCustomer`: remembered file → exact name → one fuzzy match → ask), `fileStem`, `rowFromBench`. |
| `handoff.js` / `toSimpro.js` | One file left in IndexedDB `chs-newequip-handoff`, taken **once**, **10 minutes** max, by `/simprosync/?from=new-equipment` (`apps/simprosync/app.js` imports `takeHandoff`/`wantsHandoff`). |
| `newequip.css` | `ne-*` classes. |

Shared with the bench section: `../reports.js`, `../zip.js`, `../bench-tests-firebase.js`, `../orders.js` (`sameCustomer`).

## Where data lives

- **Firestore**: `projectSettings/main` (customers — **owned by the project tracker**; change its model in `apps/projects/src/customers.js`,
  not here) and `pendingAssets` (`{ customerId, row, by, createdAt }`, `row` only the `FIELDS` keys; the Bench's teams read/add/delete,
  edit only `row` + `editedBy`/`editedAt`; `by` and `editedBy` must be your own email). Rules in `rules/firestore.rules` (`isPendingAsset`). The `pendingAssets` rules (create and edit) were
  published on 9 Nov 2026 (`rules/README.md`); a later change to them needs publishing again, and the page says so when one is refused. Rules tests: `rules/tests/pending-rules.test.mjs` (emulator, needs Java). Publishing = paste the
  whole file into the Firebase console; ask first. If you add a field to `FIELDS`, change `isPendingAsset`'s key list too, and say it
  needs publishing.
- **This PC**: localStorage `newEquip.customer`; IndexedDB `chs-newequip-files` (file handles), `chs-newequip-handoff` (the one hand-off);
  the bench's `chs-bench-reports` (read here); localStorage `testbench.pendingCustomer` (file name → customer, used by the bench side).
- **Customer workbooks** in OneDrive/SharePoint: read only, never written, never copied anywhere but memory.

## Rules for changes

- **Copy puts an HTML table on the clipboard beside the text**, and Excel pastes the table: cells are marked text (`mso-number-format:'\@'`)
  except dates and Simpro site ID / job. Without it, an asset number pasted into a date-formatted cell showed as a date (8886 →
  4/29/1924) and ECG "3/5" became a date. **Dates go out as yyyy-mm-dd**: engineers' Excel reads d/mm/yyyy month-first. Both were
  checked by pasting into Excel; check that way again after changing `toHtml`/`toTsv`.
- **Copy uses the sheet's own column order** (`mapHeaders`), from the loaded list or the header rows remembered on this PC
  (localStorage `newEquip.sheets`, names and headers only). With neither, it warns before using the template order.

- **Never write to a customer's workbook.** Writing into the synced file was tried and didn't sync; pending rows exist because of that.
  Graph is asked for `Files.Read.All` only. A write scope needs an IT admin's consent: raise it with Peter, don't add it.
- **Read workbooks only through Asset Sync's `reader.js` / `core.js`**, never a spreadsheet library (it could damage customers' tables,
  and the two tools must agree on rows). Serial number is the key; match it with `serialKey` (trim, upper case) everywhere. A shared test's `serial` can be a set
  ("A + B + C"): split it with `splitSerials` first.
- **Nothing reaches Simpro from this page.** It only hands a file to Asset Sync, whose preview + Apply is the only way in. Keep the
  hand-off once-only and short-lived.
- **Pickers, `requestPermission` and the Graph pop-up must run straight from the click**, before any long `await`, or the browser drops them.
- **The Graph token stays in memory.** Never store it, log it or put it in a URL. `VITE_AZURE_TENANT_ID` is in Actions secrets / `.env`.
- **Bench ↔ hub messages** (`chs-bench:pending-customers`, `add-pending`, `pending-reply`) are handled in `../section.jsx` and sent from
  `bench/index.html`: change both together.
- **Activity log:** every data change logs one line with counts only (`logActivity(null, '…', { app: 'new-equipment' })`): loading a
  list, adding/removing pending rows, customer changes, zips. Never customer names, serials or file names.
- **Plain modules stay plain**: `customers.js`, `assetlist.js`, `pending.js`, `from-bench.js`, `graph.js`, `filehandle.js`, `handoff.js`
  have no React/Firebase so the tests import them directly. Keep Firebase in the `*-firebase.js` files.

## Verify

```bash
npm test --prefix apps/testbench
```

(`tests/newequip-*.test.mjs` cover asset list, customers, file handles, from-bench, pending; there are hand-off tests in Asset Sync's)
plus the repo's `npm run build`, `npm test -w apps/schedule`, `npm test -w apps/hub`. Graph reading needs a real Microsoft sign-in, and
the remembered-file Reload needs Chrome/Edge, so check those on the live site after pushing (`/new-equipment/`, pick a customer, load
the list) and say what wasn't checked.

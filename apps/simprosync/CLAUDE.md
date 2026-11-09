# Simpro Asset Sync — read this before changing anything here

Claude loads this file when working under `apps/simprosync/`. It is the short map; the detail lives in:

- `README.md` (repo root): the `/simprosync/` row, "Sign-in" (the pattern for a tool that needs a third-party key), "Activity log"
  (Simpro writes are logged by the proxy), and the SimproSync line in the live checklist.
- `backend/apps-script/proxy/Code.js`: `simproSyncProxy_`, `SIMPRO_SYNC_ALLOWLIST`, `simproSyncVerifyAdmin_`,
  `simproSyncJobPatchError_`, `simproSyncAudit_` (the relay every Simpro call goes through).
- `INTEGRATION-PLAN.md` step 3: why it moved in unrewritten, and the later "real components" job.

## What it is

Takes a customer's asset list (.xlsx/.csv, usually Mindray Monitors and IT sheets) and makes Simpro match it: updates the custom
fields of assets already there, creates the ones that aren't, and, if the sheet has a **Simpro Job** column, attaches each job's
assets to it, appends a note listing them, and closes the job (stage **Complete**, status **Job : Completed**). Always **Preview**
first (reads only); **Apply** writes. Live at `internal.chsnz.co.nz/simprosync/`, against `cass.simprosuite.com`. For admins and
anyone given Simpro access in Settings → People and access (`users/{uid}.simproAccess`). It also has **Delete assets by type**
(admins only), separate from the sync.

It is a **section of the hub's one app** (no build of its own): `src/section.jsx` is lazy-loaded by `apps/hub/src/App.jsx`. It
**moved in with its working code as it is** (17 Oct 2026): `page.html` is its old markup and `app.js` drives it by element id. It
writes to and deletes from a live Simpro with no test company, so it was restyled onto the kit, not rewritten. **Don't rewrite it
as components** unless asked and it can be checked against Simpro; small, careful changes to `app.js` are the norm.

## Map

| File | What it owns |
|---|---|
| `src/section.jsx` | The gate (admin or `simproAccess`, the same rule the proxy applies), the heading, injects `page.html`, starts the tool once. |
| `mount.js` | `mountSimproSync`: hides the Delete card for non-admins, builds the **transport**: calls made in the same tick are batched, up to 25, into one POST `{action:'simproSync', idToken, requests}` to the proxy (`shared/proxy.js`). Its `[simproSync] batch of N - ok in Xms` console lines are kept on purpose. |
| `app.js` | Everything on the page: company and asset-type lists, the sheet picker (Monitors/IT ticked by default, "IT" → type "Mindray IT", else "Mindray"), Preview (`runDry`), `planJobs`, the result tabs, Apply, the CSV report, Delete by type, the New Equipment handoff. Its header comment says "main.js"; that is now `mount.js`. |
| `core.js` | `SyncCore`, pure and tested (`apps/hub/tests/simpro-*.test.mjs`): the sync rules (`toRecords`, `mapColumns`, `compare`, `splitMoved`) and the job note (`warrantyScan`, `jobNoteLines`, `jobNoteBlock`, `jobNotePreview`, `summariseNotes`). Ported from the old `sync_assets.py`. |
| `fast-assets.js` | `fastSiteAssets`: reads a type's assets on many sites with their custom fields in a few company-wide `/customerAssets/` calls, spot-checks a few against the per-asset call, and returns **null** (fall back to site by site) on any doubt. |
| `reader.js` | `XLSXLite`: a dependency-free .xlsx/.csv reader (cached values; dates as `{date}`, Excel errors as `{err}`). |
| `page.html`, `src/simprosync.css` | The markup (ids are `app.js`'s contract) and its styles on the kit. |

**Used from outside this folder** (rename or change an export → search the repo): `reader.js` by checklists, maintenance,
service-orders and the Test Bench's new-equipment page; `core.js` (`toRecords`, `asText`, `isErr`) by
`apps/testbench/src/newequip/assetlist.js`; the localStorage key `simproSync.company` (last company) is shared with Ansur, Service
Orders and the Test Bench. **Other tools call the same proxy action** (`simproSync`): Ansur, Service Orders, Simpro Deep Search, the
Test Bench. A proxy change for this tool changes theirs too.

**Into this tool:** `/simprosync/?from=new-equipment` takes an asset list left in IndexedDB by the new-equipment page
(`apps/testbench/src/newequip/handoff.js`, taken once, 10 minutes at most) and loads it as if chosen here. **Out:** the "Reports to
add" row reads the Test Bench's saved reports on this computer (`apps/testbench/src/reports.js`) and links to them.

## The sync rules (keep them; each was learned on real data)

- **Matched on Serial Number within Site ID.** Upper-cased. A row with no serial or a non-numeric Site ID is skipped with a
  warning; a serial twice in the sheet keeps the first.
- **Blanks never clear Simpro.** Values not in a Simpro List field are rejected; Excel errors (`#REF!`…) are skipped, and ones
  already stored in Simpro are reported. Dates go in as ISO, read NZ-style (`d/mm/yyyy`).
- **The sync never deletes.** Assets in Simpro but not the sheet are listed ("In Simpro only") and left alone.
- **A serial already in Simpro on another site is not a create** (`splitMoved`): it was making duplicates. Its job is left alone
  until the sheet's Site ID is fixed.
- **Never two PATCHes to the same asset at once.** Simpro answers 200 to both and silently loses one, and a lost Serial Number turns
  into a duplicate on the next run. Apply is one call in flight per asset, many assets at once (`pool(…, 25)`) so batches stay full.
  Keep that shape (the long comment in Apply).
- **Concurrency is for batching, not speed per se**: pools of 25–50 fill the transport's 25-call batches; narrower pools leave
  each ~1.5–3s proxy round trip mostly empty. `call()` tries 4 times with backoff on network errors, 429s and 5xx, and says so on screen.
- **Jobs**: left alone if not found, already Complete/Invoiced/Archived, for a different site than its assets, or with no cost
  centre; assets go on the first cost centre. The job closes **only if every asset attached**. Notes are only **appended**
  (never edited), and skipped only when the exact block is already there. The note's text comes from `SyncCore.jobNoteBlock`, used
  by both the preview and Apply, so they can't drift. One `<div>` with `<br>`s: Simpro's editor runs block elements together.
  With an **Extended Warranty** column the list is grouped (Yes / other) and says so when none are Yes; defibrillators add their
  battery serial.
- **A reload never eats work**: while running, or with a file or unapplied preview loaded, the page sets `body.busy` /
  `data-working`, which the shell's update guard waits for (`shared/updateGuard.js`, `shared/register-sw.js`).

## The proxy (where the real limits are)

The browser never has the Simpro key (a Script Property on the proxy). The proxy checks the Firebase ID token and the user's
record (admin, or `simproAccess`), then relays only `SIMPRO_SYNC_ALLOWLIST` method+path shapes, 25 per call. DELETE is admin-only;
a job PATCH may only set `Stage` (one of four), `Status` (a number) and `Notes` (text ≤ 50,000). Each call that wrote leaves one
activity-log line ("Simpro: changed job 7: Stage to Complete"), numbers and field names only, so **this page logs nothing itself**.

A new Simpro call from this tool needs an allowlist entry, then `clasp push` **and** `clasp deploy -i <id>`, then a check of the
live `/exec` (`backend/README.md`). Deploy the proxy **before** pushing page code that needs it. Test the allowlist and checks in
`apps/hub/tests/simpro-access.test.mjs`.

## Run and verify

```bash
npm test -w apps/hub
```

Covers `core.js` (notes, moved serials), `fast-assets.js` and the proxy's access rules. Plus the repo's `npm run build` and
`npm test -w apps/schedule`. `app.js` itself has no tests and nothing local can stand in for Simpro, so a change to Preview or
Apply is checked live: run a small sheet with one changed field — the preview shows 1 update and Apply changes it in Simpro
(README checklist). Prefer a Preview-only check where you can, and **ask before anything that writes to Simpro**. Reports and logs
give counts, sites, job numbers and serials only to the person running it; never put customer names or sheet contents in a
commit, the activity log or the chat.

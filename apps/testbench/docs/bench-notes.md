# CHS Test Bench: how it works and what to avoid

Notes carried over from the hand-over pack of 2 Nov 2026 (the SharePoint-era `CLAUDE.md`), kept for anyone changing the bench.
Read `esa612-protocol-notes.md` before touching anything that talks to the hardware. `change-log.md` has the detail on the 2 Nov features.

**What has changed since the pack was written**
- The bench now lives here, `apps/testbench/bench/index.html` (the **hub copy is the master**), shown in a frame by the hub (`allow="serial"`, same origin). The SharePoint file `ServiceCHS Test Bench.html` is retired. Where these notes say "the HTML file", "`file://`" or "overwrite the SharePoint copy", read it as this file and the hub deploy.
- Line numbers in the code map are from the single-file build and have moved; use the module names to search.
- Templates, results and the Ansur `.mtr` still go to the SharePoint `Templates` and `Results` folders (folder picker, once per laptop and address). Saved reports are also kept in the hub (see `README.md`).
- Mistakes 3 and 15 below are from the SharePoint days; the rest still apply.
- The pack also had 11 Playwright checks against the built-in simulator (`simPort`) that took about 12 minutes; they are not in this repo yet. The checks here are `npm test --prefix apps/testbench`.
- Instruments in use: Fluke ESA612B (firmware 3.01) and Fluke ProSim 8 (firmware 2.08.03), both FTDI FT232R at 115200 8N1.

**Who tests what:** several CHS engineers use it, on Mindray patient monitors and modules, anaesthetic machines, defibrillators, power supplies and Class I and Class II computers, mainly to AS/NZS 3551.

## 3. Code map (`app/CHS Test Bench.html`)

Line numbers are approximate. Everything is global objects in one `<script>`.

| Lines | Module | What it does |
|---|---|---|
| ~613 | utilities | `esc`, `uid`, `clone`, `icon`, `toast`, `dialog()` (queued modal; `collect` returns `{value,data}`), `download`, `safeName` |
| ~640 | `Prefs` | localStorage `chsBench.prefs`: `zeroLead`, `confirmPower`, `reportSkipped`, `insMap` |
| ~696 | `DB` | IndexedDB `chs-test-bench` **v2**: stores `templates`, `runs`, `kv`. Has `onblocked` and `onversionchange` overlays (see mistakes) |
| ~736 | serial | `REPLY` patterns, `Link` class (queue, expectLine, skip21, streams, 150 ms gap), `simPort(kind, opts)` simulator, `Devices` (connect/choose/reconnect/simulate) |
| ~1038 | readings | `parseReading`, `judge(value, lo, hi, over)`, `limitText` |
| ~1074 | test library | `CONDS`, `LEADS`, `INS_TARGETS`, `AP_LIMITS`, applied-part editor, ProSim option lists, **`TYPES`** (all step types), `stepChecks(s)` |
| ~1265 | models | `tplModels`, `stepForModel`, `templateFromRaw(raw)` (normalises any imported template), `newStep` |
| ~1283 | `defaultTemplates()` | starter templates (TM80 etc.) |
| ~1338 | `Store` | templates in IndexedDB. `save()` marks shared templates as changed |
| ~1366 | `Shared` | shared templates folder (File System Access API): `root` (CHS Test Bench folder) or `dir` (Templates), sync, save-back, conflicts |
| ~1527 | `Builder` | template editor UI (drag and drop, inspector, photos, models, applied parts) |
| ~1868 | `Runner` | running a test: start/go/renderList/renderStage, checks UI, ESA auto sequence (`runAuto`), measurement, finish, **autosave/offerRestore**, **reloadTemplate**, resume, summary, results file, print |
| ~2641 | report | `overallOf`, `reportSteps`, **`reportSections` / `reportRows` / `reportInfo` / `titleCase`** (Ansur-style layout), `summaryTable`, `buildEsaRows` (the ESA612 command plan per step) |
| ~2788 | `Diag` | ESA612 diagnostics (Devices page) |
| ~2908 | `Power` | powers the device under test (DUT) from the ESA612 outlet (`IDLE`, `EQCURR`, `POL=N`) |
| ~2960 | `Records` | Previous tests list, open results files and Ansur `.mtr` records (`ansurToRun`) |
| ~3099 | `copyStepsDialog` | copy steps between templates |
| ~3131 | Ansur export | `toCp1252`, `crc32`, `buildMtr(run)`, `exportMtr` |
| ~3284 | Ansur import | `ansurToTemplate(xml)` (.mtt/.mtr to template) |
| ~3418 | `ReportPdf` | PDF via pdf-lib (Helvetica/WinAnsi) |
| ~3556 | `Results` | saving to the Results folder (falls back to download); `outName(run, ext)` |
| ~3617 | `App` | init (DB, Store, Shared.init, event binding, `Runner.offerRestore()`), view switching |

## 4. Data formats

**Template file:** `{ format: 'chs-test-bench-template', version: 1, template: T }`

```
T = { id, name, desc, updated, dut: ['Serial number','Manufacturer','Model','Customer','Location','CHS asset #','Customer asset #','Testing engineer'],
      appliedParts: [{ id?, name, apclass: 'B'|'BF'|'CF', leads: ['RA'] }], models: ['D30','D60'], showNA: bool,
      esaAuto: bool (default true), esaHalt: bool (default true),
      steps: [{ id, type, title, instructions, images: [{src(dataURL), caption}], hold, params, models?: ['D60'] }],
      shared?: { file, mtime }, sharedDirty?, sharedConflict? }      // the last three exist in the browser only, never in files
```

**Step types (`TYPES`) and their params**

| Type | Params |
|---|---|
| `info` | (none) |
| `check` | `{ items: [string], readings: [{label, unit, lo, hi}] }` |
| `numeric` | (none listed) |
| `esa_mains` | `{lo, hi}` |
| `esa_pe` | `{hi}` |
| `esa_ins` | `{ target: MINS\|APINS\|MAINS_AP\|MAINS_NE\|AP_NE, volts: 'HIGH', lo }` |
| `esa_encl` / `esa_earthl` | `{ conds: [{c: NC\|ON\|OE\|RNC\|RON\|ROE, hi}] }` |
| `esa_pat` | `{ mode: together\|each, conds }` |
| `esa_map` | `{ mode, pols: ['NORM'] }` |
| `ps_nsr`, `ps_perf`, `ps_paced`, `ps_arr`, `ps_resp`, `ps_nibp`, `ps_temp`, `ps_ibp`, `ps_stop`, `ps_custom` | ProSim settings, plus `monitor: {enabled,label,unit,lo,hi}` and `extra: [checks]`. A check with limits is typed; without limits it is pass/fail |

**Run** (IndexedDB `runs`, and inside results files):

```
{ id, templateId, template (snapshot, images stripped when stored), dut, started, finished, idx, model?, extra: [[k,v]],
  results: { [stepId]: { status: pending|pass|fail|done|skipped|info, rows: [{label, value, unit, over, raw, limit, result: pass|fail|info|na, display}] } },
  equipment: { esa: {ident, sn, sim}, ps: {...} }, overall, stopped, inProgress, saved, restoreDismissed, templateReloaded, imported?: {source:'Ansur'|'Results file', file} }
```

- **Row indexing:** check rows are indexed by check position (`rows[k]` belongs to `stepChecks(s)[k]`). ESA rows follow `buildEsaRows`.
- **Results file:** `{ format: 'chs-test-bench-results', version: 2, …summary…, run }`. v1 files have no `run` and open read-only.
- **IndexedDB `kv` store:** `sharedDir` (Templates handle), `benchDir` (CHS Test Bench root handle), `resultsDir`.
- **localStorage:** `chsBench.prefs`, `chsBench.flow` (the serial flow-control setting that worked).

## 5. Features (current behaviour)

**Running a test**
- Device details, then steps. An ESA612 **auto sequence** runs neighbouring ESA steps after one confirmation and pauses only to move the lead.
- Stop on fail offers Measure again or Continue from next test.
- Lead zeroing and the extra voltage confirmation are **off by default** (Devices → Test settings).

**Checklists**
- Pass / Fail / N/A items and typed readings. **Mark all as pass and next** is on checklist and simulator steps.
- **Skip this step** (10 Nov 2026): the Skip button is on every step that isn't already skipped, so a Pass clicked by mistake can be undone. On a step already answered it asks first, then clears that step's `rows` and sets `status: 'skipped'` (it drops out of the report). The button's wording and visibility follow the step (`renderList`), so it changes as checks are answered. Skipped steps can be redone from the step list.
- Item text states the setting and target, e.g. "VCV adult: Vt 500 mL ±35 mL (465–535 mL)".

**Templates and models**
- Model variants: a step's `models` field limits it to those models. The model is taken from the Model field, otherwise the bench asks. Other models' steps are removed from the run.
- Applied parts can be changed mid-test; this clears the patient leakage and MAP results already measured.

**Skipping and the overall result**
- Skipped steps don't make the result incomplete. They are hidden from reports unless "Include skipped steps and N/A items" is ticked.
- `overallOf`: fail beats pending, and pending beats pass.

**Power and Previous tests**
- **Power the device:** EQCURR, outlet on.
- **Previous tests:** search, open, Continue test; badges show In progress or Incomplete.

**Autosave**
- Every change saves the run (`inProgress: true`) straight away, and again on pagehide/visibilitychange.
- On load, `offerRestore()` asks "Carry on with the unfinished test?". **Not now** sets `restoreDismissed`.

**Reload template**
- Swaps in the latest template version and keeps results.
- Matching order: step by id, then type + title, then the insulation target. Checklist answers match by wording, then position for reworded items.
- Readings are re-judged against the new limits.
- Removed steps with results are kept at the end, unless the user unticks that.
- The run's applied parts are kept.

**Shared templates folder**
- The user chooses the **CHS Test Bench** folder once per PC and browser. Templates come from `Templates`, results go to `Results`.
- Sync rules:
  - newer files replace the browser copy; deleted files are removed
  - names starting with `_`, `.` or `~`, and any `Old` folder, are ignored
  - `.mtr`/`.mtt` files are converted, and a same-name `.json` takes priority
  - local edits stay local until **Save to shared folder**, with a conflict prompt if the file changed meanwhile

**Outputs**
- Save PDF, Save results file and Ansur file (.mtr) all go to `Results` as `Serial - Model DD.MM.YYYY.ext`, using today's date. If the name exists the bench asks Replace or Keep both. Without folder access they download.

**Report layout** (summary, Print and PDF; it matches `docs/reference/*.pdf`)
- Details order: Serial, Manufacturer, Model, Location, Customer, Asset # (from "CHS asset #"), then Testing engineer and Testing company (CHS), Safety analyser (ident · S/N), Applied parts ("name – type BF"), and any extras.
- Customer asset # appears only when filled.
- Titles are title case, with ":" turned into " – ".
- ESA sections use the standard names. The insulation steps are merged into **Insulation Resistance**.
- Row labels: "Live to Neutral", "Normal Condition – <AP> (BF)" and so on.
- Readings without a limit show **Pass**.
- **Imported Ansur records skip all of this reformatting.**

**Ansur import**
- `.mtt`/`.mtr` to template: containers become checklist steps, numerical lists become readings, the ESA612 sequence becomes ESA steps, and the module setup becomes applied parts (Class 1/2/3 → B/BF/CF).
- Patient auxiliary current and procedure photos are dropped.
- `.mtr` records open as read-only runs.

**Ansur export**
- `.mtr` uses only the built-in AVPI plug-in, in cp1252 with CRLF line endings.
- `DIdCS` = signed CRC-32 of the file without the DIdCS line, with whitespace trimmed.
- **Not yet opened in real Ansur.**

## 6. Hardware rules: never break these

The full detail is in `docs/esa612-protocol-notes.md`. In short:

**Line handling and timing**
- On connect, clear the line: ESC, then wait for quiet; CR LF, then wait for quiet. IDENT up to 4 times, accepting only an ident-looking reply.
- If that fails with hardware flow control, try without it, and remember what worked.
- Leave **at least 150 ms** between an ESA612 reply and the next command (30 ms for the ProSim).
- Every command waits for its *expected* reply type. Stale lines are ignored. **`!21` is skipped while waiting for `*`** (it arrives late after an over-range stream).

**Readings**
- `!21` during a reading means over range. Record it at the top of the range, then judge it: over range passes a minimum limit and fails a maximum limit.

**Command order**
- Select the test first (`MAINS=`, `ERES`, `MINS`/`APINS`/`INSB|D|E`, `EARTHL`, `ENCL`, `PAT`, `MAP`), then send its settings.
- Switch the outlet off with **`IDLE`**, never `POL=OFF`.
- Earth leakage sends **no `EARTH=`**; the unit refuses it.
- MAP order that works on our unit: `IDLE`, `MAP`, `AP=…//OPEN`, `MAP=NORM`, `POL=N`. `AP=` after `MAP=NORM` is refused.
- `MODE=AC` and `INS=HIGH` are refused out of context. Carry on when that happens.

**Insulation tests B, D and E**
- Fluke only names them as commands. The bench maps them with `FN` (23 = mains to applied parts, 21 = mains to non-earthed part, 22 = applied parts to non-earthed part) and stores the mapping in prefs `insMap`.
- This mapping is **unverified on the real unit.**

**ProSim**
- Never send `RESET`, `PAIR`/`UNPAIR`, `PS=`/`PST=`, `NIBPLEAK`, `NIBPPOP`, `ZPRESS`, `CZPRESS` (`PS_BLOCK`).

**Preview panes**
- Web Serial is blocked in embedded preview panes (permissions policy). It works on `file://` and https in Chrome/Edge.

## 7. Verified vs not yet verified on real hardware

- **Verified 15–23/10/2026 on the real units:**
  - ESA612: connect, mains, PE, MINS, APINS, enclosure, earth leakage, patient leakage, MAP
  - ProSim: IDENT/QMODE/REMOTE/SN/QBAT
- **Only tested in the simulator so far:**
  - the `!21` skip fix
  - `EQCURR` (Power the device)
  - INSB/INSD/INSE FN mapping
  - `.mtr` export opening in Ansur
  - the folder picker and permission persistence on SharePoint
  - saving to Results
  - Reload template and autosave on Jonathan's PC
  - ProSim simulation commands in the templates (partly)

Simulator options for `simPort('esa', opts)`: `messy`, `peOpen`, `mapNoAp`, `mapNever`, `noFn`, `ins21`, `apFirst`.

## 8. Templates (all in `templates/`)

| Template | Steps | Notes |
|---|---|---|
| Patient Monitor and OR Modules | 20 | Converted from Ansur (32 → 20, merged). |
| Mindray A7 Anaesthetic Machine | 29 | From CHS Ansur template + completed record FS6-47000856 + Mindray A5/A7 PM checklist V2.0. One BF group "Airway Hoses, Aux, ACGO, AG+O2" on RA. |
| Mindray A9 Anaesthetic Machine | 26 | From CHS Ansur template + A9 checklist + A8/A9 service manual V7.0 ch. 7. BF "Airway Hoses, AG+O2, Auxiliary, ACGO" on RA. Vaporiser accuracy uses the V7.0 table; heating sensor difference ≤1 °C; balance gas zero 0–200. |
| Mindray D30-D60 Defibrillator | 31 (26 for D30) | `models: [D30, D60]`. D60 only: Temp, IBP static, IBP waves, mainstream CO2, IR ear/camera/ultrasound. **Every reading is a pass/fail checklist item with the target in the wording** (Jonathan's request, 02/11). Applied parts: "ECG, SpO2, Temp" CF on RA; **"Pads" BF on LA** (Jonathan's edit; was "Paddles" B, so MAP is now measured on the pads). AED 200/300/360 J items corrected. This file has stable step ids (saved by the bench). |
| Medical power supply (isolated output), Class I | 8 | `showNA: true`. PE on the AC lead only; PE continuity to the DC output N/A with the reason; mains to DC output/shell insulation ≥1 MΩ; touch leakage 100/500/500; earth 500/1000. |

**Mindray intervals:** EST and all PVT items for the D30/D60 are **once a year**, per service manual ch. 4 (Recommended Frequency). Visual, power-on and user tests are listed for installation or after repair; CHS does them at every PM anyway.

### Template conventions (follow these for new templates)

**Inputs, in order of usefulness**
1. CHS Ansur `.mtt`
2. A completed `.mtr` for that model
3. The service manual's maintenance chapter (latest revision)
4. The manufacturer's PM checklist
5. Jonathan's preferences

**Step order**
Visual, then power-on/system, then the ESA612 sequence (kept contiguous so it runs as one auto sequence), then functional/PVT steps grouped by area.

**EST limits (AS/NZS 3551)**

| Test | Limit |
|---|---|
| PE | ≤0.2 Ω |
| Insulation mains–PE and mains–non-earthed part | ≥1 MΩ |
| Other three insulation tests | recorded |
| Enclosure | 100/500/500 µA |
| Earth leakage | 500/1000 µA |
| Patient leakage B/BF | 100/500 µA |
| Patient leakage CF | 10/50 µA |
| MAP BF | 5000 µA |
| MAP CF | 50 µA |
| MAP for type B | not measured |

**Applied parts**
One group per applied-part type. The first group goes on post RA (CHS Ansur convention), the second on LA.

**When sources disagree**
- AS/NZS 3551 wins for EST; the latest manufacturer manual wins for PVT.
- Note each choice in the template `desc`, and tell Jonathan.

**Item wording and merging**
- Items state the setting and the target.
- Merge Ansur's small containers into one step per area to cut clicks.

**Variants and N/A**
- Use `models` for model families.
- Use `showNA` only where an N/A line must appear in the report.

**Step ids**
Give steps stable ids in template files. Autosave, Reload template and resume all work best when ids don't change between versions.

## 9. Mistakes to avoid (all of these happened)

**Data and storage**
1. **Bumping the IndexedDB version without handling `onblocked`/`onversionchange`** froze the page: nothing could be clicked while an older copy was open in another tab. Any schema bump must keep both handlers. Test with an old-version tab holding the DB (`db-upgrade-blocked.test.js`).
2. **Debounced autosave lost the last click before a refresh.** Save straight away (microtask-coalesced) and also on `pagehide`/`visibilitychange`.
3. **Losing source.** The original split source files were lost in a workspace reset, so the built HTML became the master. Keep everything in git now and never edit only a scratch copy.

**Serial driver and hardware**
4. **Treating late `!21` lines as command replies** caused "IDLE/ENCL/EARTHL: error 21" on a real test. When touching the serial driver, keep skip21, stream draining, the 150 ms gap and expected-reply matching.
5. **Commands the real ESA612 refuses:**
   - `EARTH=` under earth leakage
   - `POL=OFF` to switch the outlet off
   - `AP=` after `MAP=NORM`
   - `MODE=AC` straight after connect
   Check `docs/esa612-protocol-notes.md` before adding any command.
6. **Trusting the simulator too much.** It had a regex bug (`/INS/` matched `MAINS`) that hid a problem. Passing in the simulator is not hardware verification. Always tell Jonathan which behaviour is unverified on the real units.

**Templates and limits**
7. **Overwriting someone's edits.** Jonathan had edited the D30/D60 template in the shared folder (applied parts, hand-typed AED items) before an update was due. Always diff the live SharePoint copy and build on it. Never overwrite it with an older local copy.
8. **Hand-typed limits and Ansur data errors:**
   - AED "200 J between 180 and 200" (should be 180–220 J)
   - the 300 J and 360 J lines labelled "at 200 J"
   - an en dash lost in Ansur data ("280600" should be "280–600")
   - typos copied from Ansur ("stastus", "AGCO", "Auxilary")
   - Ansur limits that differ from the standard: A9 record BF single fault 100 µA, D30/D60 100 J 85–115 J
   Check every limit against the manual and the standard.
9. **Changing a limit silently.** Never do it. Note disagreements and let Jonathan decide. Open questions: BF patient leakage single fault 500 µA (bench) vs 100 µA (A9 Ansur record); whether D30/D60 should keep the measured values.

**Results and reports**
10. **Counting untouched or skipped steps as incomplete** made a finished test show INCOMPLETE. Skipped doesn't count, and finishing offers to skip or stop what's left.
11. **Hiding N/A rows by default dropped a required N/A note** (power supply PE continuity). That's why `showNA` exists.
12. **Encoding:**
    - Ansur `.mtr` is cp1252: substitute Ω→Ohm, ≥/≤→>=/<=, and en dashes in names become hyphens.
    - pdf-lib's Helvetica is WinAnsi, so Ω→Ohm and ≤/≥→max/min. µ is fine.
    - Filenames go through `safeName`.
13. **Applying bench formatting to imported Ansur records.** They must pass through unchanged.

**Browser APIs and UI**
14. **Calling `requestPermission`/`showDirectoryPicker` after a long `await`** loses the user's click (transient activation). Get the folder first, then build the PDF (`Results.save(name, makeBlob)`).
15. **Assuming a deploy worked.** One SharePoint deploy silently left the old file in place. Check the deployed file's checksum after every deploy.
16. **Fake folder handles in tests can't be stored in IndexedDB** (DataCloneError). Real handles can. `Results.cached` keeps the folder in memory as well.
17. **Dialogs with 4 buttons clipped the footer.** It now wraps; keep dialogs to 4 buttons or fewer.

## 11. Open items and backlog

**Hardware and Ansur checks**
- Hardware verification of everything in section 7.
- Run Ansur on the exported `.mtr` and confirm it opens.

**Decisions waiting on Jonathan**
- BF patient leakage single-fault limit: 500 µA (standard) vs 100 µA (A9 Ansur record).
- D30/D60: keep pass/fail only, or bring back measured values for energies?
- ESA612 S/N on reports appears only if `SN` answers. Add a manual S/N setting?
- Optional "next test due" (12 months) on reports.
- Optionally move the HTML next to Templates/Results.

**Housekeeping**
- Delete or rename `Service\Mindray\Test Templates\CHS Test Bench_2.html`.
- Patient auxiliary current isn't supported (dropped from Ansur templates).
- Step photos aren't stored with runs. They come back from the template on resume or restore.


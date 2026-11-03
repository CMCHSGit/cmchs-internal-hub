## Model variants (02/11/2026)
A template can cover several models. Template settings → **Models this template covers** (comma-separated, e.g. `D30, D60`). Each step then has **Applies to** tick boxes; a step limited to some models shows a "D60 only" badge in the builder. When a test starts, the model is taken from the Model device-detail field if it matches (e.g. "D60" or "BeneHeart D60"); otherwise the bench asks which model and fills the Model field. Steps for other models are removed from that test (logged), so they don't appear in the run, summary, PDF or Ansur export; the report shows "Tests for model". JSON import/export and copying steps keep the model settings (`models` on the template and on each step).

**Source note:** the cloud workspace holding the split source files was reset on 02/11/2026. From then on the built `CHS Test Bench.html` is the master source and is edited directly.

## Mindray BeneHeart D30 / D60 Defibrillator template (02/11/2026)
File `Mindray D30-D60 Defibrillator - Test Bench template.json`, one template for both models (`models: D30, D60`), 31 steps (26 for a D30). Built from the CHS Ansur template `0000 - D30-D60 AS-NZS 3551 EST and PVT DD.MM.YYYY Template`, a completed D60 record (FP1-34000106, 22/09/2025) and the BeneHeart D30 (0656B, V1.0) and D60 (0658B, V1.0) service manuals, chapter 4.
- Both models: visual; power-on, user test and recorder; ESA612 auto sequence (mains, PE ≤0.2 Ω, five insulation tests, enclosure 100/500/500 µA, earth 500/1000 µA, patient leakage and MAP) with two applied-part groups — "ECG, SpO2, Temp" type CF on RA and "Paddles" type B on LA (MAP measured for the CF group only); manual defibrillation (typed energies 1 J 0–3, 100 J 90–110, 360 J 324–396 + battery and pads checks); energy disarming; synchronised cardioversion (10 J 8–12 J, delay ≤60 ms); AED (200/300/360 J ±10%); pacing (70 ±1 PPM, 30 ±5 mA, 170 ±2 PPM, 200 ±10 mA); RT impedance 500 ±75; ProSim ECG (HR 59–61, lead off, calibration ≤5%), paced, respiration (19–21 rpm per the manual); SpO2 (95–100%); NIBP (largest difference ≤3 mmHg, leak, overpressure); sidestream CO2 (leak, displayed minus cylinder within ±0.2%); network and battery.
- D60 only (per the manuals, the D30 has none of these): temperature (36.9–37.1 °C), IBP static (198–202 mmHg per the manual) and ART/LV waveforms, mainstream CO2 (43–47 mmHg with 6%), IR ear thermometer / camera / ultrasound.
- Where sources disagree: 100 J limit 90–110 J (manuals; Ansur 85–115); resp ±1 rpm (manuals; Ansur ±2); sidestream CO2 ±0.2% (manuals; Ansur 6.0 ±0.3%); IBP ±2 mmHg (manual and Ansur template; the completed record used ±4); enclosure and earth leakage use AS/NZS 3551 (Mindray's manual: 100/300 µA and 300/1000 µA). Patient auxiliary current left out (the bench can't run it).

## Medical power supply (isolated DC output), Class I template (02/11/2026)
File `Medical power supply (isolated output) - Class I - Test Bench template.json`, 8 steps, for a sealed Class I power supply brick with an isolated (SELV) DC output on a 4-pin metal-shelled DIN plug:
1. Visual inspection (AC lead, brick, DC cable and DIN plug, labels including the "ISO" marking; don't open the brick).
2–3. ESA612: mains voltage, then **AC lead earth continuity** on the cord alone (plug earth to the C13 earth contact, ≤0.2 Ω).
4. Checklist: PC disconnected; earth pin to DC output pins and shell reads open (expected for an isolated output); protective earth continuity to the DC output recorded **N/A** (isolated SELV output, no earth-bonded accessible parts).
5–8. ESA612 auto sequence: insulation mains–PE ≥1 MΩ; insulation mains–DC output and shell ≥1 MΩ (red lead on the linked output pins and shell; the isolation barrier); touch leakage on the output 100/500/500 µA; earth leakage 500/1000 µA (skip either leakage step if the site procedure doesn't need it).
New template setting **Always show N/A items in the report** (`showNA`), on for this template, so the N/A earth-continuity line and its reason appear in the PDF and summary by default.

## Where the master file lives (02/11/2026)
The working copy is `CHS Test Bench.html` in SharePoint/OneDrive: `Cass Medical Limited\Cass & CHS SharePoint - Documents (1)\CMCHS Files\Service\CHS Test Bench.html`. Updates are made to this file and overwrite it in place. (An older copy, `Service\Mindray\Test Templates\CHS Test Bench_2.html`, dated 16/10/2026, is out of date.)
Imported templates and saved tests are kept in each PC's browser (IndexedDB for `file://` pages), not inside the HTML, so overwriting the HTML keeps them; other PCs and other browsers don't see them unless templates are exported/imported as JSON.

## Shared templates folder (02/11/2026)
Templates live as files in `Service\Test Software\CHS Test Bench\Templates\` (SharePoint). The HTML stays at `Service\CHS Test Bench.html`.
- **Shared templates folder** (Templates page) picks the folder once with the browser's folder picker (File System Access API, works on `file://` pages in Chrome/Edge). The handle is remembered in the browser (IndexedDB `kv` store, DB version 2). On later opens the bench loads automatically if the browser still allows it, otherwise a **Load templates** banner on the Run a test page asks for one click.
- Loading reads every `.json` template in the folder and subfolders (files/folders starting with `_`, `.`, `~` and a folder called `Old` are ignored). New files are added, changed files (newer modified time) replace the copy in the browser, deleted files are removed. Results files and invalid JSON are skipped and listed.
- **Ansur `.mtt` / `.mtr` files in the folder are converted automatically** (same converter as Import). Once a converted template is saved back, a `.json` of the same name is written next to it and is used from then on; the Ansur file is never overwritten.
- Templates from the folder show **Shared** in the list. Editing one keeps the change on that PC only ("Shared, changed here") until **Save to shared folder** (banner button, or the upload icon in the template header) writes it back as JSON. Local edits are never overwritten by a newer shared copy; saving then asks whether to keep yours or use the folder's. Any local template can be saved to the folder as a new `.json`. A same-name template imported by hand earlier is replaced by the shared one.
- Deleting a shared template only removes it from that browser; it returns on the next load unless the file is deleted.

## Database upgrade blocked by another tab (02/11/2026)
The shared-folder update raised the browser database to version 2. If another tab on the same PC and browser still has an older copy of the bench open (for example `CHS Test Bench_2.html`), the upgrade waits, and the new tab used to look frozen: nothing clickable, no templates. The bench now shows "Close the other Test Bench tabs" and carries on by itself once they're closed. Each open copy also gives way to a newer one (it stops saving and shows "A newer Test Bench is open" with a Reload button), so future upgrades won't block. This is per PC and browser only: several engineers using the file at once on their own PCs don't affect each other.

## Reports match the Ansur-record layout; Results folder; Reload template (02/11/2026)
**Report layout.** Reports from tests run on the bench now follow the same layout as reports of imported Ansur records (reference: `100176, 100068, 100356 - A9, AG, Sevo 27.10.2026.pdf`). This applies to the summary, Print and the PDF.
- Details are in Ansur order: Serial number, Manufacturer, Model, Location, Customer, Asset # (the CHS asset #), then Testing engineer and Testing company (CHS), Safety analyser (with S/N when the analyser reports one), and Applied parts ("name – type BF").
- Customer asset # appears only when it has been filled in.
- Section titles are title case, and "ECG: paced signals" becomes "ECG – Paced Signals".
- Electrical safety sections use the standard names: Mains Voltage, Protective Earth Resistance, Insulation Resistance, Enclosure Leakage Current, Earth Leakage Current, Patient Leakage Current and Mains on Applied Parts.
- The five insulation steps are combined into one Insulation Resistance section. Rows read "Applied Parts to Protective Earth – <applied parts> (BF)". A template's own wording is kept, for example the PSU's "Mains to DC Output and Shell".
- Mains rows are Live to Neutral / Neutral to Earth / Live to Earth.
- Leakage rows read "Normal Condition", "Open Neutral" and so on. Patient leakage and MAP rows read "Condition – <applied part> (class)".
- Readings without a limit show Pass instead of Recorded. "(lead not zeroed)" is left off the PE row.
- Reports of imported Ansur records are unchanged.
- Applied-part names in the A7/A9 templates are now title case ("Airway Hoses, …").
- Patient leakage limits for single fault conditions stay at the standard 500 µA (BF). The Ansur A9 record used 100 µA for all conditions.
- Reopening a results file now keeps the ESA612 S/N.

**Results folder.** `Service\Test Software\CHS Test Bench\Results`.
- Save PDF, Save results file and the Ansur file (.mtr) all write there, all named `Serial - Model DD.MM.YYYY.pdf/.json/.mtr`.
- If a file with that name already exists, the bench asks whether to replace it or keep both ("(2)").
- **Set-up:** Shared templates folder now asks for the **CHS Test Bench** folder. Templates come from its Templates subfolder and results go to Results (created if missing), with one permission for both.
- **Older set-up:** if the Templates folder itself was chosen, the first save asks for the Results folder once.
- If there's no folder or no permission, the file downloads as before.

**Reload template** (button in the test header and on the summary). Reloads the latest version of the test's template, first checking the shared folder. Everything already recorded is kept:
- Steps are matched by id, then by type and title. Checklist answers are matched by item wording, then by position for reworded items. New items or steps are left to do.
- Readings are re-judged against the latest limits.
- Steps no longer in the template keep their results at the end of the test, unless "Keep those results" is unticked.
- The applied parts used for the test are kept.

## D30/D60 readings as checklist items (02/11/2026)
In the D30/D60 template, every typed reading is now a pass/fail checklist item with its target in the wording, for example "Delivered energy at 100 J (paddles, AC) is between 90 and 110 J". This covers defib energies, sync delay, AED, pacing, RT impedance, the ProSim monitor checks (HR, calibration, resp, temperature, IBP), SpO2, NIBP and CO2. The two sidestream CO2 readings are combined into one item, "Displayed CO2 is within ±0.2% of the cylinder CO2 concentration".

The conversion was built on the shared copy as Jonathan edited it (02/11/2026 2:33 pm):
- Applied parts: "Pads", type BF, on LA, so MAP is now measured for the pads (max 5000 µA).
- AED items typed by hand. Corrected: 200 J limit 180–220 J (was typed as 180–200), and the 300 J and 360 J lines (both said "at 200 J").

## Autosave of the test in progress (02/11/2026)
The test in progress is saved in the browser (IndexedDB `runs`, `inProgress: true`) after every answer, measurement, step change and details edit. Saves happen straight away, not on a timer, and once more when the page is hidden or closed. Nothing is saved until the first step has a result.

When the Test Bench opens and finds one, it asks "Carry on with the unfinished test?" and shows the template, serial/model, steps done and when it was last saved:
- **Carry on** returns to the first step not done. Step photos come back from the template, and the test equipment is reconnected if the browser already knows the ports.
- **Not now** leaves the test under Previous tests, marked "In progress", and the question isn't asked again for it. Open it there and click **Continue test** to carry on.

Finishing or stopping a test clears the in-progress mark.

## Readings finish early (03/11/2026)
The ESA612 settle wait (2 s mains, 3 s earth resistance, 4 s leakage, 5 s insulation) is now a longest time. The bench records as soon as the recent readings have stopped moving (isSteady: 3 or more readings over a 1 s window, 1.5 s for insulation, all within 2 % or a small fixed step: 0.01 Ω, 1 µA, 1 V, 0.05 MΩ; steady over-range counts). A reading still changing waits the full time; Record now still ends it at once. The Log says how long each reading took.

## Details from a customer spreadsheet (03/11/2026)
The start screen can read a customer's equipment spreadsheet (.xlsx, one row per device, headers like Serial Number / Device Model / CHS Asset Number / Ward/Location / Room / Bed / Customer Asset Number) from the synced SharePoint folder, using the same file-handle approach as the shared folder (the handle is kept in IndexedDB key sheetHandle, read-only permission). Find a device, or type/scan its serial or asset number, and the template's details are filled from the row (Sheet.valueFor); the spreadsheet wins over what was there, except Testing engineer. The customer is the file name (editable, key sheetCustomer). Reading is a copy of SimproSync's dependency-free reader (XlsxLite), extended to find red header fonts (the asset list's mandatory columns), sheet by sheet (Retired Assets skipped).

Saving the red columns back (same day): `XlsxLite.write` edits only the touched sheet's XML (`setCells`: inline strings and numbers/date serials, existing cell style kept, a new cell takes the style of the cell above; `<dimension>` and any Excel table/autoFilter `ref` grow) and the table parts, rebuilds the zip copying every other entry's bytes as they were. `Sheet.save` re-reads the file, finds the device row again (same sheet, row and serial/asset keys, else refuses), makes a dated backup (Results\Asset list backups, else a download), builds the new file, reads it back to check (cell values, device count), then writes it with createWritable (atomic). A new device goes under the sheet's last used row (a spare with no serial counts; a stray value more than 50 empty rows away doesn't); it refuses if that row isn't empty. Needs readwrite permission, asked on Start. Tried on a copy of the Waitemata asset list: all 39 zip entries inflate with matching CRCs, the XML is well formed, and Excel opens it with the table extended.

## Shared previous tests and charging after the electrical tests (04/11/2026)
Finished tests are also kept in Firestore (benchTests: a summary line; benchTestData: the run as one JSON string, step photos already stripped by Runner.storedRun) by the hub, on the bench's postMessage (chs-bench:run, sent 1.5 s after a finish, skip-rest or template reload; never for tests in progress, imported from a file/Ansur, or opened from someone else's share: run.sharedBy). The hub sends the list (chs-bench:shared-list, latest 500 by finished time) and answers chs-bench:get-run / delete-run. Previous tests merges this PC's tests with shared ones not on it; Open fetches and stores locally. PDFs and .mtr are rebuilt from the run, not stored.

Power for charging: Runner.chargeAfterTests() calls Power.start(true) at the end of the auto electrical sequence and at finish (not when stopped), unless the setting chargeAfter is off, the ESA612 is not connected, or any ESA step failed; it waits 2.5 s, reads Power.amps, and warns under 0.01 A. Test another device switches the outlet off first.

## ESA612 "REMOTE: error 02: Illegal command" on connecting (04/11/2026)
The ESA612 refuses REMOTE (error 02) while it is still in remote mode from a session that was not closed with LOCAL, which showed as a toast and left the connection in an error state. Devices.connect now answers error 02 with LOCAL, a 0.4 s wait and REMOTE again; any other error (or a second refusal) is reported as before. The simulator has opts.stillRemote to mimic it.

## Both files on save, asking where, and no duplicate tests (04/11/2026)
Save PDF + Ansur file (saveReportFiles) writes both into a folder from showDirectoryPicker (id chs-test-bench-save), else downloads both; Saved reports' download does the same per ticked test and makes a missing PDF (bench message chs-bench:build-pdf, from the results file or the Ansur record) or Ansur record. reports.js: saveReport replaces an older file of the same kind from the same run (same meta.testedAt); groupReports merges groups with the same start time (mergeSameTest: newest of each kind in files, the rest in stale) and gives every test of a serial number the customer of its latest saved test (oneCustomerPerDevice). Reports.jsx removes stale copies with the test.

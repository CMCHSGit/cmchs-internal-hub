# QR codes and barcodes (`/qr/`)

Type or paste text, get a QR code or a Code 128 barcode to download (PNG, SVG) or copy. Service category in
`tools.json` (id `qr`). A section of the hub's one app (`src/section.jsx`, registered like the others in
`apps/hub/src/router.js`, `App.jsx`, `sw.js` and `public/404.html`).

**Nothing leaves the browser.** No upload, no Firestore, no localStorage, no activity-log line: what is typed is never
kept. Keep it that way: staff must not put patient information into shared material (QP33), and `privacy.js` warns when
text looks like an NHI number (warns only; a device serial can look the same).

| File | What it does |
|---|---|
| `src/qr.js` | QR matrix and SVG with `qrcode-generator` (declared by `apps/equipment`, hoisted; this folder has no `package.json` on purpose, because a package file holds a pull request for review). Text goes in as UTF-8 so macrons survive. Four-module quiet zone. |
| `src/code128.js` | Code 128, no library: set B, with runs of 4+ digits in set C. Printable ASCII only, 80 characters at most. `code128Problem` says why a text can't be drawn. |
| `src/privacy.js` | `looksLikeNhi`. |
| `src/download.js` | PNG (SVG painted on a canvas), SVG, copy to the clipboard. Browser only. |
| `src/App.jsx`, `qr.css` | The page. The code is black on white in light and dark: that is what scanners read. |

Tests are in `apps/hub/tests/qr.test.mjs` (that run is the one CI already makes): the symbol table, check symbols worked
by hand, and a round trip through the readers the hub's Scan screens use (ZXing for barcodes, jsQR for QR codes), so a
badly drawn code fails there. `npm test -w apps/hub`.

**Not yet** (ask Jonathan before adding): other barcode types (Code 39, EAN, Data Matrix), a printable sheet of labels
(the demo tracker's `Labels.jsx` does asset labels), batches from a spreadsheet. Asset labels stay in `apps/equipment`:
they encode `labelUrl` addresses that are stuck on devices, which this page must never change.

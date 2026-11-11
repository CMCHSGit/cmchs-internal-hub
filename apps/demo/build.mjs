// Builds /demo/: the old demo tracker's address. The tracker's home is
// /equipment/ (since 19 Oct 2026), and every visit here goes there, keeping the
// query and hash: the old links (?return=, ?extend=, ?reassign=, ?newLoan=,
// ?open=, ?tab=: apps/equipment/src/model.js linkTarget) land where they did,
// and a bare visit (an old bookmark, the home page before 12 Nov) opens the
// tracker. (From 11 to 12 Nov a bare visit showed a "retired" error instead;
// everything pointing at the new tracker was wanted.)
//
// It used to fetch the old tracker's index.html from the chs-equipment repo
// and run it here (with embed.js). To put that back, restore this file and
// embed.js from git history and the old index.html in chs-equipment (tag
// old-tracker-final).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The query names linkTarget reads, for the test that keeps the two in step.
export const OLD_LINK_KEYS = ['return', 'extend', 'reassign', 'newLoan', 'open', 'tab']

export const FORWARD_SCRIPT = `location.replace('/equipment/' + location.search + location.hash)`

export const PAGE = `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Demo tracker · CMCHS Internal Hub</title>
<link rel="icon" type="image/png" href="/brand/logo-mark.png">
<script>${FORWARD_SCRIPT}</script>
<meta http-equiv="refresh" content="0; url=/equipment/">
<style>body{font-family:'Source Sans 3',system-ui,sans-serif;margin:0;padding:24px;color:#1b1b1f;background:#fff}a{color:#4a3a8c;font-weight:600}@media (prefers-color-scheme:dark){body{background:#17171b;color:#eee}a{color:#b9a8ff}}</style>
</head>
<body>
<p>Opening the demo tracker: <a href="/equipment/">internal.chsnz.co.nz/equipment/</a></p>
</body>
</html>
`

// Only write the page when run as the build step, not when a test imports this file.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'index.html'), PAGE)
  console.log('  demo: forwards to /equipment/')
}

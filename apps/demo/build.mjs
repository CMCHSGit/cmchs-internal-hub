// Builds /demo/: since 19 Oct 2026 just a page that forwards to the demo
// tracker's new home in the app, /equipment/, keeping the address's query and
// hash. The tracker there reads the old addresses (?return=, ?extend=,
// ?reassign=, ?newLoan=, ?tab=: apps/equipment/src/model.js linkTarget), so
// bookmarks, emails and notifications sent before the switch still land in
// the right place.
//
// It used to fetch the old tracker's index.html from the chs-equipment repo
// and run it here (with embed.js). To put that back, restore this file and
// embed.js from git history (before the commit that added this note) and
// the old index.html in chs-equipment (tag old-tracker-final).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'index.html'), `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo tracker · CMCHS Internal Hub</title>
<link rel="icon" type="image/png" href="/brand/logo-mark.png">
<script>location.replace('/equipment/' + location.search + location.hash)</script>
<meta http-equiv="refresh" content="0; url=/equipment/">
</head>
<body style="font-family:'Source Sans 3',system-ui,sans-serif;padding:24px">
<p>The demo tracker has moved into the hub: <a href="/equipment/">internal.chsnz.co.nz/equipment/</a>.</p>
</body>
</html>
`)
console.log('  demo: forwards to /equipment/')

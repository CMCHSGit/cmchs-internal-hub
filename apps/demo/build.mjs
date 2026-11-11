// Builds /demo/: the old demo tracker's address, retired. The tracker's home
// is /equipment/ (since 19 Oct 2026).
//
//  - An address that carries one of the old links (?return=, ?extend=,
//    ?reassign=, ?newLoan=, ?open=, ?tab=: apps/equipment/src/model.js
//    linkTarget) still forwards to /equipment/, keeping the query and hash, so
//    emails, bookmarks and reminder pushes sent before the switch keep landing.
//  - A bare visit (no old link) shows an error saying the old demo tracker is
//    retired and where the new one is. Nothing here forwards without a reason:
//    a stale home-screen copy that opens /demo/ must be seen to be out of date.
//
// It used to fetch the old tracker's index.html from the chs-equipment repo
// and run it here (with embed.js). To put that back, restore this file and
// embed.js from git history (before the commit that added this note) and
// the old index.html in chs-equipment (tag old-tracker-final).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep in step with linkTarget's query names.
export const OLD_LINK_KEYS = ['return', 'extend', 'reassign', 'newLoan', 'open', 'tab']

export const FORWARD_SCRIPT = `(function () {
  var keys = ${JSON.stringify(OLD_LINK_KEYS)}
  var q = new URLSearchParams(location.search)
  if (keys.some(function (k) { return q.has(k) })) location.replace('/equipment/' + location.search + location.hash)
})()`

export const PAGE = `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Demo tracker retired · CMCHS Internal Hub</title>
<link rel="icon" type="image/png" href="/brand/logo-mark.png">
<style>
  body{font-family:'Source Sans 3',system-ui,sans-serif;margin:0;padding:24px;color:#1b1b1f;background:#fff}
  main{max-width:34rem;margin:8vh auto 0}
  h1{font-size:1.4rem;margin:0 0 .5rem}
  .err{border-left:4px solid #c8102e;padding:.75rem 1rem;background:#fdf1f3}
  a{color:#4a3a8c;font-weight:600}
  @media (prefers-color-scheme:dark){body{background:#17171b;color:#eee}.err{background:#2a1a1e}a{color:#b9a8ff}}
</style>
<script>${FORWARD_SCRIPT}</script>
</head>
<body>
<main role="alert">
  <div class="err">
    <h1>This demo tracker has been retired</h1>
    <p>The old app you opened no longer saves anything: loans made in it don’t reach the tracker, so they would be lost.</p>
    <p>Use the new one: <a href="/equipment/">internal.chsnz.co.nz/equipment/</a>. If you added the old app to your home screen, delete it and add the new one.</p>
  </div>
</main>
</body>
</html>
`

// Only write the page when run as the build step, not when a test imports this file.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'index.html'), PAGE)
  console.log('  demo: forwards old links to /equipment/, shows a retired error otherwise')
}

// Puts a new version of the Test Bench file (Service\CHS Test Bench.html) into the hub.
//
// The file is copied to apps/testbench/bench/index.html with two changes the hub needs:
//  1. its Google fonts become files kept beside it (apps/testbench/bench/fonts), so it opens with no connection;
//  2. one hook, offerToHub(), so every file it saves (PDF, results file, Ansur record) is also handed up to the hub,
//     which can send it to Simpro (apps/testbench/src/section.jsx).
// Safe to run on a file that already has both. Run from the repo root:
//   node scripts/update-bench.mjs "<path to CHS Test Bench.html>"
// then `npm test --prefix apps/testbench` (it checks both changes are there) and commit: the deploy puts it live.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const src = process.argv[2]
if (!src) { console.error('Usage: node scripts/update-bench.mjs "<path to CHS Test Bench.html>"'); process.exit(1) }
const out = 'apps/testbench/bench'
mkdirSync(out + '/fonts', { recursive: true })
let html = readFileSync(src, 'utf8')
const crlf = html.includes('\r\n'); html = html.replace(/\r\n/g, '\n')
const rep = (a, b) => {
  if (!html.includes(a)) throw new Error('Not found in the bench file (has it changed shape?): ' + a.slice(0, 80) + '\nThe hub\'s hook for this needs updating in scripts/update-bench.mjs.')
  html = html.replace(a, () => b)
}

// 1. Fonts: the Google stylesheet becomes files next to the page (only when the file still asks Google for them).
const gUrl = 'https://fonts.googleapis.com/css2?family=Titillium+Web:wght@400;600;700&family=Source+Sans+3:wght@300;400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap'
if (html.includes(gUrl)) {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' // asks for woff2
  const css = await (await fetch(gUrl, { headers: { 'User-Agent': ua } })).text()
  const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face \{[^}]+\})/g)].filter((m) => /^(latin|latin-ext)$/.test(m[1])) // latin-ext has the macrons
  const files = new Map()
  let fontsCss = '/* The Test Bench\'s fonts, kept here so it opens with no connection (from Google Fonts, SIL Open Font License). */\n'
  for (const [, subset, block] of blocks) {
    const url = block.match(/url\((https:[^)]+\.woff2)\)/)[1]
    if (!files.has(url)) {
      const family = block.match(/font-family: '([^']+)'/)[1].replace(/\s+/g, '')
      const weight = block.match(/font-weight: ([\d ]+);/)[1].replace(/\s+/g, '-')
      const file = `${family}-${weight}-${subset}.woff2`
      writeFileSync(`${out}/fonts/${file}`, Buffer.from(await (await fetch(url)).arrayBuffer()))
      files.set(url, file)
    }
    fontsCss += block.replace(/url\(https:[^)]+\.woff2\)/, `url(fonts/${files.get(url)})`) + '\n'
  }
  writeFileSync(`${out}/fonts.css`, fontsCss)
  console.log('fonts:', files.size, 'files,', blocks.length, 'faces')
  rep(`<link rel="preconnect" href="https://fonts.googleapis.com">\n`, '')
  rep(`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n`, '')
  rep(`<link rel="stylesheet" href="${gUrl}">`, `<link rel="stylesheet" href="fonts.css">`)
}

// 2. Inside the hub (this page is its Test Bench frame), every file the bench saves is also handed up to the hub.
if (!html.includes('function offerToHub(')) {
  rep(`const Results = {\n  supported()`, `/** Inside the hub (this page is its Test Bench frame), hands each saved file up to it, to be sent to Simpro. Alone, does nothing. */
function offerToHub(name, blob) {
  if (window.parent === window) return;
  blob.arrayBuffer().then((buffer) => window.parent.postMessage({ type: 'chs-bench:file', name, mime: blob.type, buffer }, location.origin)).catch(() => {});
}
const Results = {\n  supported()`)
  rep("if (!dir) { download(name, blob); log('in', 'RUN', `Downloaded ${name}`); toast(`Downloaded ${name}`); return; }",
    "if (!dir) { download(name, blob); offerToHub(name, blob); log('in', 'RUN', `Downloaded ${name}`); toast(`Downloaded ${name}`); return; }")
  rep("log('in', 'RUN', `Saved ${out} to the Results folder`); toast(`Saved to Results: ${out}`, 3500);",
    "offerToHub(out, blob); log('in', 'RUN', `Saved ${out} to the Results folder`); toast(`Saved to Results: ${out}`, 3500);")
  rep("download(out, blob); toast('Couldn’t save to the Results folder, so it was downloaded instead', 4500);",
    "download(out, blob); offerToHub(out, blob); toast('Couldn’t save to the Results folder, so it was downloaded instead', 4500);")
}

writeFileSync(`${out}/index.html`, crlf ? html.replace(/\n/g, '\r\n') : html)
console.log('written ' + (html.length / 1024).toFixed(0) + ' KB to ' + out + '/index.html')

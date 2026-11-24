// npm test --prefix apps/testbench — the bench connects the ESA612 / ProSim 8 it already knows when it loads, quietly, and has a
// Power the device button in the header (bench/index.html). Source checks: Web Serial does not run in tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('known devices connect by themselves when the bench loads, and quietly', () => {
  assert.match(html, /navigator\.serial\.addEventListener\('disconnect'[^\n]*\n[^\n]*\n[^\n]*\n\s*setTimeout\(\(\) => Devices\.autoReconnect\(true\), 300\);/, 'started once the page is set up, inside the Web Serial check')
  assert.ok(html.includes('async autoReconnect(quiet) {') && html.includes('await this.reconnect(quiet)') && html.includes('await this.connect(p, false, quiet)'), 'quiet is passed all the way down')
  const connect = html.slice(html.indexOf('async connect(port, simulated, quiet) {'), html.indexOf('async disconnect(key) {'))
  for (const dialogTitle of ['Couldn’t open the port', 'The device didn’t identify itself']) {
    const at = connect.indexOf(`title: '${dialogTitle}'`)
    assert.ok(at > 0, dialogTitle)
    assert.match(connect.slice(Math.max(0, at - 330), at), /quiet/, `${dialogTitle}: skipped when quiet`)
  }
  assert.ok((connect.match(/if \(!quiet\) toast\(/g) || []).length >= 3, 'the toasts are skipped when quiet')
})

test('a test that needs a device still asks and connects as before (not quiet)', () => {
  assert.ok(html.includes('Devices.autoReconnect();'), 'a test beginning')
  assert.ok(html.includes("$('#devReconnect').addEventListener('click', () => Devices.reconnect())"), 'the Reconnect button')
})

test('the header has a Power the device button, kept in step with the others', () => {
  const chips = html.slice(html.indexOf('<div class="devchips">'), html.indexOf('id="chip-esa"'))
  assert.match(chips, /<button class="btn secondary power-btn hdr-power" data-power type="button">Power the device<\/button>/)
  assert.ok(html.includes("$$('[data-power]').forEach(b => {"), 'Power.render updates every [data-power] button')
  assert.ok(html.includes("$$('[data-power]').forEach(b => b.addEventListener('click', () => Power.toggle()))"), 'every one toggles the outlet')
})

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

test('a device the operator took back to local control (front panel key) is taken over again by itself', () => {
  const send = html.slice(html.indexOf('  send(cmd, opts = {}) {'), html.indexOf('/** Start a continuous reading stream'))
  assert.ok(send.includes("const regain = async () => {") && send.includes("expectFor(this.tag, 'REMOTE')"), 'sends REMOTE')
  assert.ok(send.includes('!this.autoRemote') && send.includes('@?(REMOTE|LOCAL|IDENT)'), 'never for the handshake or for REMOTE / LOCAL themselves')
  assert.ok(send.includes("e.code === '00' || e.code === '02' || (e.timeout && a === retries)") && send.includes('!regained'), 'on a refusal or silence, once per command')
  assert.ok(send.includes('this.remoteOkAt = Date.now(); return false;') && send.includes('Date.now() - this.remoteOkAt < 3000'), 'a real error 02 (REMOTE refused: it was in remote all along) is not retried every time')
  assert.ok(html.includes("link.state = 'ready'; link.autoRemote = true;"), 'only once the device is connected and ready')
  assert.ok(html.includes('goLocal() { esaRemote = false; st.local = true; mode = \'LOCAL\'; }'), 'the built-in simulator can be sent back to local control')
})

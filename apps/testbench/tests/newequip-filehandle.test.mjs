// npm test --prefix apps/testbench — remembering a chosen asset list file (src/newequip/filehandle.js), with made-up handles.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memoryHandles, ensureRead, readRemembered } from '../src/newequip/filehandle.js'

const handle = ({ query = 'granted', request = 'granted', file = { name: 'a.xlsx' }, throws = null } = {}) => ({
  asked: [],
  async queryPermission(o) { this.asked.push('query:' + o.mode); return query },
  async requestPermission(o) { this.asked.push('request:' + o.mode); return request },
  async getFile() { if (throws) throw throws; return file },
})

test('the store keeps one handle per customer and forgets it when asked', async () => {
  const s = memoryHandles()
  assert.equal(await s.get('c1'), null)
  await s.put('c1', { a: 1 })
  assert.deepEqual(await s.get('c1'), { a: 1 })
  assert.equal(await s.get('c2'), null)
  await s.remove('c1')
  assert.equal(await s.get('c1'), null)
})

test('only read access is ever asked for, and the person is asked only when it is not already given', async () => {
  const granted = handle()
  assert.equal(await ensureRead(granted), true)
  assert.deepEqual(granted.asked, ['query:read'])
  const prompt = handle({ query: 'prompt' })
  assert.equal(await ensureRead(prompt), true)
  assert.deepEqual(prompt.asked, ['query:read', 'request:read'])
  assert.equal(await ensureRead(handle({ query: 'prompt', request: 'denied' })), false)
  assert.equal(await ensureRead(null), false)
})

test('a remembered file is read as it is now; a refusal, a move or a failure is said in words', async () => {
  assert.deepEqual(await readRemembered(handle({ file: { name: 'Example.xlsx' } })), { file: { name: 'Example.xlsx' } })
  assert.match((await readRemembered(handle({ query: 'prompt', request: 'denied' }))).error, /didn’t give access/)
  const gone = await readRemembered(handle({ throws: Object.assign(new Error('x'), { name: 'NotFoundError' }) }))
  assert.match(gone.error, /moved or deleted/)
  assert.equal(gone.gone, true)
  assert.match((await readRemembered(handle({ throws: new Error('locked') }))).error, /locked/)
})

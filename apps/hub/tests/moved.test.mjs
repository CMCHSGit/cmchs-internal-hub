import { test } from 'node:test'
import assert from 'node:assert/strict'
// router.js listens for popstate on load, so give it a window to listen on.
globalThis.window ??= { addEventListener() {}, location: { pathname: '/', hash: '', search: '' } }
const { movedTo } = await import('../src/router.js')

test('the activity log has its own Settings page; old links to it forward there', () => {
  assert.equal(movedTo('/admin/', '#activity'), '/settings/activity')
  assert.equal(movedTo('/schedule/settings', '#activity'), '/settings/activity')
  assert.equal(movedTo('/schedule/settings/', '#activity'), '/settings/activity')
})

test('the schedule settings tabs that stayed still forward to the schedule settings', () => {
  assert.equal(movedTo('/admin/', '#excel'), '/settings/schedule#excel')
  assert.equal(movedTo('/admin/', '#locations'), '/settings/schedule')
  assert.equal(movedTo('/schedule/settings', '#excel'), '/settings/schedule#excel')
  assert.equal(movedTo('/schedule/settings', ''), '/settings/schedule')
  assert.equal(movedTo('/admin/', '#notifications'), '/settings/notifications')
  assert.equal(movedTo('/admin/', ''), '/settings/people')
  assert.equal(movedTo('/schedule/my', ''), null)
})

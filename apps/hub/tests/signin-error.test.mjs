// npm test -w apps/hub — what the sign-in page says when sign-in fails (signin-error.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GENERAL, signInError } from '../src/signin-error.js'

test('a failure with no words of its own shows the general message and its code', () => {
  assert.deepEqual(signInError({ code: 'auth/invalid-credential', message: 'Firebase: something (auth/invalid-credential).' }),
    { text: GENERAL, code: 'auth/invalid-credential' })
  assert.deepEqual(signInError({ code: 'auth/internal-error' }), { text: GENERAL, code: 'auth/internal-error' })
})

test('known failures keep their own words and show no code', () => {
  assert.deepEqual(signInError({ code: 'auth/popup-blocked' }).code, null)
  assert.match(signInError({ code: 'auth/popup-blocked' }).text, /pop-ups/)
  assert.match(signInError({ code: 'auth/network-request-failed' }).text, /connection/)
})

test('closing the Microsoft window, or clicking twice, says nothing', () => {
  assert.equal(signInError({ code: 'auth/popup-closed-by-user' }), null)
  assert.equal(signInError({ code: 'auth/cancelled-popup-request' }), null)
})

test('an error with no code still says something, and never shows its message', () => {
  assert.deepEqual(signInError(new Error('Sign-in is not configured for this build.')), { text: GENERAL, code: 'no-code' })
  assert.deepEqual(signInError(undefined), { text: GENERAL, code: 'no-code' })
  assert.deepEqual(signInError({ code: '' }), { text: GENERAL, code: 'no-code' })
  // A key on every object is not a known code
  assert.deepEqual(signInError({ code: 'toString' }), { text: GENERAL, code: 'toString' })
})

// What the hub's sign-in page (SignIn.jsx) says when "Sign in with Microsoft" fails.
//
// A failure it doesn't recognise also shows the error's code ("auth/…"), so a
// screenshot of the page says what went wrong instead of only "Sign-in didn't work".
// The code is Firebase's name for the failure, never anything about the person.

const KNOWN = {
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'auth/popup-closed-by-user': null, // they closed the window: nothing to say
  'auth/cancelled-popup-request': null, // a second click while the window was open
  'auth/network-request-failed': 'Couldn’t reach Microsoft. Check your connection and try again.',
}

export const GENERAL = 'Sign-in didn’t work. Use your Cass Medical Microsoft 365 account, or call the office.'

/** { text, code } for the page, or null when there is nothing to show. `code` is set only for a failure the page has no words for. */
export function signInError(e) {
  const code = typeof e?.code === 'string' && e.code ? e.code : null
  if (code && Object.hasOwn(KNOWN, code)) return KNOWN[code] ? { text: KNOWN[code], code: null } : null
  return { text: GENERAL, code: code || 'no-code' }
}

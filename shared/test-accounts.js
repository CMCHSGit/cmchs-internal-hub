/* Made-up staff for the test copy (`npm run dev:emulators`, README "Test copy").
   They exist only in the Firebase emulators on this computer, never in the live
   sign-in, so the shared password below opens nothing real. One per kind of
   access, so each screen can be checked as the people who use it.

   Used by the sign-in page's "Sign in as" list (test copy only) and by
   scripts/emulator-seed.mjs, which creates them. */

export const TEST_PASSWORD = 'test-copy-only'

export const TEST_ACCOUNTS = [
  { uid: 'test-admin', name: 'Alex Admin', email: 'alex.admin@cass.co.nz', team: 'Management', role: 'admin', trackerRole: 'service', about: 'Admin (Management team)' },
  { uid: 'test-hr', name: 'Harper Hr', email: 'harper.hr@cass.co.nz', team: 'Admin', role: 'user', hr: true, about: 'HR (Admin team)' },
  { uid: 'test-eng', name: 'Eli Engineer', email: 'eli.engineer@cass.co.nz', team: 'Engineers', role: 'user', trackerRole: 'service', about: 'Engineer, Service & Projects in the tracker' },
  { uid: 'test-eng2', name: 'Erin Engineer', email: 'erin.engineer@cass.co.nz', team: 'Engineers', role: 'user', about: 'Engineer' },
  { uid: 'test-sales', name: 'Sam Sales', email: 'sam.sales@cass.co.nz', team: 'Sales', role: 'user', trackerRole: 'am', about: 'Sales, account manager in the tracker' },
  { uid: 'test-apps', name: 'Ari Applications', email: 'ari.apps@cass.co.nz', team: 'Application', role: 'user', trackerRole: 'am', about: 'Applications specialist' },
  { uid: 'test-new', name: 'Noa New', email: 'noa.new@cass.co.nz', team: '', role: 'user', about: 'Signed in, no team set yet' },
]

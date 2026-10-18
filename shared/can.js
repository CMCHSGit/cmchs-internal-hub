/* What someone may do, from their hub record (users/{uid}): one check, in
   place of the demo tracker's admin password and its hard-coded names (step
   5A, STEP-5-PLAN.md). The Firestore rules make the same checks
   (rules/firestore.rules), so a button hidden here is also refused there.

   NOT USED YET: the tracker moves onto it at step 5's switch-over, where it
   asks for the admin password today (checkAdmin in apps/equipment/src/store.jsx:
   deleting an item, a loan or retired items, a stocktake, an import, Simpro
   job creation on) and where it names the test-mode people (App.jsx,
   Manage.jsx). An admin just confirms; anyone else doesn't see the button. */

const ACTIONS = {
  // Deleting items, loans and retired items for good; import; stocktake;
  // turning Simpro job creation on.
  'equipment.admin': (p) => p.role === 'admin',
  // Test mode (loans that make no Simpro jobs, hidden from everyone else):
  // admins, and anyone an admin marks as a tester (users.trackerTester), in
  // place of the two names written into the tracker.
  'equipment.testMode': (p) => p.role === 'admin' || p.trackerTester === true,
}

/** Whether the person with this hub record may do it. No record, or one not finished signing in: no. */
export function can(profile, action) {
  const rule = ACTIONS[action]
  if (!rule) throw new Error('can(): no such action, ' + action)
  return !!profile && profile.pending !== true && rule(profile)
}

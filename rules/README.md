# Database rules

The security rules for both Firebase databases behind internal.chsnz.co.nz.
They moved here on 16 Oct 2026 from the repos they grew up in (step 1 of
`INTEGRATION-PLAN.md`); their earlier history is in those repos.

| File | Database | Was |
|---|---|---|
| `firestore.rules` | Firestore in the staff schedule's Firebase project: `users`, `schedules`, `oncall`, `locations`, `activity`, `maintenance`, `serviceOrders`, `project*`, People, Manage (news, tool requests, feedback), `asks` | `cmchs-staff-schedule/firestore.rules` |
| `database.rules.json` | Realtime Database in the `chs-equipment` project: the demo tracker | `chs-equipment/database.rules.json` |

## Publishing: a push does NOT do it

Rules go live only when someone with access pastes them into the Firebase
console: Firestore → Rules, or Realtime Database → Rules, then Publish.

- **Paste the whole file, never a single block.** Publishing replaces every
  rule; a partial paste deletes the rest.
- **Say so in the commit** when a change needs publishing ("not yet
  published"), and add it to the to-do list until it is.
- **Ask before publishing a change people would notice** (anything that can
  stop someone reading or saving).

## Testing

`tests/` runs the real rules engine (the Firestore emulator), not a mock. It
needs Java. From an empty folder outside the repo:

```
npm i firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10
```

then, with a `firebase.json` of
`{"emulators":{"firestore":{"host":"127.0.0.1","port":8085}}}` beside it:

```
npx firebase emulators:exec --only firestore --project rules-test "node <path to>/rules/tests/firestore-rules.test.mjs"
```

The tests read `../firestore.rules` relative to themselves, so the copy here is
always the one tested.

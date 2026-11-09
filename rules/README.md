# Database rules

The security rules for both Firebase databases behind internal.chsnz.co.nz.
They moved here on 16 Oct 2026 from the repos they grew up in (step 1 of
`INTEGRATION-PLAN.md`); their earlier history is in those repos.

| File | Database | Was |
|---|---|---|
| `firestore.rules` | Firestore in the staff schedule's Firebase project: `users`, `schedules`, `oncall`, `locations`, `activity`, `maintenance`, `serviceOrders`, `checklists` (27 Oct 2026), `project*`, People, Manage (news, tool requests, feedback), `asks` (9 Nov 2026: files on an ask, `asks/{id}/files` and their parts, NOT YET PUBLISHED), `pendingAssets` (6 Nov 2026: assets recorded on the new-equipment page; 9 Nov 2026: a recorded asset can be edited; NOT YET PUBLISHED), `benchOrders` and an `order` field on `benchTests` (6 Nov 2026: the Test Bench's Orders, published 6 Nov 2026), `kbArticles`, `kbParts`, `kbDevices`, `kbJobs` and `users/{uid}.kbEditor` (6 Nov 2026: the Knowledge base, NOT YET PUBLISHED); and, not used until step 5's cutover, the demo tracker (`equipment`, `retiredEquipment`, `loans`, `equipmentHistory`, `equipmentAudit`, `equipmentKits`, `settings/equipment`, `tileLocations`) | `cmchs-staff-schedule/firestore.rules` |
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

`database.rules.json` was first published on 20 Oct 2026; until then the
Realtime Database was open to anyone. Before publishing it, `checkDatabaseAuth()`
(proxy) and `checkBackupDatabaseAuth()` (backup) both said READY, and Tile sync's
`CHS_EQUIPMENT_SERVICE_ACCOUNT` secret was set. An unsigned read now gets 401.

## Testing

**Automatic:** the workflow `.github/workflows/rules-tests.yml` runs every test
file on the emulator whenever `rules/`, the tracker's code (`apps/equipment/src/`)
or the workflow changes, and shows a green or red tick on the commit. It does not
publish anything and does not stop the site deploying. **On your computer** (needs
Java; run `npm ci` once at the repo root as well, for the tracker data-layer test):

```
cd rules
npm ci
npm test
```

(`rules/package.json` holds the test tools, kept apart from the hub's own install.
On Windows, see the Java "loopback" note below if the emulator stops at once.)

The manual way, which still works, is:

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

On Windows, if the emulator stops at once with "Fatal error" and
`firestore-debug.log` says "Unable to establish loopback connection", give
Java a short folder for its internal pipe first:
`JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:/Users/<you>/.uds"` (any
existing folder).

The tests read `../firestore.rules` relative to themselves, so the copy here is
always the one tested.

`firestore.rules` with the home page layout (`users/{uid}.homeLayout`, the Customise button on the home page) was published on 23 Oct 2026.
`firestore.rules` as of commit `f4a48f3` (the tracker's collections, `settings/equipmentCutover`, `tileLocations`, Checklists) was published on 29 Oct 2026, reported by Jonathan in chat.
`firestore.rules` with the tightened `activity` rule (the hub-wide activity log: the time must be the server's, only these fields, a line of at most 500 characters) is **not yet published**. The log works without it (the old rule accepts every line the apps now write); publish it to stop a person backdating or padding a line.
`firestore.rules` with files on asks (`asks/{id}/files/{fid}` and its `parts`, `fileCount` on an ask, `fileIds` on a comment) is **not yet published**. Until it is, Asks refuses an ask or comment with a file attached ("Missing or insufficient permissions"); everything without a file works as before.

`firestore.rules` with `benchTests` and `benchTestData` (the Test Bench's shared previous tests) was published on 4 Nov 2026, reported by Jonathan in chat. Tested in the emulator: `tests/bench-rules.test.mjs`.

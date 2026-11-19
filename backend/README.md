# Back end

The parts of the site that aren't web pages. They moved here from the
`chs-equipment` repo on 16 Oct 2026, with their git history (INTEGRATION-PLAN.md
step 1). Their earlier history is reached through the merge commits that brought
them in (`git log --oneline 0798b65^2` for the proxy).

| Folder | What | Runs |
|---|---|---|
| `apps-script/proxy/` | The Apps Script web app every tool calls (`shared/proxy.js`): the demo tracker's database pass (`rtdbToken`), Simpro (`simproSync`, the tracker's job create/update/close), pushes (`notifyHubRequest`, `notifyAsk`, `testPush`), and the demo tracker's reminder timers | Google, as a web app |
| `apps-script/backup/` | Nightly 3am backup to Google Drive: the demo tracker (a spreadsheet, and its whole database as JSON to restore from), the project tracker, Asks, and the hub's activity log (a spreadsheet a month, and a JSON file a night; kept for good) | Google, on a timer |
| `apps-script/news-inbox/` | Every 10 minutes: the weekly team update email, saved to a Drive folder by a Power Automate flow, into Manage → News as drafts to check (`newsInbox`) | Google, on a timer |
| `tile-sync/` | Daily Tile tracker locations into the demo tracker's database | GitHub Actions, `.github/workflows/tile-sync.yml` |

Secrets are never here: the Simpro key and the service-account key are Apps
Script **Script Properties**; Tile's login and the chs-equipment service account
are this repo's **Actions secrets**. The repo is public.

## Apps Script: `clasp push` does NOT make code live

Pushing only updates the project's source. The `/exec` address keeps serving the
deployment version last cut, so a pushed fix isn't running until it is deployed.
This has bitten twice. And the other way round: deploying from a checkout that is
behind GitHub ships without fixes that are already merged.

So, every time:

```bash
git pull                                   # this repo, right before
cd backend/apps-script/proxy
npx clasp push --force                     # --force: a non-interactive shell skips the overwrite prompt
npx clasp deploy -i AKfycbzKLt_IP3GPRiNQkYkCep-_Yee06rDwc3uJGnQQuzjVuCSJOImJnaqDgU-3W3q9Y4OHUw
```

`-i` keeps the same `/exec` address (`shared/proxy.js`). The proxy is at
deployment **@61**. Then check what is actually live:

```bash
PROXY="https://script.google.com/macros/s/AKfycbzKLt_IP3GPRiNQkYkCep-_Yee06rDwc3uJGnQQuzjVuCSJOImJnaqDgU-3W3q9Y4OHUw/exec"
curl -s -L "$PROXY"                                        # {"status":"CHS Simpro Proxy is live"}
```

The backup isn't a web app, so it has no deployment: `npx clasp push --force`
from `apps-script/backup/` is enough, then run `checkProjectsBackup()` in the
editor. A new timer or new permissions need `setupBackups()` run once in the
editor and approved.

The longer story (Script Properties, the IAM roles push needs, how SimproSync
batches calls) is in `chs-equipment/PROJECT-CONTEXT.md` §2–§3.

## Background jobs page

Settings → Background jobs (admins only) lists every timed job and how its last
run went. The list is `shared/jobs.js`; each job writes one document,
`jobRuns/{id}`, when it finishes, and the page reads them. Counts and plain
words only, never names.

- **GitHub workflows:** the last step runs `scripts/report-job.mjs <id> <job status>`
  (the deploy workflow has a final `report` job). A workflow skipped by its `if:`
  reports nothing and shows as "No report yet" or "Overdue". A dry run reports nothing.
- **Apps Script:** `reportJob_(id, ok, message)` in the backup and the proxy; the proxy's
  timers go through `trackJob_`. New permissions: none (same service account).
- **The PC (Excel copies):** `apps/schedule/scripts/jobStatus.mjs`, with the same Firebase key.
- **Adding a job:** add it to `shared/jobs.js` (with how long it may stay quiet), and make it
  report under the same id.
- **Rules:** `jobRuns` is admin-read and has no client writes (`rules/firestore.rules`; must be
  published). The writers are service accounts, which the rules don't apply to.

## News inbox

The weekly team update email reaches Manage → News without anyone pasting it,
forwarding it or asking the writer for anything. No Gmail, and no IT or Microsoft
admin is involved:

1. A **Power Automate** flow in the receiver's own Outlook ("When a new email
   arrives", from the writer, with the usual subject) saves the email's body as an
   `.html` file in a Google Drive folder of `internal@cass.co.nz` (the Google
   account that owns the scripts). Nothing is forwarded, so Exchange's block on
   automatic forwarding doesn't apply.
2. `apps-script/news-inbox/`, running as that account, checks the folder every 10
   minutes. It saves each new `.html` / `.txt` file to `newsInbox/drive-<file id>`
   and moves the file into the folder's `Imported` subfolder.
3. Manage → News shows "The team update email arrived" with **Make drafts** (Paste an
   email, already split) and **Put away**. Nothing is posted until a person presses
   Post.

Who can put a file in the folder is who can send news drafts, so keep the folder
private to that account. It is its own Apps Script project, not part of the proxy, so
the public `/exec` web app never has Drive access. Pictures inside the email are
dropped (the splitter doesn't use them). A forwarded email splits from what was
forwarded. Logs and the Background jobs page give counts only.

### Setting it up (once)

**A. The Drive folder** (signed in to Google as `internal@cass.co.nz`)

1. drive.google.com → New → New folder → `Hub news inbox`. Don't share it.
2. Open it. Its address is `https://drive.google.com/drive/folders/<id>`: copy the
   `<id>` part.

**B. The script** (same account, at script.google.com)

1. Make the project: New project, name it `CMCHS Hub news inbox`. Paste in
   `Code.js`. In Project Settings, tick "Show appsscript.json", then paste that file
   over the editor's `appsscript.json`. If an earlier Gmail version was pasted, replace
   both files whole. (With clasp signed in as that account:
   `npx clasp create --type standalone --title "CMCHS Hub news inbox" --rootDir .` then
   `npx clasp push --force` from this folder, and commit the `.clasp.json`.)
2. Script Properties (Project Settings → Script properties):
   - `NEWS_INBOX_FOLDER_ID`: the folder id from A2.
   - `FIREBASE_SERVICE_ACCOUNT_KEY`: copy the whole value of the proxy's
     `FCM_SERVICE_ACCOUNT_KEY` (same key). Never paste it anywhere else.
   - `FIREBASE_SCHEDULE_PROJECT_ID`: only if not `cmchsstaffschedule`.
   - Delete `NEWS_INBOX_TO` / `NEWS_INBOX_FROM` if they were added for the Gmail
     version. They are no longer used.
3. Choose `setupNewsInbox` in the function menu and press **Run**. Approve the
   permissions (Drive, external requests, timers). On "Google hasn't verified this
   app": Advanced → Go to CMCHS Hub news inbox (it's your own script). It makes the
   `Imported` subfolder and the 10-minute timer.

**C. The rules:** paste the whole of `rules/firestore.rules` into Firebase console →
cmchsstaffschedule → Firestore → Rules → Publish (`match /newsInbox`). Until then
Manage simply doesn't show the card.

**D. The flow** (make.powerautomate.com, signed in with your own Microsoft account,
the one that receives the weekly email)

1. Create → **Automated cloud flow**. Name it `Team update to the hub`. Trigger:
   **When a new email arrives (V3)** (Office 365 Outlook) → Create.
2. In the trigger, open **Show all** (advanced parameters):
   - Folder: `Inbox`.
   - From: the writer's address. Add more, separated by `;`, if someone covers for them.
   - Subject Filter: a phrase that is always in the subject. The match is "contains",
     not case sensitive.
   - Include Attachments: No.
3. **+ New step** → search "Google Drive" → **Create file**. Sign in as
   `internal@cass.co.nz` when it asks, and allow access.
   - Folder path: pick `/Hub news inbox` with the folder icon.
   - File name: in the **Expression** tab, paste
     `concat(replace(triggerOutputs()?['body/subject'], '/', '-'), '.html')`
     (the subject, with any `/` made safe, plus `.html`).
   - File content: **Body** from the trigger's dynamic content.
4. **Save.** If Power Automate refuses because of a "data loss prevention" (DLP)
   policy, the company blocks Outlook-to-Google flows. Fall back to "Paste an
   email", or ask IT.

**E. Check**

1. To test before the real email: add your own address to the trigger's From
   (`writer@…;you@…`), save, and send yourself an email with the subject phrase in
   its subject. Take your address out again afterwards. Or just wait for the real one.
2. A `.html` file appears in the folder within a minute or two.
3. In the script editor, run `checkNewsInbox`. It says "Firestore key works" and
   counts what's waiting, changing nothing.
4. Within 10 minutes the file moves to `Imported`. Manage → News shows the card, and
   Settings → Background jobs shows "Team update email". Put a test away with **Put
   away**.

**Changing the code:** paste the new `Code.js` into the editor (or `git pull`, then
`npx clasp push --force` from `apps-script/news-inbox/`). It isn't a web app, so there
is no `clasp deploy`: the next run uses the new code. New permissions in
`appsscript.json` need `setupNewsInbox` run and approved again. **To stop it:** turn the
flow off, or delete the script's trigger (the clock icon in the editor). **To bring a
file in again:** move it back out of `Imported`.

## Tile sync

Runs daily at 07:00 NZST once the repository variable `TILE_SYNC_HERE` is
`true`; a manual run from the Actions tab always works. Needs the secrets
`TILE_EMAIL`, `TILE_PASSWORD`, `CHS_EQUIPMENT_SERVICE_ACCOUNT` (the
chs-equipment project's service-account JSON, for the old Realtime Database) and
the staff schedule's `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
(already set: the Thursday reminder uses them), for Firestore.

**It writes where the tracker reads.** It reads `settings/equipmentCutover` in the hub's
Firestore: while the tracker is on the old database it writes `/tileLocations` there, as
before; once the switch says `firestore` it writes Firestore's `tileLocations/{tileNo}`
(each tile set whole, tiles no longer on the account removed, nothing removed if
the fetch found none). If the switch can't be read it stays on the old database.
A manual run has a `target` choice: `both` fills Firestore ahead of the cutover.
The Firestore side is `hub_firestore.py` (tests: `python -m unittest test_hub_firestore`
in this folder, also run by the workflow). The tracker shows the places in the
Equipment list and an item's record (`readTiles` in `apps/equipment/src/db.js`).
Logs give counts only.

## `tracker-migration/`: the demo tracker into Firestore

Step 5B of `STEP-5-PLAN.md`: copies the tracker's Realtime Database into the
hub's Firestore, run by hand (`node migrate.mjs`, a dry run unless `--write`).
It needs service-account keys for both projects, given as paths in `HUB_SA`
and `CHS_SA`; keep the key files outside the repo and delete them after. It
prints counts only.

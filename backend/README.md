# Back end

The parts of the site that aren't web pages. They moved here from the
`chs-equipment` repo on 16 Oct 2026, with their git history (INTEGRATION-PLAN.md
step 1). Their earlier history is reached through the merge commits that brought
them in (`git log --oneline 0798b65^2` for the proxy).

| Folder | What | Runs |
|---|---|---|
| `apps-script/proxy/` | The Apps Script web app every tool calls (`shared/proxy.js`): the demo tracker's database pass (`rtdbToken`), Simpro (`simproSync`, the tracker's job create/update/close), pushes (`notifyHubRequest`, `notifyAsk`, `testPush`), and the demo tracker's reminder timers | Google, as a web app |
| `apps-script/backup/` | Nightly 3am backup to Google Drive: the demo tracker (a spreadsheet, and its whole database as JSON to restore from), the project tracker, Asks, and the hub's activity log (a spreadsheet a month, and a JSON file a night; kept for good) | Google, on a timer |
| `apps-script/news-inbox/` | Every 10 minutes: the weekly team update email, Bcc'd to a Gmail address, into Manage → News as drafts to check (`newsInbox`) | Google, on a timer |
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

The weekly team update email reaches Manage → News without anyone pasting it.
Whoever writes it adds one address in **Bcc**; `apps-script/news-inbox/` reads
that Gmail every 10 minutes and saves new ones to `newsInbox/{id}`; Manage → News
shows "The team update email arrived" with **Make drafts** (Paste an email, already
split) and **Put away**. Nothing is posted until a person presses Post. No IT or
Microsoft admin is involved: a Bcc is an ordinary recipient, not a forward.

It is its own Apps Script project, not part of the proxy, so the permission to read
the mailbox is never held by the public `/exec` web app. It runs as the Google
account that owns it and reads only that account's Gmail: use the account that owns
the backup script (it already has the service-account key).

**What it brings in:** mail delivered to `NEWS_INBOX_TO`, from an address in
`NEWS_INBOX_FROM`, in the last 14 days, not labelled `hub-imported`, and not failed by
Gmail's sender check (`dmarc=fail`). Every message it looks at gets the label, whatever
happened; take the label off in Gmail to have one looked at again. Pictures inside the
email are dropped (the splitter doesn't use them). Logs and the Background jobs page
give counts only.

### Setting it up (once)

1. **Make the project**, signed in to clasp as that Google account
   (`npx clasp login` if it isn't). The Apps Script API must be on at
   script.google.com/home/usersettings.
   ```bash
   git pull
   cd backend/apps-script/news-inbox
   npx clasp create --type standalone --title "CMCHS Hub news inbox" --rootDir .
   npx clasp push --force
   ```
   Commit the `.clasp.json` it makes (the script id isn't a secret; the others are
   committed too). Without clasp: script.google.com → New project, paste `Code.js`;
   Project Settings → tick "Show appsscript.json" and paste that file too.
2. **Script Properties** (the project → Project Settings → Script properties):
   - `NEWS_INBOX_TO`: that account's address with `+hubnews` before the `@`
     (Gmail delivers `name+hubnews@…` to `name@…`).
   - `NEWS_INBOX_FROM`: who may send it, comma-separated: the writers' addresses,
     or `@cass.co.nz` for anyone at the company.
   - `FIREBASE_SERVICE_ACCOUNT_KEY`: copy the value from the backup project's
     Script Properties (same key). Never paste it anywhere else.
   - `FIREBASE_SCHEDULE_PROJECT_ID`: only if not `cmchsstaffschedule`.
3. **Run `setupNewsInbox`** in the editor (function menu → Run). Google asks for
   permission: Gmail (read and label), external requests, timers. On "Google hasn't
   verified this app": Advanced → Go to CMCHS Hub news inbox (it's your own script).
   It makes the `hub-imported` label and the 10-minute timer.
4. **Publish the rules:** paste the whole of `rules/firestore.rules` into Firebase
   console → cmchsstaffschedule → Firestore → Rules → Publish (`match /newsInbox`).
   Until then the card can't be read and Manage simply doesn't show it.
5. **The writer** adds the `+hubnews` address in Bcc of the weekly email (Bcc so
   nobody's reply-all goes there). Saving it in their Outlook contacts makes it one
   click.
6. **Check:** send a short test from an allowed address with the Bcc. Run
   `checkNewsInbox` in the editor: it says what is waiting and changes nothing. Within
   10 minutes Manage → News shows the card; Settings → Background jobs shows "Team
   update email". Put the test away.

Optional: a Gmail filter on that account (To: the `+hubnews` address → Skip the
Inbox) keeps its inbox tidy; the script finds the mail either way.

**Changing the code:** `git pull`, then `npx clasp push --force` from
`apps-script/news-inbox/`. It isn't a web app, so there is no `clasp deploy`: the next
run uses the new code. New permissions in `appsscript.json` need `setupNewsInbox` run
and approved again. **To stop it:** delete its trigger (the clock icon in the editor)
or clear `NEWS_INBOX_TO`.

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

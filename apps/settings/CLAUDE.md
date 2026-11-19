# Settings and notifications — read this before changing either

Claude loads this file when working under `apps/settings/`. It covers **the Settings section** (`/settings/`) and **every way
the hub tells someone something**, across all sections, because the on/off switches live here. It was mapped from the code on
20 Nov 2026: function and file names are stable, so search for them rather than trusting a line number. More detail:

- `README.md` (repo root), **Settings: one place for every setting** — what people see, and the recipe for a tool's notifications.
- `INTEGRATION-PLAN.md`, **The goal** — what "one Settings area" and "Notifications" are meant to become (not all built: see Gaps).
- `STEP-5-PLAN.md`, **5D** — the demo tracker's pushes. Its table predates the switch to `/equipment/` and `users.trackerRole`.
- `backend/apps-script/proxy/Code.js` — most senders. Proxy changes need `clasp push` **and** `clasp deploy -i <id>` (`backend/README.md`).

## The Settings section

A section of the hub's one app: `apps/hub/src/App.jsx` lazy-loads `src/section.jsx` (prefix in `apps/hub/src/router.js`
`SECTIONS`). `src/App.jsx` wraps the schedule's `AuthProvider` round a `BrowserRouter basename="/settings"`. Ways in: the header
gear (wide screens), the account menu, the phone's More sheet, Ctrl+K (`apps/hub/src/search.js`).

| Group | Path | Screen | Who |
|---|---|---|---|
| You | `/` (phone: `/` lists the pages, `/appearance` is the page) | `src/You.jsx` `Appearance`: light / dark / match this device, start page | anyone |
| You | `/you/notifications` | `src/You.jsx` `MyNotifications`: "This phone" (turn on), own switches (`MINE`) | anyone |
| Admin | `/people` | `apps/admin/src/Admin.jsx` `UsersTab`: team, role, Simpro access, KB editor, demo tracker role | `AdminOnly` |
| Admin | `/notifications` | `Admin.jsx` `NotificationsTab`: everyone's switches and device counts | `AdminOnly` |
| Admin | `/jobs` | `src/Jobs.jsx`: each timed job's last run (`jobRuns`, list and staleness in `shared/jobs.js`) | `AdminOnly` |
| Admin | `/activity` | `src/ActivityLog.jsx`: the whole hub's activity log | `AdminOnly` |
| Sections | `/schedule` | `apps/schedule/src/pages/Settings.jsx`: locations, `#excel` import | its own role + password check |
| Sections | `/projects` | `apps/projects/src/settings-page.jsx` → the tracker's settings view (`projectSettings/main`) | see; edit if on a team or admin |
| Sections | `/maintenance` | `apps/maintenance/src/PmTypes.jsx` (`maintenance/_settings`) | see; edit admin or Engineers/Management |

**Adding a page** touches three places in `src/App.jsx` that must stay in step: a `lazy()` import, a `PAGES` entry, and a
`<Route>` that picks its entry **by position** (`PAGES[n]`): inserting in the middle shifts every later index. Add it to Ctrl+K
(`apps/hub/src/search.js`; Background jobs has no entry yet). Old addresses forward through `movedTo` in `apps/hub/src/router.js`
(`/admin/#…`, `/schedule/settings`), tested by `apps/hub/tests/moved.test.mjs`; projects forwards `#/settings` itself.

**Admin gate.** `AdminOnly` checks `profile.role === 'admin'`, then `AdminLock` (`apps/schedule/src/components/AdminLock.jsx`)
asks for the admin password, compared as a SHA-256 in the browser and remembered for the tab in sessionStorage
`css_admin_unlocked` (always unlocked in the emulator test copy). **Only the role is enforced** (`isAdmin()` in
`rules/firestore.rules`); the password is a speed bump. Changing it is a code change. Never type it into the site yourself.

## Where settings live

### On each person: `users/{uid}` (staff schedule's Firestore; everyone signed in can read)

| Field | Set from | Read by | Who may write (rules) |
|---|---|---|---|
| `role` (`user`/`admin`) | People and access | rules `isAdmin()`, every admin check, the proxy (`verifyStaff_`) | admin |
| `team` (Admin, Management, Engineers, Sales, Application: `apps/schedule/src/utils/teams.js`) | People and access; HR on `#/people/<uid>` | edit rights in most sections (`EDIT_TEAMS` lists, `canEditProjects`, `canBench`, `isEngineering`…) | admin, HR |
| `simproAccess` | People and access | SimproSync, Simpro Jobs, Deep Search, Test Bench customers; proxy `simproSyncVerifyAdmin_` | admin |
| `kbEditor` | People and access | Knowledge (`canEditKb`), Manuals | admin |
| `trackerRole` (`am`/`service`) | People and access **and** the tracker's Manage → Team, both via `apps/admin/src/tracker.js` | tracker `teamFrom` (`apps/equipment/src/model.js`), proxy `trackerTeam_` | admin |
| `trackerTester` | **no screen** (console) | `shared/can.js` `equipment.testMode` | admin |
| `hr` | hub People → Job tab (admins) | rules `isHR()`, `apps/hub/src/people.js` | admin |
| `notifications.{scheduleReminder, asksSummary, demoReminders}` | You → Notifications (own); Everyone's notifications (admin) | `remind.mjs`, `summary.mjs`, proxy `hubDemoOff_` | own via `isOwnNotifications` (exactly these keys, booleans); admin. **Missing means on.** |
| `fcmTokens[]` | the turn-on flows (below) | every push sender; device counts in Everyone's notifications | own (no shape check) |
| `homeLayout {quick}` | home hero → Customise (`apps/hub/src/home-layout.js`) | the home page | own via `isHomeLayout` |
| `displayName`, `workMobile`, `email` | hub People (own, HR) | everywhere | own (name, mobile), HR, admin |

A new field a person sets on themselves means changing `isOwnSafeUpdate` in `rules/firestore.rules` and its test, and pasting the
whole rules file into the Firebase console (a push does not publish it; say so). Saves must still work on the device if refused.

### Shared configuration documents (Firestore)

| Doc | Holds | Edited at | Rule |
|---|---|---|---|
| `projectSettings/main` | the project tracker's staff, categories, statuses, colours, `customers` | `/settings/projects`; customers also on `/projects/#/customers` and the Test Bench | `canEditProjects`, no shape check |
| `maintenance/_settings` | PM types | `/settings/maintenance` | falls under `maintenance/{id}` (`canEditMaintenance`, can delete it) |
| `locations/{id}` | the schedule's location suggestions | `/settings/schedule` | anyone creates active ones; admin edits |
| `settings/equipment` | `simproConfig.createJobs`, `demoTypes` | tracker Manage → Simpro (`demoTypes` grows on its own, no screen) | staff; only turning jobs **on** needs admin |
| `settings/equipmentCutover` | where the tracker's data lives | tracker Manage → Source (admin) | admin |
| `settings/toolNews` | new tools nobody needs to announce | hub Manage → News | `canEditProjects` |
| `oncallHistory/engineers` | the on-call engineers list | `/oncall/` (admin) | admin |

### Per device (localStorage, shared by the whole site)

Chosen settings: `css_theme` (no value = match the device; set by `shared/tool-chrome.js` `setTheme`, applied before first paint
by the inline script in `apps/hub/index.html`), `hub:start` (start page, `applyStartPage` in `router.js`), `hub:push_prompt_snoozed`,
`simproSync.company` (one key for all six Simpro tools), the tracker's `testMode`, the Test Bench's `chsBench.*`, and view
preferences per section (`css_*` schedule, `projects_*`, `cl-*` checklists, `people:view`). Mirrors of Firestore settings:
`hub:home-layout:<uid>`, `hub:tool-news-dismissed`. State, not settings: `hub:recent`, `asks:seen` (shared with Asks on purpose),
`chs_badges`, `schedule:push_enabled` (this device's push flag).

### Server side (no screen; names only, never values)

Apps Script script properties (proxy: `SIMPRO_API_KEY`, `FCM_SERVICE_ACCOUNT_KEY`, `FIREBASE_SCHEDULE_PROJECT_ID`, `RESEND_API_KEY`,
`RESEND_FROM`, `LOAN_EMAIL_CC`; backup and news-inbox their own, `backend/README.md`). GitHub repository variables `HUB_REMINDERS`
(turns the Thursday reminder's timer on) and `TILE_SYNC_HERE`; secrets `FIREBASE_*`, `RESEND_*`, `VITE_*` (incl.
`VITE_FIREBASE_VAPID_KEY`). In the code: teams (`teams.js`), each section's `EDIT_TEAMS`, the job list (`shared/jobs.js`),
`START_PAGES` (`router.js`), EmailJS ids (`apps/equipment/src/store.jsx`).

### Permissions

`shared/can.js` has only `equipment.admin` and `equipment.testMode`, used only by the demo tracker. The planned
`can(user, 'projects.edit')` style was never extended: every other section writes its own check (team lists, `role`, `hr`,
`kbEditor`, `simproAccess`), and the rules repeat them. HR (`hr` or admin) is set and used on People, deliberately not in Settings.

## Notifications

### Getting a device on (one registration covers every tool)

- **Store:** `users/{uid}.fcmTokens`, an array of FCM token strings in the staff schedule's Firebase project. A token does not
  record whether it is a phone or a PC. Added with `arrayUnion`; nothing in the app ever removes one.
- **Two turn-on implementations, four buttons.** `enable()` in `apps/hub/src/PushPrompt.jsx` (the shell's banner, and Settings →
  Your notifications) is **phones only** (iPhones only once added to the Home Screen; on a PC Settings says "open this page on your
  phone"). `enablePush()` in `apps/schedule/src/utils/push.js` (My week's card, Asks' My asks card) **also registers PCs**. Both set
  localStorage `schedule:push_enabled`. The banner shows on every page (it is rendered by the shell in `App.jsx`), "Not now" hides it
  for a week, and it never shows on a PC, so **nobody tells a PC-only person to set up their phone**.
- **Kept alive:** `restoreRegistration` (PushPrompt) puts a turned-on phone's current token back once per visit. **Pruned:**
  `.github/workflows/prune-devices.yml` (Mondays) dry-runs every token and removes dead ones; `remind.mjs` and `summary.mjs` prune
  as they send; the proxy never prunes.
- **Not handled:** signing out leaves the device's token on the old record (`signOutUser` in `shared/session.js`), and nobody can
  turn one device off or remove it.
- **The service worker** (`apps/hub/src/sw.js`, compat SDK via `importScripts`, which is why it is built on its own): on a tap,
  `notificationclick` opens `data.url` (fallback `/schedule/`), reusing a window already in that section, else any window of the app.
  `onBackgroundMessage` only acts on data-only messages; every sender today sends a `notification` block, which the browser shows.
- **While the app is open,** a push shows as a toast only on the schedule's My week and in Asks (`onForegroundMessage`); on other
  pages it shows nothing.

### Every sender

Every push has the same shape: `notification {title, body}`, `data.url`, the hub's icon and badge. Apps Script sends one HTTP v1
request per token through `sendHubPush_`; the GitHub scripts use the Admin SDK. Proxy actions verify the caller's sign-in.

| What | When | Code | Channel | Who | Opens | Off switch |
|---|---|---|---|---|---|---|
| "Where are you next week?" | Thu 08:00, `remind.yml` (only while `HUB_REMINDERS` is `true`; a manual run is a dry run) | `apps/schedule/scripts/remind.mjs` | push **and** email (Resend) to everyone due | no schedule for next week | `/schedule/my` | `scheduleReminder` |
| "You have N open asks" | weekdays 08:30, `asks-summary.yml` | `apps/asks/scripts/summary.mjs` | push; email only with no device | people with asks to do | `/asks/#/mine` | `asksSummary` |
| An ask changed (new, picked up, done, comment…) | on the change; `sweepAsksRun_` every 5 min catches offline ones | `notifyAsk_` → `askRecipients_`, `askMessage_`, `deliverAsk_` | push; email (`sendAskEmail_`) with no device | decided server-side from the ask | `/asks/#/mine?ask=<id>` | **none** |
| News post / team update | Manage → News, "Notify everyone's phones" (default on for announcements) | `notifyNews` in `apps/hub/src/social.js` → `notifyNews_` | push | everyone but the author | `/#/news/<id>` (a batch: `/`) | **none** |
| News comment | on a comment | `notifyNews_` (`newsCommentRecipients_`) | push | the author and earlier commenters | `/#/news/<id>?c=1` | **none** |
| New tool request / feedback | on submit (`apps/hub/src/requests.js`) | `notifyHubRequest_` | push | Engineers and admins | `/#/manage/requests` or `/feedback` | **none** |
| New person signed in | first sign-in (`apps/schedule/src/profile.js`) | `notifyNewUser_` | push | admins | `/settings/people` | **none** |
| Checklist shared with you | Share dialog | `notifyChecklistShared_` | push | the people and teams shared with | `/checklists/#/<id>` | **none** |
| Demo starting / upcoming | daily 08:00 (Apps Script timer) | `sendDemoRemindersRun_` → `sendPushToPerson_` | push | Service & Projects (`trackerRole`) | the loan (`?open=`) | `demoReminders` |
| Booking stuck | every 4 h | `processStuckLoan` | push | the booking's account manager | `/equipment/?reassign=<id>` | `demoReminders` |
| Due back soon | daily 08:00 | `sendReturnRemindersRun_` | push | the account manager; Service & Projects | `?return=<token>` / `?open=` | `demoReminders` |
| Test notification | tracker Manage → Notify | `sendTestPush_` | push | one team member | `/equipment/?mobile=1` | ignores it (on purpose) |
| Loan form | finishing a loan | `emailForm` in `apps/equipment/src/store.jsx` (browser, **EmailJS**); `sendMissedLoanEmailsRun_` (Resend) if the browser never sent it | email | the loan's account manager | the loan's links | **none** |
| Backup failed | nightly backup | `backend/apps-script/backup/Code.js` (`MailApp`) | email | the script's owner | — | — |

Timed proxy jobs report to `jobRuns` through `trackJob_` and rethrow, so Google's own failure email still goes out. Demo reminders
match a person by email, then name (`hubTokensFor_`), and skip anyone switched off (`hubDemoOff_`); their sent markers live in
`equipmentReminders` (no client access). Most other proxy dedupe is a 6-hour CacheService key; checklists keep `notified`, loan emails
`meta.formEmail`. The GitHub jobs keep no sent record: a second real run sends again. Nothing goes out by Teams, Graph or Slack.
`backend/apps-script/news-inbox/` (in progress) sends nothing: it imports the team update email into `newsInbox` for Manage.

### In the app

- **Badges** (`shared/badges.js`): `setBadge(section, n)` into localStorage `chs_badges`; header tabs show them (`Header.jsx`
  `TabBadge`, "9+"), and the app icon shows their sum (`setAppBadge`). Cleared on sign-out. Asks: unread activity
  (`apps/hub/src/useAsksBadge.js`, on every page). Demo tracker: overdue and waiting loans, set **only while the tracker is open**.
- **Needs you** on the home page (`apps/hub/src/needs.js`): built from the badges plus asks to do. A new section's badge appears
  there automatically; add it to `needs.js` to word it.
- **No notification centre.** The shell header has no bell, inbox or history (nothing stores a sent notification), though
  `INTEGRATION-PLAN.md` lists "notifications" in the header.

### Adding a notification

1. Send to `users/{uid}.fcmTokens` only (no new turn-on step): from Apps Script through `sendHubPush_` / `sendPushToPerson_`, or a
   GitHub job like `remind.mjs`. Choose recipients on the **server**, from the record, never from what the browser sends.
2. Put a `data.url` into the screen it is about, on a link that will keep working (they sit in people's notification trays).
   Check `notificationclick` in `sw.js` if it opens outside the one app.
3. Give it a switch: a key in `users/{uid}.notifications` (missing = on); a column in `Admin.jsx` `NotificationsTab`; a row in
   `You.jsx` `MINE` and the key in `isOwnNotifications` (rules plus `rules/tests/firestore-rules.test.mjs`) if people set it
   themselves; the sender skips anyone with it `false`. Rules need publishing by hand.
4. Remember what was sent somewhere that survives a re-run, if it is timed. Report the run to `jobRuns` and add it to `shared/jobs.js`.
5. Log one line to the activity log for the action that caused it (`shared/activity.js`), never its content. Counts only in logs.

## Known gaps (20 Nov 2026)

1. **No reminder for a PC-only person** to turn a phone on; and the Asks and My week cards register a PC instead.
2. **No off switch** for ask pushes and emails, news posts and comments, tool requests, new sign-ins, checklist shares, loan emails.
   Only three switches exist.
3. The Thursday reminder **emails everyone due as well as pushing**, against its own header comment ("email is the fallback").
4. Signing out leaves the token: a shared phone keeps getting the last person's pushes. No "turn this device off".
5. Pushes arriving while the app is open are silent except on My week and Asks.
6. Four copies of the email HTML (Resend), plus EmailJS and MailApp; push sending written twice (Admin SDK, Apps Script); the
   proxy reads `users` five ways, and `notifyHubRequest_` / `notifyNewUser_` read only the first 300 people.
7. Demo and stuck-loan reminders don't skip `testbatch_` loans (the return reminders do). The test push's `?mobile=1` is ignored by
   the tracker, so it lands on the overview.
8. The demo tracker's badge is stale until the tracker is opened in that browser; Needs you and the header count different asks.
9. Settings with no screen: `trackerTester`, `demoTypes`, server properties and repository variables, the admin password.
10. Rules looser than the screens: `projectSettings/main` (any team member, restore included), `maintenance/_settings` (deletable),
    `settings/equipment` (any field but `createJobs`), admin writes to `users` (unchecked values).
11. "Match this device" is applied when chosen and at load, not live; the header's moon/sun and Appearance can disagree until reload.
12. Out-of-date wording: `shared/jobs.js` (calendar invites, overdue), `Admin.jsx` (overdue; `remind.mjs` "in the staff schedule's
    repo"), `README.md` (the same, and the "(old demo app)" label), `You.jsx`'s "rules not published yet" error, `can.js`
    "NOT USED YET", `sw.js` "two senders".

## Verify

`npm run build`, `npm test -w apps/hub`, `npm test -w apps/schedule`, and the rules tests (`rules/README.md`) for any rules
change. `apps/settings` has no tests of its own. A notification change is checked on a real phone: Settings → You → Notifications
shows whether this phone is on; admins see each person's device count in Everyone's notifications; the tracker's Manage → Notify
sends a test.

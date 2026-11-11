# CMCHS Internal Hub — read this first

internal.chsnz.co.nz: the hub home page (`apps/hub`, which also holds the shell
every section runs in; it has its own `CLAUDE.md`) and the tools under it (schedule,
maintenance, service orders, SimproSync, Ansur, admin settings, and the demo
tracker at /equipment/, `apps/equipment`, which has its own `CLAUDE.md`; so do Asks,
the Test Bench and Simpro Asset Sync, `apps/simprosync`). How it is put
together, run locally and deployed is in `README.md`; the wider history and
traps are in `chs-equipment/PROJECT-CONTEXT.md`.

**Everything is being merged into one app from this repo:** read
`INTEGRATION-PLAN.md` before building anything. It says where new work goes,
which links between tools must keep working, and how to work while things move.

## Working agreements

Several people work on these repos with Claude, often at the same time.

- **Pull before you start, and again before you commit.**
- **Changes reach `main` through a pull request** (branch ruleset "main: reviewed
  changes, no force-push", since 10 Nov 2026): a direct push is refused (`GH013`)
  unless it comes from a repository admin. Verify first: `npm run build` passes and
  the tests pass (`npm test -w apps/schedule`, `npm test -w apps/hub`, plus the
  app's own, e.g. `npm test --prefix apps/testbench`). Then
  `git push origin HEAD:refs/heads/<short-branch-name>` (the working tree is shared,
  so do not switch branches or stash), `gh pr create --base main`, and bind the PR
  (ccd_pr tools). One approval is needed; anything under `.github/`, `rules/`,
  `backend/`, `scripts/` or a `package.json` / lock file needs the owner's
  (CODEOWNERS). **Merging deploys the whole site** through GitHub Actions within a
  couple of minutes: after it, check the live page actually shows the change. A
  commit made on local `main` and pushed this way is the same commit after a
  merge, so `git pull` afterwards is clean.
- **The demo tracker is `apps/equipment`** (read its `CLAUDE.md` first). `/demo/`
  forwards old links there and shows a "retired" error to a bare visit
  (`apps/demo/build.mjs`); the old tracker in `chs-equipment`
  is retired (tag `old-tracker-final`) and is never changed.
- **Secrets never go in the repo, a commit message or the chat.** The repo is
  public. The `VITE_*` values live in Actions secrets and a local `.env`
  (never committed). Logs and messages give counts only — never names, emails
  or addresses.
- **Keep the service worker's precache small.** Phones download all of it on
  install; big or rarely used files go in `globIgnores` in `scripts/build.mjs`.
- **Database rules are in `rules/`** (Firestore: `rules/firestore.rules`, which has the
  demo tracker's data since 4 Nov 2026; its old, frozen Realtime Database:
  `rules/database.rules.json`). A push does not
  publish them: they are pasted, whole, into the Firebase console. Say so when
  a change needs publishing (`rules/README.md`).
- **The back end is in `backend/`** (the Apps Script proxy and nightly backup,
  Tile sync). `clasp push` does not make Apps Script code live: `git pull`, push,
  then `clasp deploy -i <id>` and check the live `/exec` address, exactly as in
  `backend/README.md`. This has bitten twice.
- **Every change to data logs one line to the activity log** (`shared/activity.js`, "Activity log" in
  `README.md`): say what was done in words, never private content (ask titles, comment text, pay, keys).
- **Ask before anything people would notice and can't undo:** deleting data,
  changing rules, anything that signs people out.

# People page — read this before changing it

The staff directory and HR profiles at `internal.chsnz.co.nz/#/people`. It is one of the hub's own pages (not a
section), so it lives in `apps/hub/src` beside the home page; `apps/hub/CLAUDE.md` covers the shell around it and
README's **People** section is the short user-facing summary. This file is the working map: what holds what, who may
change it, and what else depends on it.

## What it is

Routes (`App.jsx`'s hash routing): `#/people` (directory), `#/people/me`, `#/people/<uid>` (a profile). These are in
bookmarks, pushes and search results: keep them working.

- **Directory**: everyone on the roster with name, team, picture, work email, work mobile and where they are today
  (from the schedule, Monday's plan at the weekend). Search by name, team, email or 3+ mobile digits; team filter tags;
  two layouts, **Contacts** (one row each, one-tap Call and Email; the phone default) and **Cards**, remembered in
  localStorage `people:view`.
- **Profile**: header (picture, job title · team, location, On call / Admin / HR / Not signed in yet badges, contact,
  "Reports to"), then three tabs, **Personal**, **Job**, **Emergency**, which only the person and HR can open. Your own
  profile shows a "% complete" nudge (`completeness`).
- **HR only**: **Add employee** (a placeholder who can be scheduled before they first sign in) and **Remove from staff
  list** (type the name to confirm; never an admin, never yourself).

| Who | Sees | Edits |
|---|---|---|
| Everyone signed in | the directory and everyone's public fields | their own name, work mobile, picture, personal details, emergency contacts and job title |
| HR: admins, or `hr: true` on their `users` record | everyone's whole profile | everyone's profile (also team, manager, start date, employment type); adds and removes people |
| Admins only | | HR access (Job tab), and role, Simpro access, editor switches in Settings → People and access (`/settings/people`) |

## The map

| File | What it owns |
|---|---|
| `src/People.jsx` | The page: `Directory` (`ContactRow`, `PersonCard`), `Profile` (`PhotoEditor`, `PersonalTab`, `JobTab`, `EmergencyTab`, built from `Section` + `Field`: read → Edit → Save/Cancel), HR dialogs `AddEmployee`, `RemoveEmployee`. Styles: `.pp-*` in `src/hub.css` ("People (People.jsx)"). |
| `src/people.js` | All data: `loadDirectory`, `loadProfile`, `saveUser`, `savePrivate`, `saveEmployment`, `savePhoto`, `addEmployee`, `removeEmployee`; pure helpers `buildDirectory`, `searchPeople`, `cleanPrivate`, `cleanEmployment`, `completeness`, `tenure`, `telHref`, `placeholderId`, `profileKey`, `isHR`; `photoFromFile` (square 192px JPEG). Firestore is imported on demand. |
| `tests/people.test.mjs` | The pure helpers. `tests/search.test.mjs` covers people in Ctrl+K. |
| `src/dev-fixture.js` | Made-up staff for `npm run dev` without a `.env`: `people.js` then uses an in-memory store where "Dev User" is an admin. Nothing saves. |

**Other code that reads People's data** (change `buildDirectory`'s output and these change too):
`search.js` `personHits` (Ctrl+K and the home search, linking `/#/people/<uid>`), `Palette.jsx` and `Manage.jsx`
(both call `loadDirectory` with no whereabouts, for the staff list), `Home.jsx` (links to
`#/people`), `Header.jsx` (the People tab and "My profile" → `/#/people/me`). Whereabouts come from `today.js`
(`loadToday`), which reads the schedule with the schedule's own code; People never works out locations itself.

## Where the data lives

All in the staff schedule's Firestore project. Rules: `rules/firestore.rules` (search `match /users/`, `staffPhotos`).

| Where | Holds | Read by |
|---|---|---|
| `users/{uid}` | `displayName`, `email`, `team`, `workMobile`, `role`, `hr`, `pending` (plus other sections' fields) | everyone signed in |
| `staffPhotos/{email}` | `photo`: a `data:image/jpeg;base64,…` string under 200,000 characters (~15 KB at 192px) | everyone signed in |
| `staffPrivate/{email}` | `dateOfBirth`, `personalEmail`, `personalPhone`, `address {street, suburb, city, postcode}`, `emergency` (up to 2 × `{name, relationship, phone}`), `updatedAt`, `updatedBy` | the person and HR |
| `staffEmployment/{email}` | `jobTitle`, `startDate`, `employmentType` (`EMPLOYMENT_TYPES`), `managerUid`, `updatedAt` | the person and HR |

**The three `staff*` records are keyed by lower-case work email, not uid.** A person HR adds has only a placeholder
uid (`pending-jo-bloggs`), thrown away at their first sign-in; the email is what stays put. Consequences:

- No email on the `users` record → no picture, private or job details can be saved (the page says "Add their work email
  first"). The page lets HR set the email only while the person is pending or has none (the rules would allow more).
- Changing someone's email moves where their details are looked up. `PersonalTab` saves the private details under the
  new key, but the old `staffPrivate`/`staffEmployment`/`staffPhotos` documents are not moved or deleted.
- Rules check `isMyEmail(email)` against the sign-in token's email, so a person whose sign-in email differs from the
  one on their record can't see their own private details.

## How a person comes and goes

1. **The Excel import** (`apps/schedule/scripts/excel-import.mjs`, `apps/schedule/EXCEL-IMPORT.md`) adds anyone in the
   schedule spreadsheet as a `pending` placeholder, often with **a first name only and no email** ("Carolyn"), and
   `excelName` to match on. Don't rename these from People without checking how the import matches names
   (`apps/schedule/src/utils/excelPlan.js`), or it may add the person again.
2. **HR → Add employee** makes `users/pending-<name>` (`placeholderId`, the same id the schedule's Admin uses so the two
   never duplicate) with name, work email, team, work mobile, `pending: true`.
3. **First sign-in** (`apps/schedule/src/profile.js` `claimPendingProfile`) claims a placeholder by exact email, then by
   an email guessed from its name, then by a unique first name. It moves their schedule weeks, keeps `workMobile`, and
   takes the placeholder's **team only on an exact email match** (the rules enforce this, `isClaimedTeam`). So a correct
   email on a placeholder is what makes a first sign-in land cleanly. Admins get a push (`notifyNewUser`).
4. **Remove** deletes `users/{uid}` and the three email-keyed records in one batch; past schedule weeks stay. Anyone who
   can still sign in comes back with an empty profile, and the Excel import re-adds anyone still in the spreadsheet.

## Rules for changes

- **Firestore's rules are the privacy, not the page.** The page only avoids asking for what it can't have. Any new
  field needs the matching rule, or saves fail with permission-denied:
  - on `users`: your own record → `isOwnSafeUpdate` (today: `displayName`, `workMobile`, plus other sections' fields);
    HR → `isHRSafeUpdate` (`displayName`, `email`, `team`, `workMobile`) and `isHRNewPerson`; first sign-in →
    `isNewOwnProfile`. `role`, `hr`, `simproAccess`, `kbEditor` stay admin-only.
  - in `staffPrivate` / `staffEmployment`: the `hasOnly([...])` key lists, and `cleanPrivate` / `cleanEmployment`
    in `people.js`, which drop unknown keys before saving. Add a field to both.
  - A person may change only `jobTitle` in `staffEmployment`; the rest is HR's.
- **A push doesn't publish rules.** Paste the whole `rules/firestore.rules` into the Firebase console and say so
  (`rules/README.md`). People's rules have no emulator tests yet (`rules/tests/`); add one when changing them.
- **Activity log:** changes made to *someone else's* record log one line through `people.js` → `shared/activity.js`
  (`app: 'hub'`), e.g. "Updated <name>'s work mobile on People." Say which fields changed, never the values, and never
  anything from the private tabs. Changes to your own profile aren't logged. Photos aren't logged.
- **Pictures** are made in the browser (`photoFromFile`: centre-crop, 192px, JPEG at falling quality until under
  `PHOTO_MAX_CHARS`). The rule checks the same limit and the `data:image/jpeg;base64,` prefix; change both together.
- **Never put staff data in the repo.** It is public. The test fixtures use made-up people; keep it that way.
- **Bulk changes** (filling numbers and titles from the staff phone list, say) are done with a one-off `firebase-admin`
  script run on a PC with the Excel import's service account, kept outside the repo: dry run first, back up the old
  values, then one activity-log line with counts only.
- **Phones and dark mode:** the Contacts layout is the phone default (under 760px); check both themes and layouts.

## Verify

```bash
npm test -w apps/hub
```

Plus the repo's `npm run build` and `npm test -w apps/schedule` (People imports the schedule's `names.js` and
`teams.js`). `npm run dev` with no `.env` runs on made-up staff with you as an admin; the test copy
(`npm run dev:emulators`, README "Test copy") runs the real rules as different people, which is the way to check who
can see and edit what. After merging, open `/#/people` and a profile on the live site.

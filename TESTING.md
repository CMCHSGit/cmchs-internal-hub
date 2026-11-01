# Testing the hub as different people (a brief for Cowork or a person)

The aim: find bugs by using the hub as each kind of staff member. It runs on the
**test copy** (README, "Test copy"): local Firebase emulators with made-up staff and
data. Nothing here touches the live site, real people, email, Simpro or pushes, so
click anything. Stopping the emulators throws the data away; `npm run emulators`
starts it afresh.

## Start it (two terminals, from the repo folder)

```bash
npm run emulators
```

```bash
npm run dev:emulators
```

Wait for "Test copy ready" in the first, then open the address the second prints
(http://localhost:5173 unless that port is busy). Needs Java and Node. `npm run emulators` a second
time while it is running just fails: it is already up.

## Who to sign in as

The sign-in page lists them under "Test copy: sign in as". Sign out from the
account menu (top right) to switch.

| Sign in as | Is | What they should be able to do |
|---|---|---|
| Alex Admin | Admin, Management team | Everything, including Settings → People and access, Notifications, Background jobs |
| Harper Hr | HR, Admin team | People: add/edit staff; no admin settings |
| Eli Engineer | Engineers, "service" in the tracker | Projects, service tools, on-call roster choices |
| Erin Engineer | Engineers, no tracker role | Same as a team member; no tracker extras |
| Sam Sales | Sales, account manager | Make demo loans, asks, news |
| Ari Applications | Applications, account manager | As Sam |
| Noa New | Signed in, **no team** | Read-only almost everywhere; sees "Your team isn't set yet" |

## What to try, per person

For each person, visit every top-bar tab and the Settings and Service menus, and check:

1. **Nothing shows an error**, a blank page, "undefined", "NaN" or a raw error message.
2. **Access matches the table.** A page someone shouldn't use says so plainly (for
   example "This is for admins"); controls they can't use are disabled or hidden, not
   clickable-then-failing.
3. **Things they can do really work, and survive a reload:** make a loan (Demo → New
   loan, press Finish), extend and return it; send an ask and reply to it; fill in
   My week and save; set the on-call roster (Schedule → On call, as Alex) and see it on
   the home page; post an announcement (Manage); change a project job's status; edit
   in the PDF editor; tick a checklist.
4. **Awkward input:** empty required fields, very long text, dates in the wrong order,
   double-clicking Save, going Back mid-way, a half-filled form then switching tab.
5. **Phone width** (about 375 px): no sideways scrolling, nothing cut off, buttons
   reachable with a thumb.
6. **Auto-update guard:** the app reloads itself onto a new version after 10 idle
   minutes and when reopened, but never during a dialog, a typed-in form, unsaved PDF
   edits, a loan being made or an unsaved My week. It only runs on a real build, so
   skip it on the dev server.

## Expected, not bugs

- "Failed to fetch" for anything that needs the live Apps Script proxy: Simpro,
  the team list, the Ansur report builder, sending emails or calendar invites.
- No push notifications, and Microsoft sign-in is replaced by the list above.
- It is a weekend or the data looks odd: the schedule, loans and jobs are seeded
  relative to today.

## Already covered (so spend time elsewhere)

Every route as Alex, Sam and Noa loaded without errors; Noa's pages are read-only
with clear messages; a loan was made, finished and returned; an ask was sent; the
on-call roster showed on the home page; a news post worked; a project job edit
saved and was read-only for Noa; no sideways scrolling at phone width on home,
People, Manage, Schedule, Asks, Projects, Demo or Settings.

Not yet covered: Harper, Ari, the PDF editor, checklists, Ansur/SimproSync, the
Leave calendar and Out of town pages, Service orders, Maintenance, Settings → People
(editing roles), and anything done with two people signed in at once (two browser
windows, one each).

## Reporting a bug

One line each: **who** you were signed in as, **where** (the address), **what you
did**, **what happened**, **what should have happened**, and a screenshot if it is
visual. Never put real names, emails or customer details in a report: the test data
is made up, and that is the point.

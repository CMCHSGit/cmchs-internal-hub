# Simpro Jobs (`/simprojobs/`, Service menu)

Create, edit and change Simpro jobs from a phone. Owner: Jonathan Nasrun. Visible to admins and anyone with Simpro access, the same
rule the Simpro relay applies. Mobile first: one column, 56px rows, a full-screen picker with the phone's Back button to leave it.

## Step 1: the new-job form's pickers (read only)

Customer (browse A to Z, or search, Show more), then one of its **Site**s, then **Cost centre** (starts on Service), **Job type**
(starts on Repair), **Charge category**, **Priority** (starts on Standard). Every lookup is a `GET` through the existing `simproSync` relay, and
the tests fail if one isn't; only step 3 (below) writes.

Where each list comes from (Simpro's own API reference, developer.simprogroup.com/apidoc, v1.0, read 13 Nov 2026):

| Picker | Simpro | Notes |
|---|---|---|
| Customer | `GET /customers/` (`search=any`, `CompanyName`/`GivenName`/`FamilyName` filters, `columns`, `pageSize`, `page`, `orderby`) | company and individual customers; a refused way of asking falls back to the next (`CUSTOMER_VARIANTS`) |
| Site | the customer's own record, `GET /customers/{companies\|individuals}/{id}?columns=ID,Sites`; else `GET /sites/?Customers.ID=` checked row by row | only the `Sites` column is ever readable there (a customer's record also holds banking) |
| Cost centre | `GET /setup/accounts/costCenters/` | |
| Priority | `GET /setup/responseTimes/` | Simpro calls a job's priority a **response time** (`ResponseTime` on a job) |
| Job type, Charge category | job **custom fields**: `GET /setup/customFields/projects/`, found by name, then `/{id}` for the `ListItems` | not built-in job fields. The old tracker set Job Type as custom field 44. If a build names them differently, **Check Simpro** shows the names that exist |

- `src/lookups.js`: what to ask and how to read the answer (no React; tested). `src/Sheets.jsx`: the pickers. `src/App.jsx`: the page.
- The form is kept in the browser for the session (a phone that switches apps and reloads the page keeps its choices); the setup lists
  are cached for 30 minutes so a reopened page is instant, and refreshed behind that.
- **Check Simpro** on the page asks every list once and says which worked (counts and list names, never a customer or site name).

### The relay (needs a deploy)

Step 1 widened `SIMPRO_SYNC_ALLOWLIST` in `backend/apps-script/proxy/Code.js`, read only, each rule with a **whitelist of query pieces** (a column or
filter not named can never be sent, repeats included; a list endpoint would otherwise also return record-level columns such as banking):
the customers list only (`columns=` required, limited to ID/Type/CompanyName/GivenName/FamilyName/Archived, plus the name filters, paging and
orderby), a customer's own record only for `columns=ID,Sites`, sites (paging, `Customers.ID`, a small column set), and paging only for
`setup/accounts/costCenters`, `setup/responseTimes` and `setup/customFields/projects`. It goes live
only after `clasp deploy -i` from an up-to-date checkout (`backend/README.md`); until then each picker says the relay "doesn't allow this
lookup yet". `tests/relay.test.mjs` loads the real `Code.js` and checks what is allowed and what is still refused.

## Step 2: description and notes (no Simpro calls)

Two text fields under the pickers (16px, so iOS doesn't zoom): **Description** (needed) and **Notes** (optional). They are kept with the rest of
the form for the session. `src/draft.js` holds the rules, tested: `missing()` (what the summary says is still to fill in), `toHtml()` (plain
text as the small HTML Simpro's description and notes hold: a blank line is a paragraph, a line break is `<br>`, anything typed that looks like
markup is escaped, never run; used when the job is created) and `hasWork()` (Start again asks first only when there is something to lose).
Jonathan chose description and notes only; asset or serial, contact and due date are left out for now (a serial can go in the notes).

## Step 3: create the job (the first thing here that writes to Simpro)

**Review and create job** opens a review screen, and its **Create job in Simpro** button is the only thing in the tool that sends a write.
- **Plan = preview = action** (`src/plan.js`): the form becomes five steps, the review screen is drawn from those steps (the exact words that
  will be stored, the cost centre, Job Type and Charge Category), and the button runs those same steps. Nothing is sent before the tap.
- **The sequence** is the demo tracker's `createJob`, proven on this Simpro: `POST /jobs/` (`Type: "Service"`, `Customer`, `Site`, `Description`,
  `Notes`, `ResponseTime`), `POST .../sections/`, `POST .../sections/{id}/costCenters/` (`CostCenter`), then `PATCH .../customFields/{id}`
  (`Value`) for Job Type and for Charge Category. No name, dates, stage, status or people are set: Simpro's defaults apply. If this Simpro
  insists on a due date, the first step is refused (422) and nothing is created.
- **Never a second job.** Once tapped, the plan is frozen into the run (kept with the form for the session), a double tap can't start two runs,
  and a step that is done is never sent again. A step Simpro refuses stops the run; **Try the remaining steps** resumes from there. A step
  whose answer never came (a dropped connection, a 5xx, the page closed mid-step) is "not sure": the page says to look in Simpro (Deep Search)
  before trying again.
- **Relay** (`simproSyncJobWriteError_` in `Code.js`, loaded by `tests/relay-write.test.mjs`): only these four writes, each alone in its call
  and with no query; a job must be a Service job with a customer, a site and a description (and optionally notes and a response time), and no
  other field; a section is empty; a cost centre is only `{CostCenter: id}`; a custom field is only `{Value: short text}`. It also writes the
  activity line ("created a Service job (job N)", job numbers only, never the text). Needs the same deploy as the read rules.
- **How far the writes reach** (`simproJobsScopeError_`, added after the security session's review; `tests/relay-scope.test.mjs`): the relay uses
  the company's one Simpro key, so these writes are held to what the tool does. A section, cost centre or custom field is only added to a job
  that is **Pending** and was made or changed in the last 12 hours (the new job's own stage is sent as `Pending`), so an old or invoiced job
  can't be touched; a custom field is only one named **Job Type** or **Charge Category** in Simpro; a description or note carries only
  `<p>`, `</p>` and `<br>` (the page escapes everything else); one person can make **20 jobs per clock hour** (the count resets on the hour). If Simpro ever doesn't report a job's
  `DateModified` the add is refused rather than assumed fine, and the page shows the reason.
- **Same access as the rest of the tool** (admins and Simpro-access staff), not admin only (Jonathan's decision, 13 Nov 2026: this is a phone tool for the service team). Check who holds Simpro access (Settings, People and access) before the deploy. A job made by mistake can be archived in Simpro
  (the relay already allows `Stage: Archived`); there is no delete.

## Later

4. Edit or change an existing job (the relay's job `PATCH` allows only Stage, Status and Notes today); the same review-then-yes rule applies.

## Tests

```bash
cd apps/simprojobs && npm test        # invented customers and sites only; nothing real in this public repo
```

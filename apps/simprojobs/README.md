# Simpro Jobs (`/simprojobs/`, Service menu)

Create, edit and change Simpro jobs from a phone. Owner: Jonathan Nasrun. Visible to admins and anyone with Simpro access, the same
rule the Simpro relay applies. Mobile first: one column, 56px rows, a full-screen picker with the phone's Back button to leave it.

## Step 1: the new-job form's pickers (read only)

Customer (browse A to Z, or search, Show more), then one of its **Site**s, then **Cost centre** (starts on Service), **Job type**
(starts on Repair), **Charge category**, **Priority** (starts on Standard). **Nothing can be created or changed in Simpro from here
yet**: every call is a `GET` through the existing `simproSync` relay, and the tests fail if one isn't.

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

## Later steps (each needs Jonathan's explicit yes, a preview of exactly what will be written, and a relay deploy)

3. Create the job: `POST /jobs/` (`Type`, `Site`, `Customer`, `ResponseTime`, `CustomFields: [{CustomField, Value}]`, ...), then its cost centre
   (`POST /jobs/{id}/sections/`, then `.../costCenters/` with `CostCenter`), after a preview and a yes.
4. Edit or change an existing job (the relay's job `PATCH` allows only Stage, Status and Notes today).
Each write gets an activity line with no private content (`shared/activity.js`, add `simprojobs` to `APP_LABELS`).

## Tests

```bash
cd apps/simprojobs && npm test        # invented customers and sites only; nothing real in this public repo
```

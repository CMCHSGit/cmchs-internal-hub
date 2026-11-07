# Simpro Deep Search (`/simprosearch/`, Service menu)

Find Simpro jobs by what is written inside them (descriptions, notes, asset and serial numbers) and open one to read it.
Owner: Jonathan Nasrun. Visible to admins and anyone with Simpro access, the same rule the Simpro relay applies.

## Phase 1: read only (live)

- **No writes, no relay change, no deploy.** Every call is a `GET` through the existing `simproSync` relay
  (`backend/apps-script/proxy/Code.js`, `SIMPRO_SYNC_ALLOWLIST`): `/jobs/?<field>=%25text%25`, `/jobs/{id}`, `/customerAssets/`,
  the job's sections, cost centres and attached assets. The Simpro key stays in Script Properties.
- `src/search.js`: what to ask Simpro and how to read the answer. Each field (Description, Notes, Name, Site, Customer) is its own
  request, so one Simpro refuses doesn't take the others down; the page says which were not searched.
  Asset serials are tried through each filter in `ASSET_FILTERS`; rows are kept only if their own serial contains the text.
- `src/html.js`: Simpro's rich text to a small safe tree (a tag allowlist, no attributes but a link's `http(s)/mailto/tel` address,
  no script, style or frames). `SafeHtml.jsx` draws it as React elements. Raw HTML is never put on the page.
- "What can Simpro search?" on the page asks Simpro about each field with a common and a made-up word and reports which really
  filter, which ignore the filter and which refuse. Counts only, nothing from a job is shown or kept. It decides whether a saved
  index (phase 1b) is needed.
- Not shown yet: attachments and the job log (the relay doesn't allow reading them). A later, small relay change, to be agreed.

## Later phases (need Jonathan's explicit yes each, and a deploy of the relay)

1. Notes and description: append, or replace, with a preview of the exact change and a stored copy of the old value.
2. Stage and status. 3. Other job fields. 4. Create and close jobs (admin only, second confirmation).
Each needs a role check, an allowlisted path and fields in the proxy, an activity line with no private content
(`shared/activity.js`, add `simprosearch` to `APP_LABELS` in `shared/activity-core.js`), and a trial on one named test job.

## Tests

```bash
cd apps/simprosearch && npm test        # invented jobs and assets only; nothing real in this public repo
```

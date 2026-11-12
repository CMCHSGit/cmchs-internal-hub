/* Simpro Jobs: what to ask Simpro for the new-job form's pickers, and what to make of the answers. Read only: every call here is a
   GET through the hub's Simpro relay (apps/testbench/src/simpro-api.js makeCall), so nothing here can write to Simpro.
   No React and no Firebase, so the tests run it as it is. `call(method, path)` is makeCall()'s result.

   Endpoints and field names are from Simpro's own API reference (developer.simprogroup.com/apidoc, v1.0, read 13 Nov 2026):
   - customers   GET /customers/ rows {ID, Type: Individual|Company, CompanyName, GivenName, FamilyName}; search=any|all, columns,
                 pageSize (max 250), page, orderby; a column filter is Field=%25text%25
   - sites       a customer's record has Sites (its linked sites); /sites/ rows are {ID, Name}, full records also hold Customers
   - cost centre GET /setup/accounts/costCenters/ {ID, Name}
   - priority    Simpro calls it a response time: GET /setup/responseTimes/ {ID, Name, Archived}; on a job it is ResponseTime
   - job type    not a built-in field: a custom field on jobs (GET /setup/customFields/projects/ {ID, Name, Type}); a List field's
   - charge cat. options are the ListItems of GET /setup/customFields/projects/{id}. Which field is which is found by name. */
import { SendError, ok, simproErr } from '../../testbench/src/simpro-api.js'

export const PAGE_SIZE = 30
export const SETUP_PAGE = 250

/** What the form starts on, when Simpro has an option of that name. */
export const DEFAULTS = { costCentre: 'Service', jobType: 'Repair', priority: 'Standard' }
/** The job custom fields the form needs, found by name (case and spacing ignored). */
export const FIELD_NAMES = { jobType: /^job\s*type$/i, chargeCategory: /^charge\s*categor(y|ies)$/i }

/** The text in Simpro's wildcard form (% on both ends, so it can be anywhere), safe to put in the address. */
export function likeTerm(text) {
  const enc = encodeURIComponent(String(text).trim()).replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return '%25' + enc + '%25'
}

/** A relay that has not been updated yet answers "is not allowed" to the new lookups: say so in words. */
export function friendly(e) {
  const m = String(e?.message || e)
  if (/is not allowed/i.test(m)) return 'The hub’s Simpro service doesn’t allow this lookup yet: its new version has not been deployed.'
  return m
}

const rowsOf = (r, what) => {
  if (ok(r) && Array.isArray(r.data)) return r.data
  throw new SendError(`${what}: ${simproErr(r)}`, r.status >= 500 || r.status === 429)
}

// ── Customers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const customerName = (c) => c?.CompanyName || [c?.GivenName, c?.FamilyName].filter(Boolean).join(' ') || (c?.ID ? `Customer ${c.ID}` : '')
/** Simpro's path word for a customer's type: a customer's own record is at /customers/companies/{id} or /customers/individuals/{id}. */
export const customerKind = (c) => (c?.Type === 'Individual' || (!c?.Type && !c?.CompanyName && (c?.GivenName || c?.FamilyName)) ? 'individuals' : 'companies')

const CUSTOMER_COLUMNS = 'ID,Type,CompanyName,GivenName,FamilyName'
/** Ways of asking, best first. Simpro might refuse one (an orderby or a column it doesn't take), so a refusal tries the next. */
export const CUSTOMER_VARIANTS = 3

export function customersPath(companyId, text, page = 1, variant = 0) {
  const t = String(text ?? '').trim()
  const paging = `pageSize=${PAGE_SIZE}` + (page > 1 ? `&page=${page}` : '')
  if (variant >= 2) return `/companies/${companyId}/customers/companies/?${t ? `CompanyName=${likeTerm(t)}&` : ''}${paging}&orderby=CompanyName`
  const parts = [`columns=${CUSTOMER_COLUMNS}`, paging]
  if (variant === 0) parts.push('orderby=CompanyName')
  if (t) { const like = likeTerm(t); parts.push('search=any', `CompanyName=${like}`, `GivenName=${like}`, `FamilyName=${like}`) }
  return `/companies/${companyId}/customers/?${parts.join('&')}`
}

export const normaliseCustomer = (c) => ({ ID: c.ID, kind: customerKind(c), name: customerName(c), individual: customerKind(c) === 'individuals' })

/**
 * One page of customers: the text anywhere in the company, given or family name (no text: everyone, A to Z). `variant` is the way of
 * asking that worked last time, so the next page doesn't retry the ones Simpro refused. Throws SendError.
 */
export async function loadCustomers(call, companyId, text, page = 1, variant = 0) {
  let last
  for (let v = variant; v < CUSTOMER_VARIANTS; v++) {
    last = await call('GET', customersPath(companyId, text, page, v))
    if (ok(last) && Array.isArray(last.data)) {
      const rows = last.data.filter((c) => c && c.ID).map(normaliseCustomer)
      return { rows, more: last.data.length >= PAGE_SIZE, variant: v }
    }
    if (last.status === 0 || last.status >= 500 || last.status === 429) break // not a refusal of how it was asked
  }
  throw new SendError(`Customers: ${simproErr(last)}`, last.status >= 500 || last.status === 429)
}

// ── Sites ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const cleanSites = (list) => {
  const seen = new Set()
  return list
    .map((s) => (typeof s === 'number' ? { ID: s, Name: `Site ${s}` } : s))
    .filter((s) => s && s.ID && !s.Archived && !seen.has(s.ID) && seen.add(s.ID))
    .map((s) => ({ id: s.ID, name: s.Name || `Site ${s.ID}` }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }))
}

/**
 * The sites linked to a customer. The customer's own record lists them (only that column is ever read: it also holds banking
 * details); if it doesn't, the site list is asked for the customer's sites and each row's own Customers decides, because a filter
 * Simpro ignores would otherwise hand back every site and look like this customer's. Throws SendError.
 */
export async function loadSites(call, companyId, customer) {
  const first = await call('GET', `/companies/${companyId}/customers/${customer.kind}/${customer.ID}?columns=ID,Sites`)
  if (ok(first) && first.data && Array.isArray(first.data.Sites)) return { sites: cleanSites(first.data.Sites), via: 'customer' }
  const second = await call('GET', `/companies/${companyId}/sites/?Customers.ID=${customer.ID}&columns=ID,Name,Customers,Archived&orderby=Name&pageSize=${SETUP_PAGE}`)
  const rows = rowsOf(second, 'Sites')
  if (rows.some((s) => !Array.isArray(s.Customers))) throw new SendError(`This customer’s sites could not be read safely (${simproErr(first)})`, false)
  return { sites: cleanSites(rows.filter((s) => s.Customers.some((c) => (c?.ID ?? c) === customer.ID))), via: 'sites' }
}

// ── Setup: the options on the form ─────────────────────────────────────────────────────────────────────────────────────────

const activeOnly = (rows) => rows.filter((x) => x && x.ID && !x.Archived)
const asOptions = (rows) => rows.map((x) => ({ id: x.ID, name: String(x.Name ?? x.ID) })).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }))

export async function loadCostCentres(call, companyId) {
  return asOptions(activeOnly(rowsOf(await call('GET', `/companies/${companyId}/setup/accounts/costCenters/?pageSize=${SETUP_PAGE}`), 'Cost centres')))
}

/** Simpro's response times are what its job form calls priority. */
export async function loadPriorities(call, companyId) {
  return asOptions(activeOnly(rowsOf(await call('GET', `/companies/${companyId}/setup/responseTimes/?pageSize=${SETUP_PAGE}`), 'Priorities')))
}

/** Every custom field a job can have: {ID, Name, Type}. */
export async function loadJobFields(call, companyId) {
  return activeOnly(rowsOf(await call('GET', `/companies/${companyId}/setup/customFields/projects/?pageSize=${SETUP_PAGE}`), 'Job custom fields'))
}

export const findField = (fields, pattern) => fields.find((f) => pattern.test(String(f.Name || '').trim())) || null

/** A List field's choices. An option's id is its text, which is what a job's custom field holds. */
export async function loadFieldOptions(call, companyId, fieldId) {
  const r = await call('GET', `/companies/${companyId}/setup/customFields/projects/${fieldId}`)
  if (!ok(r) || !r.data) throw new SendError(`Custom field ${fieldId}: ${simproErr(r)}`, r.status >= 500 || r.status === 429)
  return (Array.isArray(r.data.ListItems) ? r.data.ListItems : []).map((t) => String(t).trim()).filter(Boolean).map((t) => ({ id: t, name: t }))
}

/** The option named `wanted` (case and spacing ignored), or null: a default is only ever one Simpro really has. */
export function pickDefault(options, wanted) {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim()
  return (options || []).find((o) => norm(o.name) === norm(wanted)) || null
}

/**
 * Everything the form's four option pickers need, each on its own: one that fails (or isn't in this Simpro) leaves the rest working.
 * Returns { costCentre, priority, jobType, chargeCategory } each { options, error, field? }.
 */
export async function loadSetup(call, companyId) {
  const wrap = async (fn) => { try { return { options: await fn(), error: '' } } catch (e) { return { options: [], error: friendly(e) } } }
  const fieldPicker = (fields, which, label) => async () => {
    const field = findField(fields, FIELD_NAMES[which])
    if (!field) throw new Error(`No job custom field called “${label}” was found in Simpro.`)
    if (field.Type && field.Type !== 'List') throw new Error(`“${field.Name}” is a ${field.Type} field in Simpro, not a list.`)
    return loadFieldOptions(call, companyId, field.ID)
  }
  const [costCentre, priority, fieldsRes] = await Promise.all([
    wrap(() => loadCostCentres(call, companyId)),
    wrap(() => loadPriorities(call, companyId)),
    (async () => { try { return { fields: await loadJobFields(call, companyId), error: '' } } catch (e) { return { fields: [], error: friendly(e) } } })(),
  ])
  const fieldPart = async (which, label) => {
    if (fieldsRes.error) return { options: [], error: fieldsRes.error }
    const field = findField(fieldsRes.fields, FIELD_NAMES[which])
    const r = await wrap(fieldPicker(fieldsRes.fields, which, label))
    return { ...r, field: field ? { id: field.ID, name: field.Name } : null }
  }
  const [jobType, chargeCategory] = await Promise.all([fieldPart('jobType', 'Job Type'), fieldPart('chargeCategory', 'Charge Category')])
  return { costCentre, priority, jobType, chargeCategory, fieldNames: fieldsRes.fields.map((f) => ({ name: f.Name, type: f.Type })) }
}

// ── "Check Simpro": counts and names of setup, never a customer's or a site's name ────────────────────────────────────────

/**
 * Asks each lookup once and says what came back, so a wrong guess about this Simpro shows as a line here instead of an empty
 * picker. Setup names (cost centres, priorities, custom fields) are this business's own lists; customers and sites are only counted.
 * Returns [{ label, state: 'ok'|'warn'|'fail', detail }].
 */
export async function runChecks(call, companyId) {
  const out = []
  const add = (label, state, detail) => out.push({ label, state, detail })
  const attempt = async (label, fn) => { try { await fn() } catch (e) { add(label, 'fail', friendly(e)) } }

  let customer = null
  await attempt('Customers (browse)', async () => {
    const r = await loadCustomers(call, companyId, '', 1, 0)
    customer = r.rows[0] || null
    add('Customers (browse)', r.rows.length ? 'ok' : 'warn', `${r.rows.length}${r.more ? '+' : ''} on the first page; asked way ${r.variant + 1} of ${CUSTOMER_VARIANTS}${r.variant ? ' (the first ways were refused)' : ''}`)
  })
  await attempt('Customers (search)', async () => {
    const r = await loadCustomers(call, companyId, 'a', 1, 0)
    add('Customers (search)', r.rows.length ? 'ok' : 'warn', `a search for one letter found ${r.rows.length}${r.more ? '+' : ''}`)
  })
  if (customer) {
    await attempt('Sites of a customer', async () => {
      const r = await loadSites(call, companyId, customer)
      add('Sites of a customer', 'ok', `${r.sites.length} sites for the first customer, from ${r.via === 'customer' ? 'its own record' : 'the site list'}`)
    })
  }
  const setup = await loadSetup(call, companyId)
  const show = (label, part, wanted) => {
    if (part.error) return add(label, 'fail', part.error)
    const has = wanted && pickDefault(part.options, wanted)
    add(label, part.options.length ? 'ok' : 'warn', `${part.options.length} options${part.field ? ` (field “${part.field.name}”)` : ''}${wanted ? (has ? `; “${has.name}” is there` : `; no “${wanted}” to start on`) : ''}`)
  }
  show('Cost centres', setup.costCentre, DEFAULTS.costCentre)
  show('Priorities', setup.priority, DEFAULTS.priority)
  show('Job type', setup.jobType, DEFAULTS.jobType)
  show('Charge category', setup.chargeCategory)
  add('Job custom fields in Simpro', setup.fieldNames.length ? 'ok' : 'warn', setup.fieldNames.length ? setup.fieldNames.map((f) => `${f.name} (${f.type})`).join(', ') : 'none listed')
  return out
}

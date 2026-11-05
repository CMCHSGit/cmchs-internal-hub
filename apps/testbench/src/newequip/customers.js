/* The new-equipment page's view of the customers. They are the project tracker's customer folders (apps/projects/src/customers.js,
   kept in projectSettings/main): one place to keep each customer's links. The page uses two of a folder's sub folders, by name:
   "Equipment list" is the customer's asset list and "Test reports" is the folder the finished reports go in. Plain functions
   (no Firebase, no React) so the tests run them as they are. */
import { newCustomer, newSub, customerProblems, tidyCustomer, customersOf } from '../../../projects/src/customers.js'
import { linkHref } from '../../../projects/src/model.js'

export { customersOf, customerProblems, tidyCustomer }
export const ASSET_LIST = 'Equipment list'
export const REPORTS = 'Test reports'

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase()

/** The sub folder with this name, or undefined. */
export const subOf = (c, name) => (c?.subs || []).find((s) => same(s.name, name))

/** The web address of the customer's asset list / reports folder, or '' when it has none (or one that isn't a web address). */
export const assetListHref = (c) => linkHref(subOf(c, ASSET_LIST)?.link)
export const reportsHref = (c) => linkHref(subOf(c, REPORTS)?.link)

/** The customer with these two links set (a blank clears one); the sub folders are added when the customer has none yet. Nothing else changes. */
export function withLinks(c, { assetList = '', reports = '' }) {
  const subs = [...(c.subs || [])]
  for (const [name, link] of [[ASSET_LIST, assetList], [REPORTS, reports]]) {
    const i = subs.findIndex((s) => same(s.name, name))
    if (i >= 0) subs[i] = { ...subs[i], link: String(link).trim() }
    else if (String(link).trim()) subs.push({ ...newSub(name), link: String(link).trim() })
  }
  return { ...c, subs }
}

/** A draft customer for the form: a new folder (starting with the usual sub folders) or the existing one, with the form's name and links. */
export function draftFrom(existing, { name, assetList, reports }, defaults) {
  const base = existing || newCustomer(defaults)
  return withLinks({ ...base, name: String(name || '').trim() }, { assetList, reports })
}

/** What the form starts with for a customer (or blank for a new one). */
export const formOf = (c) => ({ name: c?.name || '', assetList: subOf(c, ASSET_LIST)?.link || '', reports: subOf(c, REPORTS)?.link || '' })

// "Test this device" links, as put beside each asset in a customer's asset list (a HYPERLINK formula in the spreadsheet):
//   https://internal.chsnz.co.nz/testbench/?model=BeneHeart%20D30&serial=FP5-6A036796&manufacturer=Mindray&asset=CHS-123&site=2350
// The hub reads them once when the Test Bench opens, takes them out of the address bar, and hands them to the bench, which picks the
// template for the model and fills in the device's details. Only device facts go in the address (never a person's name or a secret).

export const LINK_PARAMS = ['model', 'serial', 'manufacturer', 'customer', 'site', 'asset', 'custasset', 'ward', 'template']

const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120)

/** { device, rest }: the device in a query string (null when it has none) and the query string without the link's parameters. */
export function deviceFromSearch(search) {
  const p = new URLSearchParams(search || '')
  const device = {}
  for (const k of LINK_PARAMS) { const v = clean(p.get(k)); if (v) device[k] = v }
  if (!device.model && !device.serial && !device.template) return { device: null, rest: search || '' }
  for (const k of LINK_PARAMS) p.delete(k)
  const rest = p.toString()
  return { device, rest: rest ? `?${rest}` : '' }
}

// Read once, on the first call, so a second render (or a reload of the section) doesn't lose it; handed over once.
let pending
export function peekDeviceLink() {
  if (pending === undefined) pending = deviceFromSearch(typeof location === 'undefined' ? '' : location.search).device
  return pending
}
export function takeDeviceLink() { const d = peekDeviceLink(); pending = null; return d }

/** The address bar without the link's parameters (kept in the address until the bench has them, so a reload still works). */
export function cleanAddress(loc = location) {
  const { rest } = deviceFromSearch(loc.search)
  return loc.pathname + rest + loc.hash
}

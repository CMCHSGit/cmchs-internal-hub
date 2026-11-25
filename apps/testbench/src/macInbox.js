/* The MAC reader's "from your phone" inbox. A MAC read on a phone is sent to the signed-in person's own place in the database and shows
   in their MAC reader tab on the PC, where it stays until they remove it or scan another (each scan replaces the last): one slot per
   person, so nothing is kept for later and nothing is shared. Pure; the Firestore side is macInbox-firebase.js.

   The Device ID and the two MACs are sent as the phone's fields showed them (the person may have corrected one by hand), so they are
   checked here into the shapes the asset lists use: Device ID with dashes, MACs with colons, upper case. */
import { lanFromDeviceId, tidyDeviceId, tidyMac } from './macRead.js'

/**
 * What goes to the database: { deviceId, lanMac, wlanMac } each tidied or left out, and `errors` for anything typed that isn't an address.
 * At least one is needed.
 */
export function cleanReading(values) {
  const reading = {}, errors = []
  const take = (key, label, tidy) => {
    const raw = String(values?.[key] ?? '').trim()
    if (!raw) return
    const v = tidy(raw)
    if (v) reading[key] = v
    else errors.push(`${label} isn’t a full address: “${raw.slice(0, 40)}”.`)
  }
  take('deviceId', 'The Device ID', tidyDeviceId)
  take('lanMac', 'The LAN MAC', tidyMac)
  take('wlanMac', 'The WLAN MAC', tidyMac)
  if (!errors.length && !Object.keys(reading).length) errors.push('There is nothing to send yet.')
  return { reading, errors }
}

/** The LAN MAC when only the Device ID was read (the asset lists' rule), else what was read. */
export const lanOf = (r) => r?.lanMac || lanFromDeviceId(r?.deviceId) || ''

/** The inbox's reading as lines for the page: [{ key, label, value, derived }], in the order the screen shows them. */
export function inboxRows(r) {
  if (!r) return []
  const rows = []
  if (r.deviceId) rows.push({ key: 'deviceId', label: 'Device ID', value: r.deviceId })
  if (r.wlanMac) rows.push({ key: 'wlanMac', label: 'WLAN MAC', value: r.wlanMac })
  const lan = lanOf(r)
  if (lan) rows.push({ key: 'lanMac', label: 'LAN MAC', value: lan, derived: !r.lanMac })
  return rows
}

/** The address the phone opens: this MAC reader. */
export const readerLink = (origin = '') => `${origin}/testbench/?tab=mac`

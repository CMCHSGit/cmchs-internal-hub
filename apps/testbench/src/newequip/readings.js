/* A device's Device ID and MAC addresses as read on a phone (the Test Bench's MAC reader tab) and sent to the PC.
   One reading per unit: the customer (the project tracker's customer folder id) and the serial number are its key, so
   reading the same unit again replaces the first. Pure; the Firestore side is readings-firebase.js.

   The phone is opened from a link the PC makes (phoneLink: a QR code on the unit's row), which says which unit the
   reading is for, so nothing is typed on site and a reading can't land on the wrong device. */
import { lanFromDeviceId, tidyDeviceId, tidyMac } from '../macRead.js'
import { serialKey } from './pending.js'

export const READING_KEYS = ['deviceId', 'lanMac', 'wlanMac']

/** A reading's document id: the customer and the serial (upper case), with anything an id can't hold made a dash. */
export const readingId = (customerId, serial) => `${String(customerId)}__${serialKey(serial)}`.replace(/[\/\#?\[\]\s]+/g, '-').slice(0, 150)

/**
 * What goes to the database: { deviceId, lanMac, wlanMac } each tidied or left out, and `errors` for anything typed that isn't an address.
 * At least one is needed. (The three are as the page showed them, possibly corrected by hand.)
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

/** The LAN MAC when only the Device ID is known (the asset lists' rule), else what was read: what the workbook's MAC column would show. */
export const lanOf = (r) => r?.lanMac || lanFromDeviceId(r?.deviceId) || ''

/** The address the phone opens for a unit (the MAC reader tab, told which unit it is for). */
export function phoneLink(customer, u, origin = '') {
  const p = new URLSearchParams({ tab: 'mac' })
  const set = (k, v) => { const s = String(v ?? '').trim(); if (s) p.set(k, s) }
  set('cust', customer?.id); set('customer', customer?.name); set('serial', u?.serial)
  set('asset', u?.asset); set('model', u?.model || u?.description)
  return `${origin}/testbench/?${p.toString()}`
}

/** What a phone link says it is for: { customerId, customerName, serial, asset, model }, or null when it isn't a unit's link. */
export function targetFromSearch(search) {
  const p = new URLSearchParams(search || '')
  const cust = (p.get('cust') || '').trim(), serial = (p.get('serial') || '').trim()
  if (p.get('tab') !== 'mac' || !cust || !serial || cust.length > 40) return null
  return { customerId: cust, customerName: (p.get('customer') || '').trim(), serial, asset: (p.get('asset') || '').trim(), model: (p.get('model') || '').trim() }
}

/** A watched list of readings as a lookup by serial: Map(serialKey → { deviceId, lanMac, wlanMac, by, at }). */
export const readingsBySerial = (list) => new Map((list || []).map((r) => [serialKey(r.serial), r]))

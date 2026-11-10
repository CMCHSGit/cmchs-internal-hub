// How a "Test this device" link is followed (pending.js testLink: /testbench/?model=…&serial=…). Inside the Test Bench's Customers tab the
// page is already the bench's, so the device is handed to the bench frame and the Test Bench tab opens: following the link would reload
// the page and lose a test in progress and the USB connection. Anywhere else (no provider) the link is simply followed.
import { createContext, useContext } from 'react'
import { deviceFromSearch } from '../device-link.js'

export const OpenDevice = createContext(null)

/** The device in a test link's address, or null. */
export const deviceOf = (href) => { try { return deviceFromSearch(new URL(href, 'https://x.invalid').search).device } catch { return null } }

/** { onClick(href) → click handler for an <a>, go(href) → follows it from code }. */
export function useTestLink() {
  const open = useContext(OpenDevice)
  return {
    onClick: (href) => (e) => { if (!open || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); open(deviceOf(href)) },
    go: (href) => { if (open) open(deviceOf(href)); else location.href = href },
  }
}

/* Opens Simpro Asset Sync with a file: left in handoff.js's store, taken there once. Asset Sync reads Simpro and shows what would change;
   nothing is sent until someone presses Apply on its page. */
import { handoffUrl, idbHandoff, putHandoff } from './handoff.js'

export async function sendToSimpro(file) {
  await putHandoff(idbHandoff(), file)
  location.assign(handoffUrl())
}

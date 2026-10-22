/* The Apps Script proxy (backend/apps-script/proxy), one address for every tool.

   It holds the keys the browser must never see (Simpro, the chs-equipment
   service account) and does the jobs a static site can't: the demo tracker's
   database pass (rtdbToken), Simpro calls (simproSync and the tracker's job
   create/update/close), and pushes (notifyHubRequest, notifyAsk, notifyNews, testPush).
   The browser sends the person's Firebase ID token; the proxy checks it.

   A new deployment keeps this address (`clasp deploy -i <id>`), so this only
   changes if the web app itself is replaced. The demo tracker
   (chs-equipment/index.html) has its own copy, SIMPRO_PROXY_URL, until it is
   rebuilt here (INTEGRATION-PLAN.md step 4). */

// The test copy (npm run dev:emulators), worked out here rather than imported from
// ./firebase.js, so the tests can load this file outside Vite.
const emulators = typeof import.meta.env !== 'undefined' && import.meta.env.DEV === true && import.meta.env.VITE_EMULATORS === 'true'

const LIVE_PROXY_URL = 'https://script.google.com/macros/s/AKfycbzKLt_IP3GPRiNQkYkCep-_Yee06rDwc3uJGnQQuzjVuCSJOImJnaqDgU-3W3q9Y4OHUw/exec'

// The test copy never calls the live proxy: its sign-ins are fake, and pushes,
// Simpro and the tracker's database pass are live-only. Calls fail fast instead,
// the same as when the proxy can't be reached.
export const PROXY_URL = emulators ? 'http://127.0.0.1:59999/no-proxy-in-the-test-copy' : LIVE_PROXY_URL

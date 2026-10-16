/* The Apps Script proxy (backend/apps-script/proxy), one address for every tool.

   It holds the keys the browser must never see (Simpro, the chs-equipment
   service account) and does the jobs a static site can't: the demo tracker's
   database pass (rtdbToken), Simpro calls (simproSync and the tracker's job
   create/update/close), and pushes (notifyHubRequest, notifyAsk, testPush).
   The browser sends the person's Firebase ID token; the proxy checks it.

   A new deployment keeps this address (`clasp deploy -i <id>`), so this only
   changes if the web app itself is replaced. The demo tracker
   (chs-equipment/index.html) has its own copy, SIMPRO_PROXY_URL, until it is
   rebuilt here (INTEGRATION-PLAN.md step 4). */

export const PROXY_URL = 'https://script.google.com/macros/s/AKfycbzKLt_IP3GPRiNQkYkCep-_Yee06rDwc3uJGnQQuzjVuCSJOImJnaqDgU-3W3q9Y4OHUw/exec'

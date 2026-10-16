/* Admin settings as a section of the one app (INTEGRATION-PLAN.md step 2):
   the hub (apps/hub/src/App.jsx) opens this at /admin/, under its own header.
   Inside, it routes on #users, #notifications… as it always has.

   The screens are the staff schedule's, so they bring its stylesheets. Those
   still name things the way the schedule does (.page, .tabs, .bottom-nav…),
   so in this build they apply only inside this section: apps/hub/vite.config.js
   scopes them to main.section[data-section="admin"], and leaves out the kit
   they import, which the shell has already loaded. */
import '../../schedule/src/index.css'
import '../../schedule/src/settings.css'
import './admin.css'
import App from './App.jsx'

export default function AdminSection() {
  return <App />
}

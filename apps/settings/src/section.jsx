/* Settings as a section of the one app (INTEGRATION-PLAN.md step 2): the hub
   (apps/hub/src/App.jsx) opens this at /settings/, under its own header.

   Its pages are other sections' screens, so it brings their stylesheets: the
   staff schedule's (scoped to this section and the schedule's by
   apps/hub/vite.config.js), Admin settings' and its own. The tracker's
   settings bring the tracker's when opened (projects/src/settings-page.jsx). */
import '../../schedule/src/index.css'
import '../../schedule/src/settings.css'
import '../../admin/src/admin.css'
import './settings.css'
import App from './App.jsx'

export default function SettingsSection() {
  return <App />
}

/* The maintenance schedule as a section of the one app (INTEGRATION-PLAN.md
   step 3): the hub (apps/hub/src/App.jsx) opens this at /maintenance/, under
   its own header. The kit is already loaded by the shell; this brings the
   section's own styles and its page. */
import './maintenance.css'
import App from './App.jsx'

export default function MaintenanceSection() {
  return <App />
}

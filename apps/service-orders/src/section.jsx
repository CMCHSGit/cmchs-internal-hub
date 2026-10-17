/* Service orders as a section of the one app (INTEGRATION-PLAN.md step 3):
   the hub (apps/hub/src/App.jsx) opens this at /service-orders/, under its
   own header. The kit is already loaded by the shell; this brings the
   section's own styles and its page. */
import './service-orders.css'
import App from './App.jsx'

export default function ServiceOrdersSection() {
  return <App />
}

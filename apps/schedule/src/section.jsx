/* The staff schedule as a section of the one app (INTEGRATION-PLAN.md step 2):
   the hub (apps/hub/src/App.jsx) opens this at /schedule/, under its own
   header. Inside, react-router routes /schedule/my, /schedule/day… as it
   always has, so bookmarks, reminder emails and notifications land in the
   same place.

   Its stylesheet still names things the way the schedule always has (.page,
   .tabs…), so in this build it applies only inside this section:
   apps/hub/vite.config.js scopes it to main.section[data-section="schedule"]
   (and Admin's, which uses it too), and leaves out the kit it imports, which
   the shell has already loaded. */
import './index.css'
import App from './App.jsx'

export default function ScheduleSection() {
  return <App />
}

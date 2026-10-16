/* The project tracker as a section of the one app (INTEGRATION-PLAN.md step 2):
   the hub (apps/hub/src/App.jsx) opens this at /projects/, under its own
   header. The kit is already loaded by the hub; this brings the tracker's own
   styles and its data. Inside, it routes on #/table?job=… and the rest as it
   always has, so old links land in the same place. */
import './projects.css'
import { StoreProvider } from './store.jsx'
import App from './App.jsx'

export default function ProjectsSection() {
  return (
    <StoreProvider>
      <App />
    </StoreProvider>
  )
}

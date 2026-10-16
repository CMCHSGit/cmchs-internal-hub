/* Asks as a section of the one app (INTEGRATION-PLAN.md step 2): the hub
   (apps/hub/src/App.jsx) opens this at /asks/, under its own header. The
   design system kit is already loaded by the hub; this brings Asks' own
   styles and its data. Inside, Asks routes on #/mine, #/all, #/company as it
   always has, so old links and notifications land in the same place. */
import './asks.css'
import { StoreProvider } from './store.jsx'
import App from './App.jsx'

export default function AsksSection() {
  return (
    <StoreProvider>
      <App />
    </StoreProvider>
  )
}

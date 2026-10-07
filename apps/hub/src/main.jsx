import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerServiceWorker } from '../../../shared/register-sw.js'
import '../../../shared/tokens.css'
import './hub.css'
import App from './App.jsx'

// The hub is a launcher with no state worth keeping, so it takes a new deploy
// straight away rather than sitting on a precached copy until someone refreshes.
registerServiceWorker({ reloadOnUpdate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)

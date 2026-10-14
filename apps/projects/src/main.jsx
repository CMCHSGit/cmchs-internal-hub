import React from 'react'
import ReactDOM from 'react-dom/client'
// The CHS typefaces, bundled so they render offline, and the staff schedule's
// stylesheet for the design-system tokens, buttons, inputs and light/dark.
import '@fontsource/source-sans-3/latin-300.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/titillium-web/latin-600.css'
import '../../schedule/src/index.css'
import '../../../shared/tool-chrome.css'
import './projects.css'
import { registerServiceWorker } from '../../../shared/register-sw.js'
import { mountToolChrome } from '../../../shared/tool-chrome.js'
import { StoreProvider } from './store.jsx'
import App from './App.jsx'

registerServiceWorker()

// The header, back button and light/dark switch, shared with the other tools.
mountToolChrome()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>
)

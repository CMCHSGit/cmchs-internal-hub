import React from 'react'
import ReactDOM from 'react-dom/client'
// The screens here are the staff schedule's, so they bring its look with
// them: its typefaces, and its stylesheet for the cards, buttons and inputs.
import '@fontsource/source-sans-3/latin-300.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/titillium-web/latin-600.css'
import '../../schedule/src/index.css'
import '../../../shared/tool-chrome.css'
import './admin.css'
import { registerServiceWorker } from '../../../shared/register-sw.js'
import { mountToolChrome } from '../../../shared/tool-chrome.js'
import App from './App.jsx'

// No reload when a new deploy takes over: that would throw away an Excel
// import part-way through.
registerServiceWorker()

// The header, back button and light/dark switch are shared with the other
// tools so they look and behave the same in all of them. Before React, which
// renders the signed-in name into #who once it has moved inside the actions.
mountToolChrome()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

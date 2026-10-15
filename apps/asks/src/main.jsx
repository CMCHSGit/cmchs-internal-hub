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
import './asks.css'
import { registerServiceWorker } from '../../../shared/register-sw.js'
import { mountToolChrome } from '../../../shared/tool-chrome.js'
import { StoreProvider } from './store.jsx'
import App from './App.jsx'

registerServiceWorker()

// After a deploy the first refresh can still show the old version. When the
// new one takes over, reload into it: straight away if nobody is typing or
// has a dialog open, otherwise once they leave the field or switch away.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let waiting = false
  let reloaded = false
  const busy = () => document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]')
  const reloadIfIdle = () => {
    if (!waiting || reloaded || (busy() && document.visibilityState === 'visible')) return
    reloaded = true
    window.location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return // a first install, not an update
    waiting = true
    reloadIfIdle()
  })
  document.addEventListener('visibilitychange', reloadIfIdle)
  document.addEventListener('focusout', () => setTimeout(reloadIfIdle, 500))
}

// The header, back button and light/dark switch, shared with the other tools.
mountToolChrome()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>
)

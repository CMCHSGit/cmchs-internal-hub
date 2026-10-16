import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerServiceWorker } from '../../../shared/register-sw.js'
import { applyStartPage, interceptLinks, normaliseSectionPath, restoreRedirect } from './router.js'
// The typefaces, then the one design system every section uses (tokens,
// light/dark, base styles, components), then the hub pages' own look, which
// vite.config.js keeps inside .hub-page so it can't restyle other sections.
import '../../../shared/tokens/fonts.css'
import '../../../shared/ui/ui.css'
import '../../../shared/tokens/base.css'
import './hub.css'
import './shell.css'
import App from './App.jsx'

// A deep link that came via 404.html (/?redirect=/asks/…): put it back first;
// then plain "/" goes to the start page chosen in Settings, if any.
restoreRedirect()
applyStartPage()
normaliseSectionPath()
// Links between sections move within the app instead of loading a new page.
interceptLinks()

// Take a new deploy without anyone refreshing, but never while they're typing
// or have a dialog open: everything saves as it goes, so a reload then is safe.
registerServiceWorker({ reloadOnUpdate: 'idle' })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)

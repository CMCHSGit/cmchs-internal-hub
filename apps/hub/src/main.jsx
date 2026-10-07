import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerServiceWorker } from '../../../shared/register-sw.js'
import '../../../shared/tokens.css'
import './hub.css'
import App from './App.jsx'

registerServiceWorker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)

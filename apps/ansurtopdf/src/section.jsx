/* The Ansur PVT Report Builder as a section of the one app
   (INTEGRATION-PLAN.md step 3): the hub (apps/hub/src/App.jsx) opens this at
   /ansurtopdf/, under its own header.

   Moved in with its working code as it is, restyled onto the kit (ansur.css):
   it builds PDF reports from Fluke Ansur records, and a rewrite could only be
   trusted once checked against real .mtr files. So its page is its old markup
   (page.html), driven by id as before: builder.js turns the records into PDFs
   (with pdf-lib, loaded here first) and simpro.js attaches them to a Simpro
   job. Rewriting it as components is a later job. */
import { useEffect, useRef, useState } from 'react'
import { Alert, Loading } from '../../../shared/ui/index.jsx'
import page from '../page.html?raw'
import pdfLibUrl from '../vendor/pdf-lib.min.js?url'
import { mountBuilder } from '../builder.js'
import { mountSimproPanel } from '../simpro.js'
import './ansur.css'

// pdf-lib as the classic script it has always been (it defines window.PDFLib),
// loaded once and only when Ansur is opened: 500 KB nobody else should pay for.
let pdfLib = null
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve()
  if (!pdfLib) {
    pdfLib = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = pdfLibUrl
      s.onload = resolve
      s.onerror = () => { pdfLib = null; reject(new Error('Could not load the PDF library. Check the connection and open Ansur again.')) }
      document.head.appendChild(s)
    })
  }
  return pdfLib
}

export default function AnsurSection() {
  const box = useRef(null)
  const [state, setState] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    loadPdfLib().then(() => { if (live) setState('ready') }).catch((e) => { if (live) { setError(e.message); setState('error') } })
    return () => { live = false }
  }, [])

  useEffect(() => {
    // Once per page: both attach their own handlers, and a second start on the
    // same page (React re-running this in development) would double them.
    if (state !== 'ready' || !box.current || box.current.dataset.started) return
    box.current.dataset.started = '1'
    mountBuilder()
    mountSimproPanel()
  }, [state])

  return (
    <div className="an-host">
      <div className="an-head">
        <h1 className="an-title">Ansur PVT Report Builder</h1>
        <p className="an-sub">Turn Fluke Ansur test records (.mtr) into PDF reports. The reports are made on this device: nothing is uploaded, and it works offline.</p>
      </div>
      {state === 'loading' && <Loading />}
      {state === 'error' && <Alert tone="critical" title="Ansur didn’t open">{error}</Alert>}
      {state === 'ready' && <div ref={box} className="an-page" dangerouslySetInnerHTML={{ __html: page }} />}
    </div>
  )
}

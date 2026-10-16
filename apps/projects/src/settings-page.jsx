/* The tracker's settings as a page of the one app's Settings
   (apps/settings, /settings/projects), rather than a tab inside the tracker.
   The same screen (views/Settings.jsx), with what it needs from the tracker
   around it: its data, a toast, and the import dialog it opens. Anything it
   would open in the tracker itself (a job) goes there. */
import './projects.css'
import { Alert, Loading } from '../../schedule/src/components/ui'
import Toast, { useToast } from '../../schedule/src/components/Toast'
import { useState } from 'react'
import { navigate } from '../../hub/src/router.js'
import { StoreProvider, useStore } from './store.jsx'
import { Ui } from './App.jsx'
import { ImportDialog } from './dialogs.jsx'
import Settings from './views/Settings.jsx'

const inTracker = (view, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  navigate(`/projects/#/${view}${q ? '?' + q : ''}`)
}

export default function TrackerSettings() {
  return (
    <StoreProvider>
      <Page />
    </StoreProvider>
  )
}

function Page() {
  const s = useStore()
  const [toastMsg, toast] = useToast()
  const [importing, setImporting] = useState(false)
  if (s.error && !s.ready) return <Alert tone="critical" title="The project tracker's settings didn't load">{s.error}</Alert>
  if (!s.user || !s.ready) return <Loading />

  const ui = {
    route: { view: 'settings', params: {} },
    toast,
    openImport: () => setImporting(true),
    go: inTracker,
    openJob: (id) => inTracker('table', { job: id }),
    closeJob: () => {},
  }
  return (
    <Ui.Provider value={ui}>
      <div className="pt-in-settings">
        <Settings />
      </div>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      <Toast message={toastMsg} />
    </Ui.Provider>
  )
}

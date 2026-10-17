/* SimproSync as a section of the one app (INTEGRATION-PLAN.md step 3): the
   hub (apps/hub/src/App.jsx) opens this at /simprosync/, under its own header.

   Moved in with its working code as it is, restyled onto the kit
   (simprosync.css): it creates, updates and deletes customer assets in
   Simpro, and a rewrite could only be trusted once tested against Simpro.
   So its page is its old markup (page.html) and app.js drives it by id, as
   before. Rewriting it as components is a later job. */
import { useEffect, useRef } from 'react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Loading } from '../../../shared/ui/index.jsx'
import page from '../page.html?raw'
import { mountSimproSync } from '../mount.js'
import './simprosync.css'

export default function SimproSyncSection() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

function Gate() {
  const { user, profile, profileReady } = useAuth()
  if (user === undefined || (user && !profileReady)) return <div className="ss-host"><Loading /></div>
  // Admins always; anyone else once an admin turns on their Simpro access in
  // Settings → People and access: the same rule the proxy applies to every call.
  if (profile?.role !== 'admin' && profile?.simproAccess !== true) {
    return (
      <div className="ss-host">
        <Alert tone="info" title="SimproSync needs Simpro access">
          {user?.email} doesn’t have Simpro access. An admin can turn it on for you in Settings → People and access.
        </Alert>
      </div>
    )
  }
  return <Tool user={user} profile={profile} />
}

function Tool({ user, profile }) {
  const box = useRef(null)
  useEffect(() => {
    // Once per page: app.js attaches its own handlers, and a second start on
    // the same page (React re-running this in development) would double them.
    if (!box.current || box.current.dataset.started) return
    box.current.dataset.started = '1'
    mountSimproSync({ user, profile })
  }, [user, profile])
  return (
    <div className="ss-host">
      <div className="ss-head">
        <h1 className="ss-title">SimproSync</h1>
        <p className="ss-sub">Updates and adds customer assets in cass.simprosuite.com from an asset list.</p>
      </div>
      <div ref={box} className="ss-page" dangerouslySetInnerHTML={{ __html: page }} />
    </div>
  )
}

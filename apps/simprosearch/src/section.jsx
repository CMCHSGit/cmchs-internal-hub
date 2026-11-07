/* Simpro Deep Search as a section of the one app: the hub (apps/hub/src/App.jsx) opens this at /simprosearch/, under its own
   header. Phase 1 is read only: it can search and read, and has no way to change anything in Simpro. */
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Loading } from '../../../shared/ui/index.jsx'
import App from './App.jsx'
import './simprosearch.css'

export default function SimproSearchSection() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

function Gate() {
  const { user, profile, profileReady } = useAuth()
  if (user === undefined || (user && !profileReady)) return <div className="ds-page"><Loading /></div>
  // The same rule the Simpro relay applies to every call: admins, and anyone an admin has given Simpro access
  // (Settings → People and access).
  if (profile?.role !== 'admin' && profile?.simproAccess !== true) {
    return (
      <div className="ds-page">
        <Alert tone="info" title="Simpro Deep Search needs Simpro access">
          {user?.email} doesn’t have Simpro access. An admin can turn it on for you in Settings → People and access.
        </Alert>
      </div>
    )
  }
  return <App />
}

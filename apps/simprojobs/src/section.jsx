/* Simpro Jobs as a section of the one app: the hub (apps/hub/src/App.jsx) opens this at /simprojobs/, under its own header.
   Looking things up is read only; the one write (making a job) runs only from the button on the review screen (Review.jsx, plan.js). */
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Loading } from '../../../shared/ui/index.jsx'
import App from './App.jsx'
import './simprojobs.css'

export default function SimproJobsSection() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

function Gate() {
  const { user, profile, profileReady } = useAuth()
  if (user === undefined || (user && !profileReady)) return <div className="sj-page"><Loading /></div>
  // The same rule the Simpro relay applies to every call: admins, and anyone an admin has given Simpro access
  // (Settings → People and access).
  if (profile?.role !== 'admin' && profile?.simproAccess !== true) {
    return (
      <div className="sj-page">
        <Alert tone="info" title="Simpro Jobs needs Simpro access">
          {user?.email} doesn’t have Simpro access. An admin can turn it on for you in Settings → People and access.
        </Alert>
      </div>
    )
  }
  return <App />
}

import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Button, StripeRule } from './ui'

function hasTeam(profile) {
  return Boolean(profile?.team?.trim())
}

// Someone with no team yet. A team grants rights across the hub (who edits
// maintenance and service orders, posts news, sees a team's asks), so people
// don't choose their own: an admin or HR sets it (Settings → People and
// access, or People). firestore.rules enforces that. This just says so, once
// per visit, and gets out of the way.
const SEEN_KEY = 'sch:noTeamSeen'

export default function TeamOnboarding() {
  const { user, profile, profileReady } = useAuth()
  const [closed, setClosed] = useState(() => { try { return sessionStorage.getItem(SEEN_KEY) === '1' } catch { return false } })

  // Wait for Firestore profile — avoids showing popup on every refresh while profile is null
  if (!user || !profileReady || hasTeam(profile) || closed) return null

  function close() {
    try { sessionStorage.setItem(SEEN_KEY, '1') } catch { /* private mode */ }
    setClosed(true)
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <StripeRule thickness={5} />
        <div className="onboarding-inner">
          <h2 className="onboarding-title" id="onboarding-title">Your team isn’t set yet</h2>
          <p className="text-sm text-muted">
            An admin or HR puts you on your team. It decides which group you’re in on the team schedule, and what you can see and change across the hub.
          </p>
          <p className="text-sm text-muted">
            If it hasn’t been done in a day or so, let your manager or HR know. You can use the schedule in the meantime.
          </p>
          <Button block onClick={close}>Got it</Button>
        </div>
      </div>
    </div>
  )
}

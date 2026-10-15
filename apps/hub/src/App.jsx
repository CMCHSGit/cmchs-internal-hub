import { useEffect, useState } from 'react'
import { configured, nextPath, watchUser } from '../../../shared/session.js'
import Header from './Header.jsx'
import Home from './Home.jsx'
import Manage from './Manage.jsx'
import People from './People.jsx'
import PushPrompt from './PushPrompt.jsx'
import SignIn from './SignIn.jsx'

function routeOf() {
  const m = location.hash.match(/^#\/people(?:\/([^/?#]+))?/)
  if (m) return { page: 'people', uid: m[1] ? decodeURIComponent(m[1]) : null }
  const g = location.hash.match(/^#\/manage(?:\/([^/?#]+))?/)
  if (g) return { page: 'manage', tab: g[1] || 'news' }
  return { page: 'home' }
}

export default function App() {
  // undefined = still checking the saved session, null = signed out
  const [user, setUser] = useState(undefined)

  useEffect(() => watchUser(setUser), [])

  // Hash routes, so they need nothing from GitHub Pages: #/people, #/people/<uid>, #/manage, #/manage/<tab>
  const [route, setRoute] = useState(routeOf)
  useEffect(() => {
    const onHash = () => { setRoute(routeOf()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Sent here by a tool's sign-in check (/?next=/maintenance/): go back once signed in
  const next = nextPath()
  useEffect(() => {
    if (user && next) location.replace(next)
  }, [user, next])

  if (!configured && !import.meta.env.DEV) {
    return <SignIn error="This build of the hub is missing its sign-in settings. Tell whoever looks after the hub." />
  }
  if (user === undefined || (user && next)) return <div className="boot" aria-busy="true" />
  if (!user) return <SignIn />

  return (
    <div className="shell">
      <Header user={user} search={route.page !== 'home'} page={route.page} />
      {route.page === 'people' ? <People user={user} route={route} />
        : route.page === 'manage' ? <Manage user={user} route={route} />
        : <Home user={user} />}
      <PushPrompt user={user} />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { configured, nextPath, watchUser } from '../../../shared/session.js'
import Header from './Header.jsx'
import Home from './Home.jsx'
import SignIn from './SignIn.jsx'

export default function App() {
  // undefined = still checking the saved session, null = signed out
  const [user, setUser] = useState(undefined)

  useEffect(() => watchUser(setUser), [])

  // Sent here by a tool's sign-in check (/?next=/service/ansur/): go back once signed in
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
      <Header user={user} />
      <Home user={user} />
    </div>
  )
}

// The one app's shell (INTEGRATION-PLAN.md step 2): sign-in once, one header,
// and the section the address points at. The hub's own pages (home, People,
// Manage) and the tools that have moved in (the schedule, Asks, Projects) and
// Settings are all sections;
// moving between them never reloads the page (router.js).
import { Component, lazy, Suspense, useEffect, useState } from 'react'
import { configured, nextPath, watchUser } from '../../../shared/session.js'
import { sectionOf, useAddress } from './router.js'
import Header from './Header.jsx'
import Home from './Home.jsx'
import Manage from './Manage.jsx'
import Palette from './Palette.jsx'
import People from './People.jsx'
import PushPrompt from './PushPrompt.jsx'
import SignIn from './SignIn.jsx'

// Each moved tool loads the first time someone opens it, not with the home page.
const AsksSection = lazy(() => import('../../asks/src/section.jsx'))
const ProjectsSection = lazy(() => import('../../projects/src/section.jsx'))
const SettingsSection = lazy(() => import('../../settings/src/section.jsx'))
const ServiceOrdersSection = lazy(() => import('../../service-orders/src/section.jsx'))
const MaintenanceSection = lazy(() => import('../../maintenance/src/section.jsx'))
const ScheduleSection = lazy(() => import('../../schedule/src/section.jsx'))

// A section that fails to load or crashes (most often: a deploy has replaced
// the files an open tab was about to fetch) says so, rather than blanking the
// header and every other section with it.
class SectionBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err) { console.error('[shell] section failed', err) }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="hub-page"><div className="section-failed">
        <p>This part of the hub didn’t load. It may have just been updated.</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
      </div></div>
    )
  }
}

// The hub's own pages still route on #/: #/people, #/people/<uid>, #/manage, #/manage/<tab>
function hubRouteOf() {
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

  useAddress() // re-render on every address change
  const section = sectionOf(location.pathname) || 'hub'
  const route = section === 'hub' ? hubRouteOf() : null
  const page = section === 'hub' ? route.page : section

  // The hub pages' page colour (hub.css) only applies while they're showing.
  useEffect(() => { document.body.dataset.section = section }, [section])
  // The header's height, for sections with their own sticky bars (--shell-header-h).
  useEffect(() => {
    const header = document.querySelector('header.header')
    if (!header || !window.ResizeObserver) return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--shell-header-h', header.offsetHeight + 'px'))
    ro.observe(header)
    return () => ro.disconnect()
  }, [user])
  // A new hub page starts at the top, as a new page load would.
  useEffect(() => { window.scrollTo(0, 0) }, [page, route?.uid, route?.tab])

  // Sent here by a tool's sign-in check (/?next=/maintenance/): go back once signed in
  const next = nextPath()
  useEffect(() => {
    if (user && next) location.replace(next)
  }, [user, next])

  if (!configured && !import.meta.env.DEV) {
    return <div className="hub-page"><SignIn error="This build of the hub is missing its sign-in settings. Tell whoever looks after the hub." /></div>
  }
  if (user === undefined || (user && next)) return <div className="hub-page"><div className="boot" aria-busy="true" /></div>
  if (!user) return <div className="hub-page"><SignIn /></div>

  return (
    <div className="shell">
      <div className="hub-page hub-chrome">
        <Header user={user} search={page !== 'home'} page={page} />
      </div>
      {section === 'hub' ? (
        <div className="hub-page">
          {route.page === 'people' ? <People user={user} route={route} />
            : route.page === 'manage' ? <Manage user={user} route={route} />
            : <Home user={user} />}
        </div>
      ) : (
        <main className="section" data-section={section}>
          <SectionBoundary key={section}>
            <Suspense fallback={<div className="section-loading" aria-busy="true" />}>
              {section === 'asks' && <AsksSection />}
              {section === 'projects' && <ProjectsSection />}
              {section === 'settings' && <SettingsSection />}
              {section === 'service-orders' && <ServiceOrdersSection />}
              {section === 'maintenance' && <MaintenanceSection />}
              {section === 'schedule' && <ScheduleSection />}
            </Suspense>
          </SectionBoundary>
        </main>
      )}
      <div className="hub-page hub-chrome"><PushPrompt user={user} /></div>
      {/* Outside .hub-page: the one search opens over every section, in the kit's look. */}
      <Palette user={user} />
    </div>
  )
}

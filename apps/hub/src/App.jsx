// The one app's shell (INTEGRATION-PLAN.md step 2): sign-in once, one header,
// and the section the address points at. The hub's own pages (home, People,
// Manage) and the tools that have moved in (the schedule, Asks, Projects) and
// Settings are all sections;
// moving between them never reloads the page (router.js).
import { Component, lazy, Suspense, useEffect, useState } from 'react'
import { configured, nextPath, watchUser } from '../../../shared/session.js'
import { reloadOntoLatest } from '../../../shared/register-sw.js'
import { sectionOf, useAddress } from './router.js'
import Header from './Header.jsx'
import Home from './Home.jsx'
import Manage from './Manage.jsx'
import NewsPost from './NewsPost.jsx'
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
const OncallSection = lazy(() => import('../../oncall/src/section.jsx'))
const ChecklistsSection = lazy(() => import('../../checklists/src/section.jsx'))
const SimproSyncSection = lazy(() => import('../../simprosync/src/section.jsx'))
const AnsurSection = lazy(() => import('../../ansurtopdf/src/section.jsx'))
const EquipmentSection = lazy(() => import('../../equipment/src/section.jsx'))
const ScheduleSection = lazy(() => import('../../schedule/src/section.jsx'))

/** A touch-screen phone or tablet: no Reload button there (SectionBoundary). */
const PHONE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

// A page opened before a deploy asks for a section's file by its old name,
// which the deploy removed: update onto the new version by itself, once a
// minute at most, so a real fault shows the message, not a loop.
function updateOnce(err) {
  const missing = /dynamically imported module|Importing a module script failed|error loading dynamically|Unable to preload CSS/i.test(String(err?.message || err))
  let last = 0
  try { last = Number(sessionStorage.getItem('hub:chunkReload')) || 0 } catch { /* private mode */ }
  return missing && Date.now() - last > 60000
}
// A section that fails to load or crashes (most often: a deploy has replaced
// the files an open tab was about to fetch) says so, rather than blanking the
// header and every other section with it.
class SectionBoundary extends Component {
  state = { failed: false, updating: false, detail: '' }
  static getDerivedStateFromError(err) { return { failed: true, updating: updateOnce(err), detail: String(err?.message || err).slice(0, 200) } }
  componentDidCatch(err) {
    console.error('[shell] section failed', err)
    if (!this.state.updating) {
      // Phones get no Reload button: it tries again by itself the next time
      // the app is in the background, so it's loaded when they come back.
      if (PHONE) document.addEventListener('visibilitychange', this.reloadIfHidden)
      return
    }
    try { sessionStorage.setItem('hub:chunkReload', String(Date.now())) } catch { /* private mode */ }
    reloadOntoLatest()
  }
  componentWillUnmount() { document.removeEventListener('visibilitychange', this.reloadIfHidden) }
  reloadIfHidden = () => { if (document.visibilityState === 'hidden') reloadOntoLatest() }
  reload = () => { this.setState({ updating: true }); reloadOntoLatest() }
  render() {
    if (!this.state.failed) return this.props.children
    if (this.state.updating) {
      return <div className="hub-page"><div className="section-failed"><p aria-busy="true">Getting the latest version of the hub…</p></div></div>
    }
    return (
      <div className="hub-page"><div className="section-failed">
        <p>This part of the hub didn’t load. It may have just been updated.</p>
        {PHONE
          ? <p>Switch to another app and back, and it will load the latest version.</p>
          : <button className="btn btn-primary btn-lg" onClick={this.reload}>Reload</button>}
        {/* What went wrong, for whoever looks after the hub (a screenshot tells them) */}
        {this.state.detail && <p className="section-failed-detail">{this.state.detail}</p>}
      </div></div>
    )
  }
}

// The hub's own pages still route on #/: #/people, #/people/<uid>, #/manage, #/manage/<tab>, #/news/<id>
function hubRouteOf() {
  const m = location.hash.match(/^#\/people(?:\/([^/?#]+))?/)
  if (m) return { page: 'people', uid: m[1] ? decodeURIComponent(m[1]) : null }
  const g = location.hash.match(/^#\/manage(?:\/([^/?#]+))?/)
  if (g) return { page: 'manage', tab: g[1] || 'news' }
  const n = location.hash.match(/^#\/news\/([^/?#]+)/)
  if (n) return { page: 'news', id: decodeURIComponent(n[1]) }
  return { page: 'home' }
}

const SERVICE_TOOLS = ['service-orders', 'maintenance', 'oncall', 'checklists', 'simprosync', 'ansurtopdf']

export default function App() {
  // undefined = still checking the saved session, null = signed out
  const [user, setUser] = useState(undefined)
  useEffect(() => watchUser(setUser), [])

  useAddress() // re-render on every address change
  const section = sectionOf(location.pathname) || 'hub'
  const route = section === 'hub' ? hubRouteOf() : null
  // The service tools highlight the Service tab
  const page = section === 'hub' ? route.page : SERVICE_TOOLS.includes(section) ? 'service' : section

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
  // Everyone signed in needs a users record, whichever section they open
  // first; a first sign-in's is made here (apps/schedule/src/profile.js).
  // Nothing is shown until it's there (or has failed, which is logged and
  // gets out of the way), so no page reads the roster before the person is on it.
  const [profileFor, setProfileFor] = useState(null) // the uid whose record is settled
  useEffect(() => {
    if (!user || !configured) return
    let live = true
    import('../../schedule/src/profile.js')
      .then(({ ensureProfile }) => ensureProfile(user))
      .catch(e => console.warn('[shell] profile not made', e))
      .finally(() => { if (live) setProfileFor(user.uid) })
    return () => { live = false }
  }, [user])
  // A new hub page starts at the top, as a new page load would.
  useEffect(() => { window.scrollTo(0, 0) }, [page, route?.uid, route?.tab, route?.id])

  // Sent here by a tool's sign-in check (/?next=/maintenance/): go back once signed in
  const next = nextPath()
  useEffect(() => {
    if (user && next) location.replace(next)
  }, [user, next])

  if (!configured && !import.meta.env.DEV) {
    return <div className="hub-page"><SignIn error="This build of the hub is missing its sign-in settings. Tell whoever looks after the hub." /></div>
  }
  if (user === undefined || (user && next) || (user && configured && profileFor !== user.uid)) return <div className="hub-page"><div className="boot" aria-busy="true" /></div>
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
            : route.page === 'news' ? <NewsPost user={user} id={route.id} />
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
              {section === 'oncall' && <OncallSection />}
              {section === 'checklists' && <ChecklistsSection />}
              {section === 'simprosync' && <SimproSyncSection />}
              {section === 'ansurtopdf' && <AnsurSection />}
              {section === 'equipment' && <EquipmentSection />}
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

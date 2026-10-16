import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { CalendarCheck, CalendarDays, MapPin, CalendarRange, Phone, Settings as SettingsIcon, Plane } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login         from './pages/Login'
import MySchedule    from './pages/MySchedule'
import TeamWeek      from './pages/TeamWeek'
import DayView       from './pages/DayView'
import LeaveCalendar from './pages/LeaveCalendar'
import OnCall        from './pages/OnCall'
import OutOfTown     from './pages/OutOfTown'
import TeamOnboarding from './components/TeamOnboarding'
import PullToRefresh  from './components/PullToRefresh'
import { Loading } from './components/ui'

// Admins only, and it brings the Excel import with it: loaded when opened.
const Settings = lazy(() => import('./pages/Settings'))

// The schedule's own views: short labels on a phone, fuller ones on a desktop.
// Team week is the landing page — it's what everyone else is doing, which is
// the more useful thing to see first; My week has its own path.
const VIEWS = [
  { to: '/',            label: 'Team',        tab: 'Team week',      Icon: CalendarDays },
  { to: '/my',          label: 'My week',     tab: 'My week',        Icon: CalendarCheck },
  { to: '/day',         label: 'Day',         tab: 'Day',            Icon: MapPin },
  { to: '/leave',       label: 'Leave',       tab: 'Leave calendar', Icon: CalendarRange },
  { to: '/oncall',      label: 'On call',     tab: 'On call',        Icon: Phone },
  { to: '/out-of-town', label: 'Out of town', tab: 'Out of town',    Icon: Plane },
]

/**
 * The staff schedule as a section of the hub's one app (section.jsx): the hub
 * draws the header, the account menu, light/dark and the phone tab bar; this
 * is the row of the schedule's own views and the view itself.
 */
export default function App() {
  return (
    <AuthProvider>
      {/* Served under /schedule/. basename strips that prefix, so every route
          and NavLink below stays a plain "/…" path — and every existing
          bookmark, reminder-email link and push notification URL keeps
          working, which a HashRouter would have broken. */}
      <BrowserRouter basename="/schedule">
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}

function AppRoutes() {
  const { user, profileReady } = useAuth()
  const [refreshKey, setRefreshKey] = useState(0)

  if (user === undefined || (user && !profileReady)) {
    return <div className="page"><Loading /></div>
  }

  // The hub has signed them in before this opens; only a sign-out in another
  // tab, while this one is open, lands here.
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  async function handleRefresh() {
    // Remounting the active page re-runs its own data-loading effects from
    // scratch — same as navigating away and back, just without leaving the
    // page. The short delay keeps the pull indicator from just flashing shut.
    await new Promise(r => setTimeout(r, 400))
    setRefreshKey(k => k + 1)
  }

  return (
    <div className="sch">
      <TeamOnboarding />
      <Views />
      <PullToRefresh onRefresh={handleRefresh}>
        <Routes key={refreshKey}>
          <Route path="/"       element={<TeamWeek />} />
          <Route path="/my"     element={<MySchedule />} />
          <Route path="/day"    element={<DayView />} />
          <Route path="/leave"  element={<LeaveCalendar />} />
          <Route path="/oncall" element={<OnCall />} />
          <Route path="/settings" element={<Suspense fallback={<Loading />}><Settings /></Suspense>} />
          {/* /admin was the schedule's admin page; its schedule parts are Settings now. */}
          <Route path="/admin"  element={<Navigate to="/settings" replace />} />
          <Route path="/out-of-town" element={<OutOfTown />} />
          {/* /team was Team week's path before it became the default — kept
              working for anyone's old bookmark or home-screen shortcut. */}
          <Route path="/team"   element={<Navigate to="/" replace />} />
          <Route path="*"       element={<Navigate to="/" replace />} />
        </Routes>
      </PullToRefresh>
    </div>
  )
}

function Views() {
  const { profile } = useAuth()
  const views = profile?.role === 'admin'
    // The schedule's own settings (locations, Excel, activity log). People and
    // notifications are in the hub's Admin settings, linked from there.
    ? [...VIEWS, { to: '/settings', label: 'Settings', tab: 'Settings', Icon: SettingsIcon }]
    : VIEWS
  return (
    <nav className="sch-views" aria-label="Staff schedule">
      {views.map(({ to, label, tab, Icon }) => (
        <NavLink key={to} to={to} end className={({ isActive }) => `sch-view${isActive ? ' active' : ''}`}>
          <Icon size={18} aria-hidden="true" />
          <span className="sch-view-label-short">{label}</span>
          <span className="sch-view-label-long">{tab}</span>
        </NavLink>
      ))}
    </nav>
  )
}

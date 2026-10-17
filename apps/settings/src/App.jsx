/* The one app's Settings (INTEGRATION-PLAN.md step 2), at /settings/, from
   the header's gear. Three groups down the side (along the top on a phone):

     You       Appearance, Notifications: anyone, about themselves.
     Admin     People and access, Everyone's notifications: admins only, behind
               the admin password, as Admin settings at /admin/ was.
     Sections  each section's own settings: the staff schedule's (admins), the
               project tracker's and Maintenance's (its PM types).

   Pages are real paths (/settings/people…) through react-router, so a page's
   own tabs keep the #… part, as the schedule's always have
   (/settings/schedule#excel). The screens are the sections' own, unchanged. */
import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Bell, CalendarDays, FolderKanban, Palette, ShieldCheck, Users, Wrench } from 'lucide-react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import AdminLock, { isUnlocked } from '../../schedule/src/components/AdminLock'
import { Loading } from '../../../shared/ui/index.jsx'
import { Appearance, MyNotifications } from './You.jsx'

// Each brings its section's code: loaded when opened.
const UsersTab = lazy(() => import('../../admin/src/Admin.jsx').then(m => ({ default: m.UsersTab })))
const NotificationsTab = lazy(() => import('../../admin/src/Admin.jsx').then(m => ({ default: m.NotificationsTab })))
const ScheduleSettings = lazy(() => import('../../schedule/src/pages/Settings.jsx'))
const TrackerSettings = lazy(() => import('../../projects/src/settings-page.jsx'))
const PmTypes = lazy(() => import('../../maintenance/src/PmTypes.jsx'))

const PAGES = [
  { group: 'You', to: '/', label: 'Appearance', Icon: Palette, title: 'Appearance', sub: 'Light or dark, and where the hub opens. For this device.' },
  { group: 'You', to: '/you/notifications', label: 'Notifications', Icon: Bell, title: 'Your notifications', sub: 'This phone, and the reminders you get.' },
  { group: 'Admin', admin: true, to: '/people', label: 'People and access', Icon: Users, title: 'People and access', sub: 'Teams, roles, Simpro access and demo tracker roles, for every tool.' },
  { group: 'Admin', admin: true, to: '/notifications', label: 'Everyone’s notifications', Icon: ShieldCheck, title: 'Everyone’s notifications', sub: 'Who gets which reminders, across the tools.' },
  { group: 'Sections', admin: true, to: '/schedule', label: 'Staff schedule', Icon: CalendarDays, title: 'Staff schedule', sub: 'Location suggestions, the Excel import and the activity log.' },
  { group: 'Sections', to: '/projects', label: 'Project tracker', Icon: FolderKanban, title: 'Project tracker', sub: 'Staff, categories, statuses, demo equipment and backups.' },
  { group: 'Sections', to: '/maintenance', label: 'Maintenance', Icon: Wrench, title: 'Maintenance', sub: 'The PM types a site can be scheduled for.' },
]

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/settings">
        <Layout />
      </BrowserRouter>
    </AuthProvider>
  )
}

function Layout() {
  const { user, profile, profileReady } = useAuth()
  if (user === undefined || (user && !profileReady)) return <div className="page"><Loading /></div>
  const admin = profile?.role === 'admin'
  const pages = PAGES.filter(p => admin || !p.admin)
  const groups = [...new Set(pages.map(p => p.group))]

  return (
    <div className="st">
      <nav className="st-nav" aria-label="Settings">
        {groups.map(g => (
          <div key={g} className="st-nav-group" role="group" aria-label={g}>
            <span className="overline st-nav-head">{g}</span>
            {pages.filter(p => p.group === g).map(p => (
              <NavLink key={p.to} to={p.to} end className={({ isActive }) => `st-nav-link${isActive ? ' on' : ''}`}>
                <p.Icon size={18} aria-hidden="true" /><span>{p.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="st-main">
        <Suspense fallback={<div className="page"><Loading /></div>}>
          <Routes>
            <Route path="/" element={<Page p={PAGES[0]}><Appearance /></Page>} />
            <Route path="/you/notifications" element={<Page p={PAGES[1]}><MyNotifications /></Page>} />
            <Route path="/people" element={<Page p={PAGES[2]}><AdminOnly><div className="page admin-page"><UsersTab /></div></AdminOnly></Page>} />
            <Route path="/notifications" element={<Page p={PAGES[3]}><AdminOnly><div className="page admin-page"><NotificationsTab /></div></AdminOnly></Page>} />
            {/* Has its own admin check and password, as it always had. */}
            <Route path="/schedule" element={<Page p={PAGES[4]}><ScheduleSettings /></Page>} />
            <Route path="/projects" element={<Page p={PAGES[5]}><TrackerSettings /></Page>} />
            <Route path="/maintenance" element={<Page p={PAGES[6]}><PmTypes /></Page>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}

function Page({ p, children }) {
  return (
    <>
      <div className="st-head">
        <h1 className="st-title">{p.title}</h1>
        {p.sub && <p className="st-sub">{p.sub}</p>}
      </div>
      {children}
    </>
  )
}

/** Admins only, and the admin password once per session, as Admin settings asked. */
function AdminOnly({ children }) {
  const { user, profile } = useAuth()
  const [unlocked, setUnlocked] = useState(isUnlocked)
  if (profile?.role !== 'admin') {
    return <div className="page page-narrow"><div className="card admin-gate"><p>This is for admins, and {user?.email} isn’t one. An existing admin can give you the admin role.</p></div></div>
  }
  if (!unlocked) return <AdminLock onUnlock={() => setUnlocked(true)} />
  return children
}

import { Settings } from 'lucide-react'

/**
 * /schedule/admin, kept so old bookmarks don't just bounce to Team week.
 * Admin — people, roles, Simpro access, locations, the Excel import and the
 * activity log — is now a page of the hub (apps/admin), at /admin/.
 */
export default function AdminMoved() {
  return (
    <div className="page page-narrow">
      <div className="card admin-moved">
        <p>Admin settings moved to the Internal Hub.</p>
        <a className="btn btn-primary btn-md" href="/admin/">
          <Settings size={18} aria-hidden="true" />
          Open admin settings
        </a>
      </div>
    </div>
  )
}

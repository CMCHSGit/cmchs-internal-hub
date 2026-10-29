// A line in the hub's activity log (shared/activity.js), loaded only when there is something to record
// so the hub's first load doesn't carry Firestore. Never throws; does nothing when nobody is signed in (dev).
export const log = (summary) => import('../../../shared/activity.js').then((m) => m.logActivity(null, summary, { app: 'hub' })).catch(() => {})

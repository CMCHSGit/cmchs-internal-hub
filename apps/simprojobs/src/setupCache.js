/* Cost centres and the custom fields' options hardly ever change: the answer is kept for half an hour (per browser tab) so a reopened page,
   and the other tab of this tool, is instant. Shared by the New job form and the Find screen. */
const SETUP_TTL = 30 * 60 * 1000
const setupKey = (companyId) => 'simprojobs.setup2.' + companyId // 2: priority became a custom field, so an older saved answer has the wrong shape

export const readSetup = (companyId) => {
  try {
    const s = JSON.parse(sessionStorage.getItem(setupKey(companyId)))
    return s && Date.now() - s.at < SETUP_TTL ? s.data : null
  } catch { return null }
}

export const writeSetup = (companyId, data) => { try { sessionStorage.setItem(setupKey(companyId), JSON.stringify({ at: Date.now(), data })) } catch { /* no cache then */ } }

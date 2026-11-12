/* Simpro Jobs: the new-job form's own rules, apart from the page. No React and no Simpro calls, so the tests run it as it is. */

/** Far above any real description or note; Simpro's own limit isn't documented, so this only stops a runaway paste. */
export const MAX_TEXT = 20000

/** What is typed, tidied: one kind of line break, no trailing spaces, no leading or trailing blank lines, capped. */
export function cleanText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '').slice(0, MAX_TEXT)
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Plain text as the small HTML Simpro's description and notes hold (both "support HTML formatting"): a blank line starts a paragraph, a
 * single line break is a <br>, and anything typed that looks like markup is shown as text, never run. '' for nothing.
 */
export function toHtml(text) {
  const t = cleanText(text)
  if (!t) return ''
  return t.split(/\n{2,}/).map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>').join('')
}

/** A job's title (Simpro's "Name"): one short plain line. */
export const MAX_TITLE = 100

/** The title as it will be sent: one line, spaces collapsed, trimmed, cut at MAX_TITLE. */
export const cleanTitle = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)

/**
 * Why a typed title can't be used, in words, or ''. It is plain text, not HTML, so nothing that looks like a tag is accepted (the relay
 * refuses it too); an over-long title is refused rather than silently cut, so what is reviewed is what is sent.
 */
export function titleProblem(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (/[<>]/.test(t)) return 'A title can’t contain < or >.'
  if (t.length > MAX_TITLE) return `A title can be up to ${MAX_TITLE} characters.`
  return ''
}

/** What a job can't be made without, in the order the form shows it: the labels of the fields still empty. Notes are optional. */
export function missing(form) {
  const f = form || {}
  const need = [
    ['Customer', f.customer], ['Site', f.site], ['Cost centre', f.costCentre], ['Job type', f.jobType],
    ['Charge category', f.chargeCategory], ['Priority', f.priority], ['Title', cleanTitle(f.title) && !titleProblem(f.title)], ['Description', cleanText(f.description)],
  ]
  return need.filter(([, v]) => !v).map(([label]) => label)
}

/** True when the form holds something a person typed or chose that Start again would throw away (the usual choices don't count). */
export function hasWork(form) {
  const f = form || {}
  if (cleanText(f.description) || cleanText(f.notes) || cleanTitle(f.title) || f.customer || f.site) return true
  return ['costCentre', 'jobType', 'chargeCategory', 'priority'].some((k) => f[k] && !f[k].usual)
}

/** A long text cut for the summary: the first lines, with how much more there is. */
export function preview(text, max = 160) {
  const t = cleanText(text).replace(/\n+/g, ' · ')
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t
}

/* Shared chrome for the tools: the light/dark switch, and the bits of the
   header that should be identical everywhere.

   The theme choice is stored under the same key the staff schedule uses, so it
   is one choice for the whole of internal.chsnz.co.nz rather than per tool.
   Everything here shares an origin, so that key is genuinely shared.

   The <html data-theme> attribute has to be set before the first paint or the
   page flashes the wrong colours, and a module runs too late for that. Each
   tool's index.html therefore carries a tiny inline script that does it — see
   THEME_BOOT below, which is the text of that script. This file only handles
   the switching afterwards. */

export const THEME_KEY = 'css_theme'

/** The inline snippet each index.html runs before anything renders. */
export const THEME_BOOT = `(function(){try{var t=localStorage.getItem('css_theme');` +
  `if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';` +
  `document.documentElement.dataset.theme=t}catch(e){}})()`

const read = () => {
  try { return localStorage.getItem(THEME_KEY) } catch { return null }
}

export function currentTheme() {
  return document.documentElement.dataset.theme
    || read()
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* private mode */ }
  // Keep the browser's own UI (address bar, pull-to-refresh) in step.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    if (bg) meta.setAttribute('content', bg)
  }
}

const ICONS = `
<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`

/**
 * Adds the theme switch to a tool's header, and makes sure the header carries
 * the shared class so the layout matches the other tools.
 *
 * Returns the actions container, so a tool can put its own status text beside
 * the switch instead of inventing its own corner for it.
 */
export function mountToolChrome({ header = document.querySelector('header') } = {}) {
  if (!header) return null
  header.classList.add('tool-header')

  let actions = header.querySelector('.tool-actions')
  if (!actions) {
    actions = document.createElement('span')
    actions.className = 'tool-actions'
    // Anything the tool already put in its top-right corner moves inside, so
    // there is one cluster rather than two competing ones.
    for (const el of [...header.children]) {
      if (el.classList.contains('who') || el.dataset.toolActions !== undefined) actions.append(el)
    }
    header.append(actions)
  }

  if (!actions.querySelector('.theme-toggle')) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'theme-toggle'
    button.innerHTML = ICONS
    const label = () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark'
      button.title = `Switch to ${next} mode`
      button.setAttribute('aria-label', button.title)
    }
    label()
    button.addEventListener('click', () => {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark')
      label()
    })
    actions.append(button)
  }

  // Follow the system only while no explicit choice has been made.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (read()) return
    document.documentElement.dataset.theme = e.matches ? 'dark' : 'light'
  })

  return actions
}

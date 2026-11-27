// Which part of the site a deploy changed, as the page sees it. Pure, so it is tested without a page
// (apps/hub/tests/build-info.test.mjs); shared/updates.js fetches the file and keeps the state, and
// scripts/build-info.mjs writes it.
//
// /build-info.json (written by the build, never precached) is
//   { v: 1, shell: "<hash>", entry: "assets/main-<hash>.js",
//     sections: { <id>: { hash, js, css: [...], preload: [...] }, ... } }
// `shell` changes when anything every section runs on does (the page, its script, shared/, the service
// worker's file list); a section's `hash` changes when that section's own files do.

export const BUILD_INFO_URL = '/build-info.json'

/** A parsed build-info.json, or null if it is not one (an error page, an older site, half a download). */
export function readBuildInfo(data) {
  if (!data || typeof data !== 'object' || data.v !== 1) return null
  if (typeof data.shell !== 'string' || !data.shell) return null
  if (!data.sections || typeof data.sections !== 'object') return null
  return data
}

/**
 * What a fresh build-info.json says has changed since the one this page started with:
 *   { known, shell, sections }
 * `known` is false when either is missing (offline, not fetched yet): nothing can be said, so the caller
 * keeps what it knew. `sections` lists the ids whose files changed (or that are new), whatever `shell` says.
 */
export function compareBuildInfo(started, fresh) {
  if (!started || !fresh) return { known: false, shell: false, sections: [] }
  const sections = Object.keys(fresh.sections)
    .filter((id) => fresh.sections[id]?.hash !== started.sections?.[id]?.hash)
    .sort()
  return { known: true, shell: started.shell !== fresh.shell, sections }
}

/**
 * Does an update matter to the person's current page? True when the shell changed (every page runs on it)
 * or the section they are in did. A change to a section they are not in waits until they open it.
 */
export function mattersHere({ shellChanged, stale, section }) {
  if (shellChanged) return true
  return !!section && (stale instanceof Set ? stale.has(section) : (stale || []).includes(section))
}

/**
 * The address a section's script comes from, from the build-info this page started with. Null if the
 * file does not know the section.
 */
export function sectionFiles(info, id) {
  const s = info?.sections?.[id]
  if (!s || typeof s.js !== 'string') return null
  return { js: '/' + s.js, css: (s.css || []).map((f) => '/' + f), preload: (s.preload || []).map((f) => '/' + f) }
}

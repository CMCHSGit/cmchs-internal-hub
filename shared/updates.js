// The page's memory of which build it started with, and which sections a later deploy has changed
// (shared/buildInfo.js has the rules; shared/register-sw.js decides what to do about it; apps/hub/src/sections.js
// uses it to find a section's files). Only the one app uses it: plain pages keep reloading on any new version.
//
// Why a section can change without everyone reloading: the shell no longer names the section files.
// It looks them up in /build-info.json, fetched here at start and again on each update check. A deploy
// that changes only the Test Bench leaves the shell and service worker byte for byte as they were, so
// nobody is told to reload; the Test Bench's new files are picked up the next time someone opens it.
import { BUILD_INFO_URL, compareBuildInfo, readBuildInfo } from './buildInfo.js'

let started = null          // the build-info this page started with (null until fetched, or if it could not be)
let startedPromise = null
let shellMismatch = false   // the file is from a newer deploy than the script this page is running
const stale = new Set()     // sections a later deploy has changed
const listeners = new Set()
let lastCheck = 0

/** Fetches build-info.json now, past every cache. Null when offline or it is not a build-info file. */
export async function fetchBuildInfo() {
  try {
    const res = await fetch(BUILD_INFO_URL, { cache: 'no-cache' })
    return res.ok ? readBuildInfo(await res.json()) : null
  } catch {
    return null
  }
}

// The copy of build-info.json that belonged to this script, kept on the device. For when the network copy cannot
// be used: offline with an old page (the worker has fetched a newer file than the page it still serves), or a
// deploy landed while the page was loading.
const SAVED = 'hub:build-info'
function savedFor(entry) {
  try {
    const info = readBuildInfo(JSON.parse(localStorage.getItem(SAVED)))
    return info && info.entry === entry ? info : null
  } catch { return null }
}

/**
 * Remembers the build-info this page started with. `entry` is the page's own script (`import.meta.url`'s
 * path): if the file describes a different one, a deploy landed between the page and the file loading, so
 * the file is not this page's and `shellMismatch` is set for the caller to reload; this page keeps the copy
 * it saved earlier, if it has one, so its sections can still be found meanwhile.
 */
export function startBuildInfo(entry) {
  if (!startedPromise) {
    startedPromise = fetchBuildInfo().then((info) => {
      if (!info) {
        started = entry ? savedFor(entry) : null
      } else if (entry && info.entry && info.entry !== entry) {
        shellMismatch = true
        started = savedFor(entry)
      } else {
        started = info
        try { localStorage.setItem(SAVED, JSON.stringify(info)) } catch { /* private mode: nothing saved */ }
      }
      return started
    })
  }
  return startedPromise
}

/** The build-info this page started with (waits for the fetch; null if it could not be had). */
export const startedInfo = () => startedPromise || startBuildInfo()
export const startedSync = () => started
export const hasShellMismatch = () => shellMismatch
export const isStale = (id) => stale.has(id)
export const staleSections = () => stale
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

/**
 * Compares a fresh build-info.json with the one this page started with, remembers the sections that have
 * changed and tells the listeners. Returns compareBuildInfo's answer; `known: false` when the fresh file or
 * the starting one is missing. `minGapMs` skips the fetch if one ran that recently.
 */
export async function refreshStale({ minGapMs = 0 } = {}) {
  const base = await startedInfo()
  if (!base || Date.now() - lastCheck < minGapMs) return { known: false, shell: false, sections: [] }
  lastCheck = Date.now()
  const result = compareBuildInfo(base, await fetchBuildInfo())
  for (const id of result.sections) stale.add(id)
  if (result.known) listeners.forEach((fn) => fn(result))
  return result
}

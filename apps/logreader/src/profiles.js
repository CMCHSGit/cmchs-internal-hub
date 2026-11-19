/* The device types the Log Reader knows. To add one (a ventilator, an
   anaesthesia machine, a monitor), write a file like defib.js and list it
   here; the viewer itself is the same for all of them. */
import { defib } from './defib.js'

export const PROFILES = [defib]

/** The profile for a set of log family names, or null for "just show the logs". */
export const profileFor = (families) => PROFILES.find(p => p.detect(families)) || null

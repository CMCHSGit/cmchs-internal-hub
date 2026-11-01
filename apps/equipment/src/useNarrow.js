/* True on a phone-width screen: the same width the hub swaps its header tabs for the bottom bar (759px), and
   where equipment.css switches to its compact layout. */
import { useEffect, useState } from 'react'

const QUERY = '(max-width: 759px)'
const supported = () => typeof matchMedia === 'function'

export function useNarrow() {
  const [narrow, setNarrow] = useState(() => supported() && matchMedia(QUERY).matches)
  useEffect(() => {
    if (!supported()) return undefined
    const m = matchMedia(QUERY)
    const on = () => setNarrow(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

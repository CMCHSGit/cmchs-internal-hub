/* A notes box that grows to fit what's in it, so long notes show in full
   instead of hiding behind a one- or two-line box. `rows` is the smallest it
   gets; it follows the text as it's typed and when it's filled in. */
import { useLayoutEffect, useRef } from 'react'

export default function AutoText({ value, rows = 2, className = 'input', ...props }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + (el.offsetHeight - el.clientHeight) + 'px'
    }
    fit()
    // A narrower box (a phone turned, a dialog opening) wraps more lines; only a width change re-measures.
    let width = el.clientWidth
    const ro = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit() } })
      : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [value])
  return <textarea ref={ref} rows={rows} className={className + ' eq-autotext'} value={value} {...props} />
}

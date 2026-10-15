// Small pieces shared by the hub's pages (People, Manage).
import { useEffect, useRef, useState } from 'react'
import { linkParts } from './news.js'

export function Toast({ text }) {
  return text ? <div className="pp-toast" role="status">{text}</div> : null
}

export function useToast() {
  const [text, setText] = useState('')
  const timer = useRef(null)
  return [text, msg => { setText(msg); clearTimeout(timer.current); timer.current = setTimeout(() => setText(''), 3200) }]
}

export const failMsg = e => e?.code === 'permission-denied'
  ? 'You don’t have permission to change that. If you should, the Firestore rules may not be published yet.'
  : (e?.message || 'Couldn’t save that. Try again.')

export function Dialog({ title, children, onClose, wide = false }) {
  useEffect(() => {
    const esc = e => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [])
  return (
    <div className="pp-overlay" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`pp-dialog card ${wide ? 'pp-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

/** Plain text with its web addresses as links. */
export function Linked({ text }) {
  return linkParts(text || '').map(([t, url], i) => (url ? <a key={i} href={url} target="_blank" rel="noopener">{t}</a> : <span key={i}>{t}</span>))
}

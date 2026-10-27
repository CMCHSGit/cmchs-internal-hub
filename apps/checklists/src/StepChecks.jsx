/* One toggle per step on a device: tick what has been done, with who and when on hover. Shared by the list's rows and the scanner. */
import { Check } from 'lucide-react'
import { stamp, tickOf } from './model.js'

export default function StepChecks({ it, steps, onToggle }) {
  return (
    <span className="cl-steps">
      {steps.map((st) => {
        const t = tickOf(it, st.id)
        return (
          <button key={st.id} type="button" className={`cl-step${t ? ' on' : ''}`} aria-pressed={!!t}
            title={t ? `${st.label}: ${t.byName || 'someone'}${t.at ? ', ' + stamp(t.at) : ''}` : st.label}
            onClick={(e) => { e.stopPropagation(); onToggle(it, st, !t) }}>
            {t && <Check size={14} strokeWidth={3} aria-hidden="true" />}{st.label}
          </button>
        )
      })}
    </span>
  )
}

/* My asks: what's waiting for me to pick up, what I'm on, what I asked for,
   and what was finished lately. The page most people live on. */

import { useMemo } from 'react'
import { Bell } from 'lucide-react'
import { Alert, Button } from '../../../schedule/src/components/ui'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { AskList } from '../AskList.jsx'
import { myBuckets } from '../model.js'

export default function Mine() {
  const s = useStore()
  const ui = useUi()
  const b = useMemo(() => myBuckets(s.asks, s.me, s.today), [s.asks, s.me, s.today])
  return (
    <div className="ak-page">
      <PushCard />
      <div className="ak-summary" role="group" aria-label="Your numbers">
        <Tile n={b.toPick.length} label="To pick up" tone={b.toPick.length ? 'purple' : ''} />
        <Tile n={b.onIt.length} label="You’re on" tone={b.onIt.length ? 'orange' : ''} />
        <Tile n={s.counts.overdue} label="Overdue" tone={s.counts.overdue ? 'red' : ''} />
        <Tile n={b.asked.length} label="You asked, still open" />
      </div>

      <section className="ak-section">
        <h2 className="ak-h3">Sent to you, nobody has it yet</h2>
        <p className="ak-sub">The first person to tap “I’ll take it” has it. Everyone else sees that.</p>
        <AskList asks={b.toPick} showClaim empty="Nothing waiting for you to pick up." />
      </section>
      <section className="ak-section">
        <h2 className="ak-h3">You’re on</h2>
        <AskList asks={b.onIt} empty="You haven’t picked anything up." />
      </section>
      <section className="ak-section">
        <h2 className="ak-h3">You asked</h2>
        <AskList asks={b.asked} empty="Nothing open that you asked for." />
        <div><Button variant="secondary" size="sm" onClick={() => ui.newAsk()}>Ask for something</Button></div>
      </section>
      {b.done.length > 0 && (
        <section className="ak-section">
          <h2 className="ak-h3">Done in the last two weeks</h2>
          <AskList asks={b.done} empty="" />
        </section>
      )}
    </div>
  )
}

function Tile({ n, label, tone = '' }) {
  return (
    <div className={`ak-tile ${tone}`}>
      <span className="ak-tile-n">{n}</span>
      <span className="ak-tile-l">{label}</span>
    </div>
  )
}

/** Push is how people on site hear about asks, so offer it until it's on for this phone or browser. */
function PushCard() {
  const s = useStore()
  const ui = useUi()
  if (s.push.on) return null
  if (s.push.needsInstall) {
    return (
      <Alert tone="info" icon={<Bell size={18} />} title="Get asks as notifications on this iPhone">
        Add the Internal Hub to your Home Screen first (Share, then “Add to Home Screen”), open it from there, and turn notifications on here.
      </Alert>
    )
  }
  if (!s.push.supported) return null
  const on = async () => {
    try {
      await s.enablePush()
      ui.toast('Notifications are on for this device')
    } catch (e) {
      ui.toast(e.message || String(e))
    }
  }
  return (
    <Alert tone="info" icon={<Bell size={18} />} title="Get a notification when someone sends you an ask"
      action={<Button size="sm" onClick={on}>Turn on</Button>}>
      So you hear about them while you’re out on site.
    </Alert>
  )
}

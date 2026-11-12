/* The review screen: the plan (plan.js) drawn as the steps that will happen and the exact words that will go into Simpro. The button on it is
   the only thing in this tool that sends anything to Simpro, and what it sends is this plan, nothing else. The same screen then shows the
   steps as they happen, and what to do if one doesn't finish. */
import { Alert, Button, Spinner } from '../../../shared/ui/index.jsx'
import { describeRun } from './plan.js'
import { Sheet } from './Sheets.jsx'

const Mark = ({ state }) => {
  if (state === 'running') return <span className="sj-mark"><Spinner size={16} /></span>
  const glyph = { done: '✓', failed: '✗', pending: '○' }[state]
  return <span className={`sj-mark sj-mark-${state}`} aria-label={{ done: 'Done', failed: 'Did not finish', pending: 'Not done yet' }[state]}>{glyph}</span>
}

export function ReviewSheet({ plan, run, running, onCreate, onDiscard, onNew, onClose }) {
  const state = (id) => (run?.done?.includes(id) ? 'done' : running && run?.inflight === id ? 'running' : run?.failed?.step === id ? 'failed' : 'pending')
  const outcome = run && !running ? describeRun(plan, run) : null
  const started = !!run
  const title = run?.jobId ? `Job ${run.jobId}` : started ? 'Creating the job' : 'Check before creating'

  return (
    <Sheet title={title} onClose={onClose}>
      {!started && (
        <Alert tone="info" title="Nothing has been sent to Simpro yet">
          This is exactly what will be created. Check each line, then tap <strong>Create job in Simpro</strong>. Nothing else is added, scheduled or invoiced.
        </Alert>
      )}
      {outcome?.state === 'done' && <Alert tone="success" title={outcome.text}>The job is in Simpro now. Edit or add to it there, or find it in Simpro Deep Search.</Alert>}
      {outcome && outcome.state !== 'done' && (
        <Alert tone={outcome.state === 'refused' ? 'critical' : 'warning'} title={outcome.state === 'refused' ? 'Not created' : outcome.state === 'unsure' ? 'Not sure it was created' : 'The job is only part made'}>
          {outcome.text}
        </Alert>
      )}

      <ol className="sj-steps">
        {plan.map((step) => (
          <li key={step.id} className={`sj-step sj-step-${state(step.id)}`}>
            <div className="sj-step-head"><Mark state={state(step.id)} /><span className="sj-step-title">{step.title}</span></div>
            {step.facts.length > 0 && (
              <dl className="sj-facts">
                {step.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            )}
          </li>
        ))}
      </ol>

      <div className="sj-review-actions">
        {!started && (
          <>
            <Button variant="primary" size="lg" block onClick={onCreate}>Create job in Simpro</Button>
            <Button variant="ghost" block onClick={onClose}>Back to edit</Button>
          </>
        )}
        {running && <Button variant="primary" size="lg" block disabled>Creating… keep this page open</Button>}
        {outcome?.state === 'done' && (
          <>
            <a className="btn btn-secondary btn-lg btn-block" href={`/simprosearch/#/job/${run.jobId}`}>Open job {run.jobId}</a>
            <Button variant="primary" size="lg" block onClick={onNew}>Start a new job</Button>
          </>
        )}
        {outcome?.state === 'partial' && (
          <>
            <Button variant="primary" size="lg" block onClick={onCreate}>{run.failed?.unknown ? 'Try the rest anyway' : 'Try the remaining steps'}</Button>
            <a className="btn btn-secondary btn-block" href={`/simprosearch/#/job/${run.jobId}`}>Open job {run.jobId}</a>
            <Button variant="ghost" block onClick={onNew}>Leave it and start a new job</Button>
          </>
        )}
        {outcome?.state === 'refused' && (
          <>
            <Button variant="primary" size="lg" block onClick={onCreate}>Try again</Button>
            <Button variant="ghost" block onClick={onDiscard}>Back to edit</Button>
          </>
        )}
        {outcome?.state === 'unsure' && (
          <>
            <a className="btn btn-secondary btn-lg btn-block" href="/simprosearch/">Look for it in Simpro Deep Search</a>
            <Button variant="ghost" block onClick={onDiscard}>I checked: it wasn’t created. Back to edit</Button>
            <Button variant="ghost" block onClick={onCreate}>Try again anyway</Button>
          </>
        )}
      </div>
    </Sheet>
  )
}

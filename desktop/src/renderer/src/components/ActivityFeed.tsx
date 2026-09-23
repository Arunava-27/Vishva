import type { ChatEvent } from '../types'

interface Props {
  events: ChatEvent[]
  elapsedSec: number
}

export default function ActivityFeed({ events, elapsedSec }: Props) {
  const last = events[events.length - 1]
  const label = last?.kind === 'success' ? 'Responding' : 'Thinking'

  return (
    <div className="activity-feed">
      <div className="activity-status">
        <span className="activity-dot" />
        {label} for {elapsedSec}s…
      </div>
      {events.length > 0 && (
        <ul className="activity-log">
          {events.map((e, i) => (
            <li key={i} className={`activity-row activity-${e.kind}`}>
              {e.provider && <span className="activity-provider">{e.provider}</span>}
              <span className="activity-message">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

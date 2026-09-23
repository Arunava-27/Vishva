import { useMemo } from 'react'
import { formatUsage } from '../formatUsage'
import type { ChatEvent, UsageSummary } from '../types'
import ToolCallRow from './ToolCallRow'

interface Props {
  events: ChatEvent[]
  elapsedSec: number
}

// Copilot's tool.execution_start/execution_complete pair share one toolId -
// merge them into a single row that updates in place once the _complete
// event arrives. The other 3 providers' tool events already arrive complete
// in one shot and pass through untouched.
function useMergedRows(events: ChatEvent[]): ChatEvent[] {
  return useMemo(() => {
    const byId = new Map<string, ChatEvent>()
    const ordered: ChatEvent[] = []
    for (const e of events) {
      if (e.kind === 'usage') continue // folded into the running total, not a log row
      if (e.kind !== 'tool') {
        ordered.push(e)
        continue
      }
      if (e.toolId && byId.has(e.toolId)) {
        // only overwrite fields the new event actually carries - copilot's
        // execution_complete half doesn't repeat toolName/toolInput
        // (confirmed live), and Object.assign would otherwise clobber the
        // good data from execution_start with undefined.
        const existing = byId.get(e.toolId)!
        if (e.toolName) existing.toolName = e.toolName
        if (e.toolInput !== undefined) existing.toolInput = e.toolInput
        if (e.toolResult !== undefined) existing.toolResult = e.toolResult
        if (e.toolDiff) existing.toolDiff = e.toolDiff
      } else {
        const copy = { ...e }
        if (e.toolId) byId.set(e.toolId, copy)
        ordered.push(copy)
      }
    }
    return ordered
  }, [events])
}

function useUsageTotals(events: ChatEvent[]): UsageSummary {
  return useMemo(
    () =>
      events.reduce<UsageSummary>((acc, e) => {
        if (e.kind !== 'usage' || !e.usage) return acc
        const other = { ...acc.other }
        if (e.usage.other) for (const [k, v] of Object.entries(e.usage.other)) other[k] = (other[k] ?? 0) + v
        return {
          inputTokens: (acc.inputTokens ?? 0) + (e.usage.inputTokens ?? 0),
          outputTokens: (acc.outputTokens ?? 0) + (e.usage.outputTokens ?? 0),
          costUsd: (acc.costUsd ?? 0) + (e.usage.costUsd ?? 0),
          other,
        }
      }, {}),
    [events],
  )
}

// Rotating fun status verbs a la Claude Code's own "Pondering.../Noodling..."
// - derived from elapsedSec (already ticking every 1s from the parent)
// rather than a separate timer, so it advances for free.
const THINKING_VERBS = [
  'Thinking', 'Pondering', 'Noodling', 'Percolating', 'Ruminating',
  'Cooking', 'Mulling it over', 'Working the problem', 'Chewing on it',
]

export default function ActivityFeed({ events, elapsedSec }: Props) {
  const last = events[events.length - 1]
  const label = last?.kind === 'success' ? 'Responding' : THINKING_VERBS[Math.floor(elapsedSec / 4) % THINKING_VERBS.length]
  const rows = useMergedRows(events)
  const usageLabel = formatUsage(useUsageTotals(events))

  return (
    <div className="activity-feed">
      <div className="activity-status">
        <span className="activity-dot" />
        {label} for {elapsedSec}s…{usageLabel && ` · ${usageLabel}`}
      </div>
      {rows.length > 0 && (
        <ul className="activity-log">
          {rows.map((e, i) =>
            e.kind === 'tool' ? (
              <li key={i} className="activity-row activity-tool">
                <ToolCallRow provider={e.provider} name={e.toolName ?? 'tool'} input={e.toolInput} result={e.toolResult} diff={e.toolDiff} />
              </li>
            ) : (
              <li key={i} className={`activity-row activity-${e.kind}`}>
                {e.provider && <span className="activity-provider">{e.provider}</span>}
                <span className="activity-message">{e.message}</span>
                {e.detail && <span className="activity-detail">{e.detail}</span>}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}

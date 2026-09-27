import { useState } from 'react'
import type { CooperativeSessionData } from '../types'

interface Props {
  sessions: CooperativeSessionData[]
  activeSessionId: string | null
  busySessionIds: Set<string>
  onOpenSession: (id: string) => void
  onRename: (id: string, task: string) => void
  onDelete: (id: string) => void
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function relativeTime(ts: number): string {
  const diffMin = Math.round((ts - Date.now()) / 60_000)
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
  const diffHr = Math.round(diffMin / 60)
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour')
  return rtf.format(Math.round(diffHr / 24), 'day')
}

function lastActivityOf(s: CooperativeSessionData): number {
  const last = s.turns.at(-1)?.timestamp
  return last ? Date.parse(last) : 0
}

// Small self-contained sibling to SessionList/SessionRow rather than a
// generalization of them - those are coupled to SessionData.messages, which
// a cooperative session has no equivalent of (it has `turns` instead).
export default function CooperativeSessionList({ sessions, activeSessionId, busySessionIds, onOpenSession, onRename, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const sorted = [...sessions].sort((a, b) => lastActivityOf(b) - lastActivityOf(a))

  return (
    <div>
      <h2>Cooperative history</h2>
      {sorted.length === 0 && <div className="provider-row">No cooperative runs yet</div>}
      {sorted.map((s) => {
        const lastTurn = s.turns.at(-1)
        if (editingId === s.id) {
          return (
            <input
              key={s.id}
              className="session-rename-input"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => {
                if (editValue.trim()) onRename(s.id, editValue.trim())
                setEditingId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (editValue.trim()) onRename(s.id, editValue.trim())
                  setEditingId(null)
                }
                if (e.key === 'Escape') setEditingId(null)
              }}
            />
          )
        }
        return (
          <div
            key={s.id}
            className={'session-item' + (s.id === activeSessionId ? ' active' : '')}
            onClick={() => onOpenSession(s.id)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setEditValue(s.task)
              setEditingId(s.id)
            }}
            title={s.task}
          >
            <span className="session-item-label">
              {busySessionIds.has(s.id) && <span className="session-busy-dot" title="A cooperative run is in progress" />}
              {s.task || '(untitled)'}
              {lastTurn ? ` · ${relativeTime(Date.parse(lastTurn.timestamp))}` : ''}
            </span>
            <button
              className="link-btn session-delete"
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm('Delete this cooperative run?')) onDelete(s.id)
              }}
              title="Delete this run"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

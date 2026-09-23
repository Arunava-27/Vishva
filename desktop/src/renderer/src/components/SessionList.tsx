import { useState } from 'react'
import type { SessionData } from '../types'
import SessionRow from './SessionRow'

interface Props {
  sessions: SessionData[]
  activeSessionId: string | null
  onOpenSession: (id: string) => void
  onRename: (id: string, task: string) => void
  onDelete: (id: string) => void
}

const GROUP_ORDER = ['Today', 'Yesterday', 'Last 7 days', 'Older'] as const
type Group = (typeof GROUP_ORDER)[number]

function lastActivityOf(s: SessionData): number {
  const last = s.messages.at(-1)?.timestamp
  return last ? Date.parse(last) : 0
}

function bucketFor(ts: number): Group {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.floor((startOf(new Date()) - startOf(new Date(ts))) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days <= 7) return 'Last 7 days'
  return 'Older'
}

export default function SessionList({ sessions, activeSessionId, onOpenSession, onRename, onDelete }: Props) {
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? sessions.filter((s) => (s.task || '').toLowerCase().includes(search.trim().toLowerCase()))
    : sessions

  const groups = new Map<Group, SessionData[]>()
  for (const s of filtered) {
    const g = bucketFor(lastActivityOf(s))
    groups.set(g, [...(groups.get(g) ?? []), s])
  }

  return (
    <div>
      <h2>Chats</h2>
      {sessions.length > 3 && (
        <input
          className="session-search"
          type="text"
          placeholder="Search chats..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      {filtered.length === 0 && <div className="provider-row">{sessions.length === 0 ? 'No chats yet' : 'No matches'}</div>}
      {GROUP_ORDER.filter((g) => groups.has(g)).map((g) => (
        <div key={g}>
          <div className="session-group-label">{g}</div>
          {groups.get(g)!.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              isActive={s.id === activeSessionId}
              onOpen={onOpenSession}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

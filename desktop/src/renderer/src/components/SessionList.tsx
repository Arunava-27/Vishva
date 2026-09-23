import { useState } from 'react'
import type { SessionData } from '../types'
import SessionRow from './SessionRow'

interface Props {
  sessions: SessionData[]
  activeSessionId: string | null
  onNewChat: () => void
  onOpenSession: (id: string) => void
  onRename: (id: string, task: string) => void
  onDelete: (id: string) => void
}

export default function SessionList({ sessions, activeSessionId, onNewChat, onOpenSession, onRename, onDelete }: Props) {
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? sessions.filter((s) => (s.task || '').toLowerCase().includes(search.trim().toLowerCase()))
    : sessions

  return (
    <div>
      <button className="new-chat-btn" onClick={onNewChat}>
        + New chat
      </button>

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
      {filtered.map((s) => (
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
  )
}

import { useState } from 'react'
import type { SessionData } from '../types'

interface Props {
  session: SessionData
  isActive: boolean
  isBusy: boolean
  onOpen: (id: string) => void
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

// Shared by the top-level chat list and each project's chat list - rename/
// delete behavior is identical either way, only where the sessions come from differs.
export default function SessionRow({ session, isActive, isBusy, onOpen, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(session.task)

  function commit() {
    if (value.trim()) onRename(session.id, value.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        className="session-rename-input"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant')
  const lastTs = session.messages.at(-1)?.timestamp
  return (
    <div
      className={'session-item' + (isActive ? ' active' : '')}
      onClick={() => onOpen(session.id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setValue(session.task)
        setEditing(true)
      }}
      title={session.task}
    >
      <span className="session-item-label">
        {isBusy && <span className="session-busy-dot" title="A task is running in this chat" />}
        {session.task || '(untitled)'}
        {lastAssistant?.provider ? ` · ${lastAssistant.provider}` : ''}
        {lastTs ? ` · ${relativeTime(Date.parse(lastTs))}` : ''}
      </span>
      <button
        className="link-btn session-delete"
        onClick={(e) => {
          e.stopPropagation()
          if (window.confirm('Delete this chat?')) onDelete(session.id)
        }}
        title="Delete this chat"
      >
        ×
      </button>
    </div>
  )
}

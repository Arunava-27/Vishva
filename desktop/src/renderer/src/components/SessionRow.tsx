import { useState } from 'react'
import type { SessionData } from '../types'

interface Props {
  session: SessionData
  isActive: boolean
  onOpen: (id: string) => void
  onRename: (id: string, task: string) => void
  onDelete: (id: string) => void
}

// Shared by the top-level chat list and each project's chat list - rename/
// delete behavior is identical either way, only where the sessions come from differs.
export default function SessionRow({ session, isActive, onOpen, onRename, onDelete }: Props) {
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
        {session.task || '(untitled)'}
        {lastAssistant?.provider ? ` · ${lastAssistant.provider}` : ''}
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

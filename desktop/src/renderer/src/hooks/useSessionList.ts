import { useState } from 'react'
import type { SessionData } from '../types'

export function useSessionList(activeSessionId: string | null, onDeleteActive: () => void) {
  const [sessions, setSessions] = useState<SessionData[]>([])

  const refreshSessions = () => {
    if (!window.aicli) return
    window.aicli.listSessions().then(setSessions)
  }

  async function handleRenameSession(id: string, task: string) {
    if (!window.aicli) return
    await window.aicli.renameSession(id, task)
    refreshSessions()
  }

  async function handleDeleteSession(id: string) {
    if (!window.aicli) return
    await window.aicli.deleteSession(id)
    if (id === activeSessionId) onDeleteActive()
    refreshSessions()
  }

  return { sessions, refreshSessions, handleRenameSession, handleDeleteSession }
}

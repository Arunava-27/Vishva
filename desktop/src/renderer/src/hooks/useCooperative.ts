import { useEffect, useRef, useState } from 'react'
import type { CooperativeEvent, CooperativeSessionData } from '../types'

export interface RunningCooperativeTask {
  taskId: string
  activity: CooperativeEvent[]
  startedAt: number
}

// Same truncate-to-60-chars convention as App.tsx's own makeTitle() for
// regular chats - duplicated rather than imported since App.tsx doesn't
// export it and this is a tiny, self-contained pure function.
function makeTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= 60) return clean
  const cut = clean.slice(0, 60)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…'
}

export function useCooperative() {
  const [sessions, setSessions] = useState<CooperativeSessionData[]>([])
  const [session, setSession] = useState<CooperativeSessionData | null>(null)
  const [runningTask, setRunningTask] = useState<RunningCooperativeTask | null>(null)
  const sessionRef = useRef(session)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    if (!window.aicli) return
    const off = window.aicli.onCooperativeEvent((event) => {
      setRunningTask((task) => {
        if (!task || task.taskId !== event.taskId) return task
        return { ...task, activity: [...task.activity, event] }
      })
    })
    return off
  }, [])

  const refreshSessions = () => {
    if (!window.aicli) return
    window.aicli.listCooperativeSessions().then(setSessions)
  }

  async function openSession(id: string) {
    if (!window.aicli) return
    const data = await window.aicli.openCooperativeSession(id)
    setSession(data)
  }

  async function deleteSession(id: string) {
    if (!window.aicli) return
    await window.aicli.deleteCooperativeSession(id)
    if (id === session?.id) setSession(null)
    refreshSessions()
  }

  async function renameSession(id: string, task: string) {
    if (!window.aicli) return
    await window.aicli.renameCooperativeSession(id, task)
    refreshSessions()
  }

  async function send(
    text: string,
    attachments: string[],
    providers: string[],
    judgeProvider: string,
    cwd: string,
    projectId: string | null,
  ) {
    if (!window.aicli) return
    const taskId = crypto.randomUUID()
    const sessionId = session?.id || crypto.randomUUID()
    const task = session?.task ?? makeTitle(text)
    setRunningTask({ taskId, activity: [], startedAt: Date.now() })

    const { session: updated } = await window.aicli.sendCooperative({
      taskId,
      sessionId,
      sessionData: session,
      task,
      cwd,
      projectId,
      providers,
      judgeProvider,
      text,
      attachments,
    })

    setRunningTask(null)
    // Only touch the currently-viewed session if the user hasn't navigated
    // away since this turn started - same discipline as App.tsx's handleSend.
    if (sessionRef.current?.id === sessionId || sessionRef.current === null) {
      setSession(updated)
    }
    refreshSessions()
  }

  async function cancel() {
    if (!window.aicli || !runningTask) return
    await window.aicli.cancelCooperative(runningTask.taskId)
  }

  return { sessions, session, runningTask, refreshSessions, openSession, deleteSession, renameSession, send, cancel, setSession }
}

import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import Composer from './components/Composer'
import MessageBubble from './components/MessageBubble'
import SetupPanel, { type SetupState } from './components/SetupPanel'
import SettingsPanel from './components/SettingsPanel'
import FallbackOrderEditor from './components/FallbackOrderEditor'
import ProjectFormPanel from './components/ProjectFormPanel'
import SkillFormPanel from './components/SkillFormPanel'
import McpServersPanel from './components/McpServersPanel'
import ActivityFeed from './components/ActivityFeed'
import { useProviderPanel } from './hooks/useProviderPanel'
import { useSessionList } from './hooks/useSessionList'
import { useProjectList } from './hooks/useProjectList'
import { useSkillList } from './hooks/useSkillList'
import { useMcpServers } from './hooks/useMcpServers'
import type { ChatEvent, Message, ProjectData, Settings, SessionData, SkillData } from './types'

const DEFAULT_ORDER = ['claude', 'codex', 'copilot', 'antigravity']
const DEFAULT_SETTINGS: Settings = { theme: 'system', defaultProvider: 'claude', defaultFallbackOrder: DEFAULT_ORDER }

type ProjectFormState = { mode: 'create' } | { mode: 'edit'; project: ProjectData }
type SkillFormState = { mode: 'create' } | { mode: 'edit'; skill: SkillData }

interface RunningTask {
  taskId: string
  sessionId: string
  provider: string
  activity: ChatEvent[]
  startedAt: number
}

export default function App() {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [session, setSession] = useState<SessionData | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeProvider, setActiveProvider] = useState(DEFAULT_SETTINGS.defaultProvider)
  const [fallbackOrder, setFallbackOrder] = useState<string[]>(DEFAULT_SETTINGS.defaultFallbackOrder)
  const [runningTasks, setRunningTasks] = useState<Map<string, RunningTask>>(new Map())
  const [now, setNow] = useState(Date.now())
  const [setupState, setSetupState] = useState<SetupState | null>(null)
  const [projectFormState, setProjectFormState] = useState<ProjectFormState | null>(null)
  const [skillFormState, setSkillFormState] = useState<SkillFormState | null>(null)
  const [showMcpServers, setShowMcpServers] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef(session)

  const providerPanel = useProviderPanel(setSetupState)
  const sessionList = useSessionList(session?.id ?? null, () => setSession(null))
  const projectList = useProjectList()
  const skillList = useSkillList()
  const mcpServers = useMcpServers()
  const activeProject = projectList.projects.find((p) => p.id === activeProjectId) ?? null

  // A task's completion resolves asynchronously - by then the user may have
  // navigated to a different session. This ref lets that resolution check
  // "is the user still looking at the session this task belongs to" against
  // the *current* value, not a value captured when the task started.
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const currentTask = session ? [...runningTasks.values()].find((t) => t.sessionId === session.id) : undefined
  const busy = !!currentTask
  const busySessionIds = new Set([...runningTasks.values()].map((t) => t.sessionId))
  const elapsedSec = currentTask ? Math.round((now - currentTask.startedAt) / 1000) : 0

  useEffect(() => {
    providerPanel.refreshProviders()
    sessionList.refreshSessions()
    projectList.refreshProjects()
    skillList.refreshSkills()
    mcpServers.refreshMcpServers()
    window.aicli.getSettings().then((s) => {
      setSettingsState(s)
      setActiveProvider(s.defaultProvider)
      setFallbackOrder(s.defaultFallbackOrder)
    })
    const offChat = window.aicli.onChatEvent((event) => {
      setRunningTasks((tasks) => {
        const task = tasks.get(event.taskId)
        if (!task) return tasks
        const next = new Map(tasks)
        next.set(event.taskId, { ...task, activity: [...task.activity, event] })
        return next
      })
    })
    const offSetup = window.aicli.onSetupEvent((chunk) => {
      setSetupState((s) => (s ? { ...s, log: s.log + chunk } : s))
    })
    return () => {
      offChat()
      offSetup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages.length, currentTask?.activity.length])

  useEffect(() => {
    if (runningTasks.size === 0) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [runningTasks.size])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme === 'system' ? '' : settings.theme
  }, [settings.theme])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        handleNewChat()
      } else if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false)
        else if (projectFormState) setProjectFormState(null)
        else if (skillFormState) setSkillFormState(null)
        else if (showMcpServers) setShowMcpServers(false)
        else if (setupState && !setupState.running) setSetupState(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, setupState, projectFormState, skillFormState, showMcpServers])

  function handleChangeSettings(patch: Partial<Settings>) {
    window.aicli.setSettings(patch).then(setSettingsState)
  }

  async function handleSend(text: string, attachments: string[]) {
    const cwd = activeProject?.cwd ?? '.'
    const title = makeTitle(text)
    const sessionId = session?.id || crypto.randomUUID()
    const taskId = crypto.randomUUID()
    const optimistic: Message = { role: 'user', text, provider: null, timestamp: new Date().toISOString() }
    const base = session ?? {
      id: sessionId,
      task: title,
      cwd,
      projectId: activeProjectId,
      history: [],
      messages: [],
      status: 'active',
    }
    setSession({ ...base, messages: [...base.messages, optimistic] })
    setRunningTasks((tasks) => new Map(tasks).set(taskId, { taskId, sessionId, provider: activeProvider, activity: [], startedAt: Date.now() }))

    const { session: updated, answeredBy } = await window.aicli.sendMessage({
      taskId,
      sessionId,
      sessionData: session,
      task: title,
      cwd,
      projectId: activeProjectId,
      activeProvider,
      fallbackOrder: fallbackOrder.length ? fallbackOrder : [activeProvider],
      text,
      attachments,
    })

    setRunningTasks((tasks) => {
      const next = new Map(tasks)
      next.delete(taskId)
      return next
    })
    // Only touch the currently-viewed session/provider if the user hasn't
    // navigated away since this task started - otherwise a background task's
    // completion would clobber whatever the user is looking at now.
    if (sessionRef.current?.id === sessionId) {
      setSession(updated)
      setActiveProvider(answeredBy)
    }
    sessionList.refreshSessions()
  }

  async function handleCancel() {
    if (currentTask) await window.aicli.cancel(currentTask.taskId)
  }

  function handleNewChat() {
    setSession(null)
    setActiveProjectId(null)
  }

  function handleNewChatInProject(projectId: string) {
    setSession(null)
    setActiveProjectId(projectId)
  }

  async function handleOpenSession(id: string) {
    const data = await window.aicli.openSession(id)
    setSession(data)
    setActiveProjectId(data.projectId)
    const lastAssistant = [...data.messages].reverse().find((m) => m.role === 'assistant')
    if (lastAssistant?.provider) setActiveProvider(lastAssistant.provider)
  }

  async function handleCancelSetup() {
    await window.aicli.cancelSetup()
  }

  async function handleSaveProject(fields: { name: string; instructions: string; cwd: string }) {
    if (projectFormState?.mode === 'edit') {
      await projectList.updateProject(projectFormState.project.id, fields)
    } else {
      const created = await projectList.createProject(fields.name, fields.instructions, fields.cwd)
      setActiveProjectId(created.id)
      setSession(null)
    }
    setProjectFormState(null)
  }

  async function handleDeleteProject(id: string) {
    await projectList.deleteProject(id)
    if (id === activeProjectId) setActiveProjectId(null)
  }

  async function handleSaveSkill(fields: {
    name: string
    description: string
    body: string
    scope: 'global' | 'project'
    projectId: string | null
  }) {
    if (skillFormState?.mode === 'edit') {
      await skillList.updateSkill(skillFormState.skill.id, fields)
    } else {
      await skillList.createSkill(fields.name, fields.description, fields.body, fields.scope, fields.projectId)
    }
    setSkillFormState(null)
  }

  return (
    <div className="app">
      <Sidebar
        providers={providerPanel.providers}
        sessions={sessionList.sessions}
        projects={projectList.projects}
        skills={skillList.skills}
        activeSessionId={session?.id ?? null}
        busySessionIds={busySessionIds}
        onNewChat={handleNewChat}
        onOpenSession={handleOpenSession}
        onRenameSession={sessionList.handleRenameSession}
        onDeleteSession={sessionList.handleDeleteSession}
        onNewProject={() => setProjectFormState({ mode: 'create' })}
        onEditProject={(project) => setProjectFormState({ mode: 'edit', project })}
        onDeleteProject={handleDeleteProject}
        onNewChatInProject={handleNewChatInProject}
        onNewSkill={() => setSkillFormState({ mode: 'create' })}
        onEditSkill={(skill) => setSkillFormState({ mode: 'edit', skill })}
        onDeleteSkill={skillList.deleteSkill}
        onRefreshProviders={providerPanel.refreshProviders}
        onInstall={providerPanel.handleInstall}
        onLogin={providerPanel.handleLogin}
        onOpenInstallUrl={(name) => window.aicli.openInstallUrl(name)}
        onCheckConnection={providerPanel.handleCheckConnection}
        checking={providerPanel.checking}
        onOpenSettings={() => setShowSettings(true)}
        onOpenMcpServers={() => setShowMcpServers(true)}
      />
      {setupState && <SetupPanel state={setupState} onCancel={handleCancelSetup} onClose={() => setSetupState(null)} />}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          providerNames={providerNames(providerPanel.providers)}
          onChange={handleChangeSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
      {projectFormState && (
        <ProjectFormPanel
          initial={projectFormState.mode === 'edit' ? projectFormState.project : undefined}
          onSave={handleSaveProject}
          onClose={() => setProjectFormState(null)}
        />
      )}
      {skillFormState && (
        <SkillFormPanel
          initial={skillFormState.mode === 'edit' ? skillFormState.skill : undefined}
          projects={projectList.projects}
          onSave={handleSaveSkill}
          onClose={() => setSkillFormState(null)}
        />
      )}
      {showMcpServers && (
        <McpServersPanel
          servers={mcpServers.servers}
          projects={projectList.projects}
          onAdd={mcpServers.addMcpServer}
          onUpdate={mcpServers.updateMcpServer}
          onRemove={mcpServers.removeMcpServer}
          onClose={() => setShowMcpServers(false)}
        />
      )}
      <div className="chat">
        <div className="chat-header">
          {activeProject && <span className="active-project-badge">{activeProject.name}</span>}
          <label>
            Talking to:{' '}
            <select value={activeProvider} onChange={(e) => setActiveProvider(e.target.value)}>
              {providerNames(providerPanel.providers).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <FallbackOrderEditor
            allProviders={providerNames(providerPanel.providers)}
            order={fallbackOrder}
            onChange={setFallbackOrder}
          />
          {runningTasks.size > 0 && <span className="running-tasks-count">{runningTasks.size} running…</span>}
        </div>

        <div className="messages">
          {!session && (
            <div className="empty-state">
              <p>{activeProject ? `New chat in ${activeProject.name}` : 'Pick a provider and start typing.'}</p>
              <p className="empty-state-hint">Ctrl/Cmd+K starts a new chat at any time.</p>
            </div>
          )}
          {(session?.messages ?? []).map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {currentTask && <ActivityFeed events={currentTask.activity} elapsedSec={elapsedSec} />}
          <div ref={messagesEndRef} />
        </div>

        <Composer busy={busy} onSend={handleSend} onCancel={handleCancel} />
      </div>
    </div>
  )
}

function providerNames(providers: { name: string }[]): string[] {
  return providers.length ? providers.map((p) => p.name) : DEFAULT_ORDER
}

function makeTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= 60) return clean
  const cut = clean.slice(0, 60)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…'
}

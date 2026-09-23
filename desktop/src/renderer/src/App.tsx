import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import Composer from './components/Composer'
import MessageBubble from './components/MessageBubble'
import SetupPanel, { type SetupState } from './components/SetupPanel'
import SettingsPanel from './components/SettingsPanel'
import FallbackOrderEditor from './components/FallbackOrderEditor'
import ProjectFormPanel from './components/ProjectFormPanel'
import { useProviderPanel } from './hooks/useProviderPanel'
import { useSessionList } from './hooks/useSessionList'
import { useProjectList } from './hooks/useProjectList'
import type { Message, ProjectData, Settings, SessionData } from './types'

const DEFAULT_ORDER = ['claude', 'codex', 'copilot', 'antigravity']
const DEFAULT_SETTINGS: Settings = { theme: 'system', defaultProvider: 'claude', defaultFallbackOrder: DEFAULT_ORDER }

type ProjectFormState = { mode: 'create' } | { mode: 'edit'; project: ProjectData }

export default function App() {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [session, setSession] = useState<SessionData | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeProvider, setActiveProvider] = useState(DEFAULT_SETTINGS.defaultProvider)
  const [fallbackOrder, setFallbackOrder] = useState<string[]>(DEFAULT_SETTINGS.defaultFallbackOrder)
  const [busy, setBusy] = useState(false)
  const [statusLine, setStatusLine] = useState('')
  const [setupState, setSetupState] = useState<SetupState | null>(null)
  const [projectFormState, setProjectFormState] = useState<ProjectFormState | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const providerPanel = useProviderPanel(setSetupState)
  const sessionList = useSessionList(session?.id ?? null, () => setSession(null))
  const projectList = useProjectList()
  const activeProject = projectList.projects.find((p) => p.id === activeProjectId) ?? null

  useEffect(() => {
    providerPanel.refreshProviders()
    sessionList.refreshSessions()
    projectList.refreshProjects()
    window.aicli.getSettings().then((s) => {
      setSettingsState(s)
      setActiveProvider(s.defaultProvider)
      setFallbackOrder(s.defaultFallbackOrder)
    })
    const offChat = window.aicli.onChatEvent(setStatusLine)
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
  }, [session?.messages.length, statusLine])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme === 'system' ? '' : settings.theme
  }, [settings.theme])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!busy) handleNewChat()
      } else if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false)
        else if (projectFormState) setProjectFormState(null)
        else if (setupState && !setupState.running) setSetupState(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, showSettings, setupState, projectFormState])

  function handleChangeSettings(patch: Partial<Settings>) {
    window.aicli.setSettings(patch).then(setSettingsState)
  }

  async function handleSend(text: string, attachments: string[]) {
    const cwd = activeProject?.cwd ?? '.'
    const optimistic: Message = { role: 'user', text, provider: null, timestamp: new Date().toISOString() }
    const base = session ?? {
      id: '',
      task: text.slice(0, 60),
      cwd,
      projectId: activeProjectId,
      history: [],
      messages: [],
      status: 'active',
    }
    setSession({ ...base, messages: [...base.messages, optimistic] })
    setBusy(true)
    setStatusLine('')

    const { session: updated, answeredBy } = await window.aicli.sendMessage({
      sessionData: session,
      task: text.slice(0, 60),
      cwd,
      projectId: activeProjectId,
      activeProvider,
      fallbackOrder: fallbackOrder.length ? fallbackOrder : [activeProvider],
      text,
      attachments,
    })

    setSession(updated)
    setActiveProvider(answeredBy)
    setBusy(false)
    setStatusLine('')
    sessionList.refreshSessions()
  }

  async function handleCancel() {
    await window.aicli.cancel()
  }

  function handleNewChat() {
    if (busy) return
    setSession(null)
    setActiveProjectId(null)
  }

  function handleNewChatInProject(projectId: string) {
    if (busy) return
    setSession(null)
    setActiveProjectId(projectId)
  }

  async function handleOpenSession(id: string) {
    if (busy) return
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

  return (
    <div className="app">
      <Sidebar
        providers={providerPanel.providers}
        sessions={sessionList.sessions}
        projects={projectList.projects}
        activeSessionId={session?.id ?? null}
        onNewChat={handleNewChat}
        onOpenSession={handleOpenSession}
        onRenameSession={sessionList.handleRenameSession}
        onDeleteSession={sessionList.handleDeleteSession}
        onNewProject={() => setProjectFormState({ mode: 'create' })}
        onEditProject={(project) => setProjectFormState({ mode: 'edit', project })}
        onDeleteProject={handleDeleteProject}
        onNewChatInProject={handleNewChatInProject}
        onRefreshProviders={providerPanel.refreshProviders}
        onInstall={providerPanel.handleInstall}
        onLogin={providerPanel.handleLogin}
        onOpenInstallUrl={(name) => window.aicli.openInstallUrl(name)}
        onCheckConnection={providerPanel.handleCheckConnection}
        checking={providerPanel.checking}
        onOpenSettings={() => setShowSettings(true)}
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
          {busy && statusLine && <div className="thinking">{statusLine}</div>}
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

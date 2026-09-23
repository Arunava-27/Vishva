import type { ProjectData, ProviderStatus, SessionData } from '../types'
import ProjectList from './ProjectList'
import ProviderPanel from './ProviderPanel'
import SessionList from './SessionList'

interface Props {
  providers: ProviderStatus[]
  sessions: SessionData[]
  projects: ProjectData[]
  activeSessionId: string | null
  onNewChat: () => void
  onOpenSession: (id: string) => void
  onRenameSession: (id: string, task: string) => void
  onDeleteSession: (id: string) => void
  onNewProject: () => void
  onEditProject: (project: ProjectData) => void
  onDeleteProject: (id: string) => void
  onNewChatInProject: (projectId: string) => void
  onRefreshProviders: () => void
  onInstall: (name: string) => void
  onLogin: (name: string) => void
  onOpenInstallUrl: (name: string) => void
  onCheckConnection: (name: string) => void
  checking: Record<string, string>
  onOpenSettings: () => void
}

export default function Sidebar({
  providers,
  sessions,
  projects,
  activeSessionId,
  onNewChat,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onNewProject,
  onEditProject,
  onDeleteProject,
  onNewChatInProject,
  onRefreshProviders,
  onInstall,
  onLogin,
  onOpenInstallUrl,
  onCheckConnection,
  checking,
  onOpenSettings,
}: Props) {
  // A session whose projectId no longer resolves to a real project (deleted,
  // or from before projects existed) shows up here instead of vanishing.
  const projectIds = new Set(projects.map((p) => p.id))
  const ungroupedSessions = sessions.filter((s) => !s.projectId || !projectIds.has(s.projectId))

  return (
    <div className="sidebar">
      <button className="new-chat-btn primary-new-chat" onClick={onNewChat}>
        + New chat
      </button>
      <ProjectList
        projects={projects}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewProject={onNewProject}
        onEditProject={onEditProject}
        onDeleteProject={onDeleteProject}
        onNewChatInProject={onNewChatInProject}
        onOpenSession={onOpenSession}
        onRenameSession={onRenameSession}
        onDeleteSession={onDeleteSession}
      />
      <SessionList
        sessions={ungroupedSessions}
        activeSessionId={activeSessionId}
        onOpenSession={onOpenSession}
        onRename={onRenameSession}
        onDelete={onDeleteSession}
      />
      <ProviderPanel
        providers={providers}
        onRefreshProviders={onRefreshProviders}
        onInstall={onInstall}
        onLogin={onLogin}
        onOpenInstallUrl={onOpenInstallUrl}
        onCheckConnection={onCheckConnection}
        checking={checking}
      />
      <button className="link-btn sidebar-settings-btn" onClick={onOpenSettings}>
        ⚙ Settings
      </button>
    </div>
  )
}

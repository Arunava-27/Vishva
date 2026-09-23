import type { ProjectData, ProviderStatus, SessionData, SkillData } from '../types'
import ProjectList from './ProjectList'
import ProviderPanel from './ProviderPanel'
import SessionList from './SessionList'
import SkillList from './SkillList'

interface Props {
  providers: ProviderStatus[]
  sessions: SessionData[]
  projects: ProjectData[]
  skills: SkillData[]
  activeSessionId: string | null
  busySessionIds: Set<string>
  onNewChat: () => void
  onOpenSession: (id: string) => void
  onRenameSession: (id: string, task: string) => void
  onDeleteSession: (id: string) => void
  onNewProject: () => void
  onEditProject: (project: ProjectData) => void
  onDeleteProject: (id: string) => void
  onNewChatInProject: (projectId: string) => void
  onNewSkill: () => void
  onEditSkill: (skill: SkillData) => void
  onDeleteSkill: (id: string) => void
  onRefreshProviders: () => void
  onInstall: (name: string) => void
  onLogin: (name: string) => void
  onOpenInstallUrl: (name: string) => void
  onCheckConnection: (name: string) => void
  checking: Record<string, string>
  onOpenSettings: () => void
  onOpenMcpServers: () => void
}

export default function Sidebar({
  providers,
  sessions,
  projects,
  skills,
  activeSessionId,
  busySessionIds,
  onNewChat,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onNewProject,
  onEditProject,
  onDeleteProject,
  onNewChatInProject,
  onNewSkill,
  onEditSkill,
  onDeleteSkill,
  onRefreshProviders,
  onInstall,
  onLogin,
  onOpenInstallUrl,
  onCheckConnection,
  checking,
  onOpenSettings,
  onOpenMcpServers,
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
        busySessionIds={busySessionIds}
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
        busySessionIds={busySessionIds}
        onOpenSession={onOpenSession}
        onRename={onRenameSession}
        onDelete={onDeleteSession}
      />
      <SkillList skills={skills} projects={projects} onNewSkill={onNewSkill} onEditSkill={onEditSkill} onDeleteSkill={onDeleteSkill} />
      <ProviderPanel
        providers={providers}
        onRefreshProviders={onRefreshProviders}
        onInstall={onInstall}
        onLogin={onLogin}
        onOpenInstallUrl={onOpenInstallUrl}
        onCheckConnection={onCheckConnection}
        checking={checking}
      />
      <div className="sidebar-footer-row">
        <button className="link-btn" onClick={onOpenMcpServers}>
          🔌 MCP Servers
        </button>
        <button className="link-btn sidebar-settings-btn" onClick={onOpenSettings}>
          ⚙ Settings
        </button>
      </div>
    </div>
  )
}

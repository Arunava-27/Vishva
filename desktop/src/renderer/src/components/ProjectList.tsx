import type { ProjectData, SessionData } from '../types'
import SessionRow from './SessionRow'

interface Props {
  projects: ProjectData[]
  sessions: SessionData[]
  activeSessionId: string | null
  busySessionIds: Set<string>
  onNewProject: () => void
  onEditProject: (project: ProjectData) => void
  onDeleteProject: (id: string) => void
  onNewChatInProject: (projectId: string) => void
  onOpenSession: (id: string) => void
  onRenameSession: (id: string, task: string) => void
  onDeleteSession: (id: string) => void
}

export default function ProjectList({
  projects,
  sessions,
  activeSessionId,
  busySessionIds,
  onNewProject,
  onEditProject,
  onDeleteProject,
  onNewChatInProject,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
}: Props) {
  if (projects.length === 0) {
    return (
      <div>
        <h2>
          Projects{' '}
          <span className="link-btn" onClick={onNewProject}>
            + New
          </span>
        </h2>
        <div className="provider-row">No projects yet</div>
      </div>
    )
  }

  return (
    <div>
      <h2>
        Projects{' '}
        <span className="link-btn" onClick={onNewProject}>
          + New
        </span>
      </h2>
      {projects.map((project) => {
        const projectSessions = sessions.filter((s) => s.projectId === project.id)
        return (
          <details key={project.id} className="project-group" open={projectSessions.some((s) => s.id === activeSessionId)}>
            <summary className="project-header">
              <span className="project-name" title={project.cwd}>
                {project.name}
              </span>
              <span className="project-header-actions">
                <button
                  className="link-btn"
                  onClick={(e) => {
                    e.preventDefault()
                    onEditProject(project)
                  }}
                  title="Edit project"
                >
                  ✎
                </button>
                <button
                  className="link-btn"
                  onClick={(e) => {
                    e.preventDefault()
                    if (window.confirm(`Delete project "${project.name}"? Its chats will move to the top-level list.`)) {
                      onDeleteProject(project.id)
                    }
                  }}
                  title="Delete project"
                >
                  ×
                </button>
              </span>
            </summary>
            <div className="project-body">
              <button className="new-chat-btn project-new-chat-btn" onClick={() => onNewChatInProject(project.id)}>
                + New chat
              </button>
              {projectSessions.length === 0 && <div className="provider-row">No chats yet</div>}
              {projectSessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  isActive={s.id === activeSessionId}
                  isBusy={busySessionIds.has(s.id)}
                  onOpen={onOpenSession}
                  onRename={onRenameSession}
                  onDelete={onDeleteSession}
                />
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}

export interface ProviderAttempt {
  provider: string
  status: string
  provider_session_id: string | null
  timestamp: string
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  text: string
  provider: string | null
  timestamp: string
}

export interface SessionData {
  id: string
  task: string
  cwd: string
  projectId: string | null
  history: ProviderAttempt[]
  messages: Message[]
  status: string
}

export interface ProjectData {
  id: string
  name: string
  instructions: string
  cwd: string
  createdAt: string
}

export interface ProviderStatus {
  name: string
  installed: boolean
  verified: boolean
  installHint: string
  canAutoInstall: boolean
  canLogin: boolean
  installUrl?: string
  loggedIn: boolean | null
  cooldownUntil: number | null
  lastFailureReason: string | null
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  defaultProvider: string
  defaultFallbackOrder: string[]
}

export type ChatEventKind = 'attempt' | 'skip' | 'failure' | 'handoff' | 'success' | 'cancelled' | 'exhausted'

export interface ChatEvent {
  kind: ChatEventKind
  provider: string | null
  message: string
  detail?: string
  timestamp: string
  taskId: string
}

export interface Attachment {
  path: string
  origin: 'picked' | 'pasted'
}

export interface SkillData {
  id: string
  slug: string
  name: string
  description: string
  body: string
  scope: 'global' | 'project'
  projectId: string | null
  createdAt: string
  updatedAt: string
}

export type McpTransport = 'stdio' | 'http'

export interface McpServerConfig {
  id: string
  name: string
  scope: 'global' | 'project'
  projectId: string | null
  transport: McpTransport
  command: string
  args: string[]
  env: Record<string, string>
  url: string
}

export interface AicliApi {
  getPathForFile: (file: File) => string
  listProviders: () => Promise<ProviderStatus[]>
  listSessions: () => Promise<SessionData[]>
  openSession: (id: string) => Promise<SessionData>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, task: string) => Promise<SessionData>
  attachDialog: () => Promise<string[]>
  pickDirectory: () => Promise<string | null>
  sendMessage: (args: {
    taskId: string
    sessionId: string
    sessionData: SessionData | null
    task: string
    cwd: string
    projectId: string | null
    activeProvider: string
    fallbackOrder: string[]
    text: string
    attachments: string[]
  }) => Promise<{ session: SessionData; answeredBy: string }>
  cancel: (taskId: string) => Promise<void>
  onChatEvent: (callback: (event: ChatEvent) => void) => () => void
  installProvider: (name: string) => Promise<{ code: number | null }>
  loginProvider: (name: string) => Promise<{ code: number | null }>
  checkConnection: (name: string) => Promise<{ status: string }>
  cancelSetup: () => Promise<void>
  openInstallUrl: (name: string) => Promise<void>
  onSetupEvent: (callback: (chunk: string) => void) => () => void
  getSettings: () => Promise<Settings>
  setSettings: (patch: Partial<Settings>) => Promise<Settings>
  listProjects: () => Promise<ProjectData[]>
  createProject: (name: string, instructions: string, cwd: string) => Promise<ProjectData>
  updateProject: (id: string, patch: Partial<Pick<ProjectData, 'name' | 'instructions' | 'cwd'>>) => Promise<ProjectData>
  deleteProject: (id: string) => Promise<void>
  getAttachmentThumbnail: (path: string) => Promise<string | null>
  saveClipboardImage: (data: ArrayBuffer, ext: string) => Promise<string>
  deleteTempAttachment: (path: string) => Promise<void>
  listSkills: () => Promise<SkillData[]>
  createSkill: (name: string, description: string, body: string, scope: 'global' | 'project', projectId: string | null) => Promise<SkillData>
  updateSkill: (
    id: string,
    patch: Partial<Pick<SkillData, 'name' | 'description' | 'body' | 'scope' | 'projectId'>>,
  ) => Promise<SkillData>
  deleteSkill: (id: string) => Promise<void>
  listMcpServers: () => Promise<McpServerConfig[]>
  addMcpServer: (input: Omit<McpServerConfig, 'id'>) => Promise<McpServerConfig>
  updateMcpServer: (id: string, patch: Partial<Omit<McpServerConfig, 'id'>>) => Promise<McpServerConfig>
  removeMcpServer: (id: string) => Promise<void>
}

declare global {
  interface Window {
    aicli: AicliApi
  }
}

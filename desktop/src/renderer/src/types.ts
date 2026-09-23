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
}

export interface Attachment {
  path: string
  origin: 'picked' | 'pasted'
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
    sessionData: SessionData | null
    task: string
    cwd: string
    projectId: string | null
    activeProvider: string
    fallbackOrder: string[]
    text: string
    attachments: string[]
  }) => Promise<{ session: SessionData; answeredBy: string }>
  cancel: () => Promise<void>
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
}

declare global {
  interface Window {
    aicli: AicliApi
  }
}

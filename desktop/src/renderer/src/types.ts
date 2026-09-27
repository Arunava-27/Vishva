export interface ProviderAttempt {
  provider: string
  status: string
  provider_session_id: string | null
  timestamp: string
}

export interface ToolCallSummary {
  name: string
  input?: unknown
  result?: unknown
  diff?: { added: number; removed: number }
}

export interface UsageSummary {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  costUsd?: number
  diff?: { added: number; removed: number }
  other?: Record<string, number>
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  text: string
  provider: string | null
  timestamp: string
  toolCalls?: ToolCallSummary[]
  usage?: UsageSummary
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
  models: string[]
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  defaultProvider: string
  defaultFallbackOrder: string[]
  defaultJudgeProvider: string
  defaultModelByProvider: Record<string, string>
}

export type ChatEventKind = 'attempt' | 'skip' | 'failure' | 'handoff' | 'success' | 'cancelled' | 'exhausted' | 'tool' | 'usage'

export interface ChatEvent {
  kind: ChatEventKind
  provider: string | null
  message: string
  detail?: string
  timestamp: string
  taskId: string
  toolId?: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  toolDiff?: { added: number; removed: number }
  usage?: UsageSummary
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

export type RunStatus = 'SUCCESS' | 'RATE_LIMIT' | 'AUTH_FAILURE' | 'TIMEOUT' | 'TEMPORARY_SERVER_ERROR' | 'UNKNOWN_ERROR' | 'NOT_INSTALLED'

/** Cooperative-mode-only status widening - 'CANCELLED' represents a run
 * cancelled while paused awaiting a clarification answer. Mirrors the same
 * widening in cooperative.ts/cooperativeSession.ts on the main-process side. */
export type CooperativeStatus = RunStatus | 'CANCELLED'

export interface GeneratedFile {
  name: string
  path: string
}

export interface UsageEntry {
  requestCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
  other: Record<string, number>
  lastUsedAt: string
}

// provider name -> model key -> entry (modelKey is 'default' when no model was selected)
export type UsageData = Record<string, Record<string, UsageEntry>>

export interface CooperativeProviderResult {
  provider: string
  status: CooperativeStatus
  reply: string
  toolCalls?: ToolCallSummary[]
  usage?: UsageSummary
  diffStat: string
  diffPatch: string
  changedFiles: string[]
  rawStderr: string
  generatedFiles: GeneratedFile[]
}

export interface CooperativeJudgeResult {
  provider: string
  status: CooperativeStatus
  reply: string
  toolCalls?: ToolCallSummary[]
  usage?: UsageSummary
  generatedFiles: GeneratedFile[]
}

export interface CooperativeTurn {
  prompt: string
  timestamp: string
  providerResults: CooperativeProviderResult[]
  judge: CooperativeJudgeResult | null
  judgeError?: string
}

export interface CooperativeSessionData {
  id: string
  task: string
  cwd: string
  projectId: string | null
  participants: string[]
  judgeProvider: string
  turns: CooperativeTurn[]
  status: string
}

export type CooperativeEventKind =
  | ChatEventKind
  | 'worktree-setup'
  | 'worktree-error'
  | 'judge-start'
  | 'judge-success'
  | 'judge-failure'
  | 'clarify-question'
  | 'clarify-answered'
  | 'clarify-cap-reached'

export interface CooperativeEvent {
  kind: CooperativeEventKind
  provider: string | null
  message: string
  detail?: string
  timestamp: string
  taskId: string
  toolId?: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  toolDiff?: { added: number; removed: number }
  usage?: UsageSummary
}

export interface RepoEligibility {
  isRepo: boolean
  hasCommits: boolean
  dirty: boolean
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
    modelByProvider: Record<string, string>
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
  checkCooperativeRepo: (cwd: string) => Promise<RepoEligibility>
  listCooperativeSessions: () => Promise<CooperativeSessionData[]>
  openCooperativeSession: (id: string) => Promise<CooperativeSessionData>
  deleteCooperativeSession: (id: string) => Promise<void>
  renameCooperativeSession: (id: string, task: string) => Promise<CooperativeSessionData>
  sendCooperative: (args: {
    taskId: string
    sessionId: string
    sessionData: CooperativeSessionData | null
    task: string
    cwd: string
    projectId: string | null
    providers: string[]
    judgeProvider: string
    text: string
    attachments: string[]
    modelByProvider: Record<string, string>
  }) => Promise<{ session: CooperativeSessionData }>
  cancelCooperative: (taskId: string) => Promise<void>
  onCooperativeEvent: (callback: (event: CooperativeEvent) => void) => () => void
  answerClarification: (taskId: string, provider: string, answer: string) => Promise<void>
  openGeneratedFile: (path: string) => Promise<string>
  revealGeneratedFile: (path: string) => Promise<void>
  getUsage: () => Promise<UsageData>
  resetUsage: () => Promise<UsageData>
}

declare global {
  interface Window {
    aicli: AicliApi
  }
}

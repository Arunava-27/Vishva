import { contextBridge, ipcRenderer, webUtils } from 'electron'

interface ChatEvent {
  kind: 'attempt' | 'skip' | 'failure' | 'handoff' | 'success' | 'cancelled' | 'exhausted'
  provider: string | null
  message: string
  detail?: string
  timestamp: string
  taskId: string
}

const api = {
  // File.path was removed from the renderer (Electron 32+); webUtils is the
  // replacement, and it's only reachable from preload - hence this bridge
  // method instead of the renderer touching file.path directly.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  openSession: (id: string) => ipcRenderer.invoke('sessions:open', id),
  deleteSession: (id: string) => ipcRenderer.invoke('sessions:delete', id),
  renameSession: (id: string, task: string) => ipcRenderer.invoke('sessions:rename', id, task),
  attachDialog: () => ipcRenderer.invoke('dialog:attach'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  sendMessage: (args: {
    taskId: string
    sessionId: string
    sessionData: unknown | null
    task: string
    cwd: string
    projectId: string | null
    activeProvider: string
    fallbackOrder: string[]
    text: string
    attachments: string[]
  }) => ipcRenderer.invoke('chat:send', args),
  cancel: (taskId: string) => ipcRenderer.invoke('chat:cancel', taskId),
  onChatEvent: (callback: (event: ChatEvent) => void) => {
    const listener = (_event: unknown, chatEvent: ChatEvent) => callback(chatEvent)
    ipcRenderer.on('chat:event', listener)
    return () => ipcRenderer.removeListener('chat:event', listener)
  },
  installProvider: (name: string) => ipcRenderer.invoke('provider:install', name),
  loginProvider: (name: string) => ipcRenderer.invoke('provider:login', name),
  checkConnection: (name: string) => ipcRenderer.invoke('provider:checkConnection', name),
  cancelSetup: () => ipcRenderer.invoke('provider:cancelSetup'),
  openInstallUrl: (name: string) => ipcRenderer.invoke('provider:openInstallUrl', name),
  onSetupEvent: (callback: (chunk: string) => void) => {
    const listener = (_event: unknown, chunk: string) => callback(chunk)
    ipcRenderer.on('provider:setup-event', listener)
    return () => ipcRenderer.removeListener('provider:setup-event', listener)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (name: string, instructions: string, cwd: string) =>
    ipcRenderer.invoke('projects:create', name, instructions, cwd),
  updateProject: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('projects:update', id, patch),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),
  getAttachmentThumbnail: (path: string) => ipcRenderer.invoke('attachments:thumbnail', path),
  saveClipboardImage: (data: ArrayBuffer, ext: string) => ipcRenderer.invoke('attachments:saveClipboardImage', data, ext),
  deleteTempAttachment: (path: string) => ipcRenderer.invoke('attachments:deleteTemp', path),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  createSkill: (name: string, description: string, body: string, scope: 'global' | 'project', projectId: string | null) =>
    ipcRenderer.invoke('skills:create', name, description, body, scope, projectId),
  updateSkill: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('skills:update', id, patch),
  deleteSkill: (id: string) => ipcRenderer.invoke('skills:delete', id),
  listMcpServers: () => ipcRenderer.invoke('mcp:list'),
  addMcpServer: (input: Record<string, unknown>) => ipcRenderer.invoke('mcp:add', input),
  updateMcpServer: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('mcp:update', id, patch),
  removeMcpServer: (id: string) => ipcRenderer.invoke('mcp:remove', id),
}

export type AicliApi = typeof api

contextBridge.exposeInMainWorld('aicli', api)

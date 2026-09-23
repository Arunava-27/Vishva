import { contextBridge, ipcRenderer, webUtils } from 'electron'

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
    sessionData: unknown | null
    task: string
    cwd: string
    projectId: string | null
    activeProvider: string
    fallbackOrder: string[]
    text: string
    attachments: string[]
  }) => ipcRenderer.invoke('chat:send', args),
  cancel: () => ipcRenderer.invoke('chat:cancel'),
  onChatEvent: (callback: (line: string) => void) => {
    const listener = (_event: unknown, line: string) => callback(line)
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
}

export type AicliApi = typeof api

contextBridge.exposeInMainWorld('aicli', api)

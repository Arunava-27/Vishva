import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { getKnownAuthState, setKnownAuthState } from './authState.ts'
import { sendMessage } from './chat.ts'
import { clearCooldown, getCooldownInfo } from './cooldown.ts'
import { activeMcpServers, addMcpServer, listMcpServers, removeMcpServer, updateMcpServer, type McpServerConfig } from './mcpServers.ts'
import { checkLiveAuthStatus, isInstalled, PROVIDERS, runProvider, type Provider } from './providers.ts'
import { Project, type ProjectData } from './project.ts'
import { Session, type SessionData } from './session.ts'
import { getSettings, setSettings, type Settings } from './settings.ts'
import { runStreamingCommand } from './setup.ts'
import { Skill, type SkillData } from './skill.ts'
import { syncAllSkills, syncSkill, unsyncSkill } from './skillSync.ts'

let mainWindow: BrowserWindow | null = null

type ChildProc = import('node:child_process').ChildProcessWithoutNullStreams

interface RunningTask {
  kind: 'send' | 'setup'
  sessionId: string | null // null for install/login tasks
  proc: ChildProc | null
  cancelled: boolean
  startedAt: number
}

// Keyed by taskId (client-generated in the renderer) so multiple chats can
// send concurrently - the close handler and per-task cancel both look tasks
// up here instead of a single global flag. Setup tasks share this map purely
// so the close handler has one thing to check; SetupPanel itself stays
// single-instance, no real setup-concurrency is being introduced.
const runningTasks = new Map<string, RunningTask>()

// Only one install/login can be visible at a time (SetupPanel is a single
// instance), so cancelling "the current one" just needs this one pointer.
let currentSetupTaskId: string | null = null

function killTree(proc: ChildProc | null): void {
  if (!proc || proc.pid == null || proc.exitCode !== null) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/F', '/T', '/PID', String(proc.pid)], () => {})
  } else {
    proc.kill()
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    title: 'aicli - subscription-aware coding assistant',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Provider subprocesses can spawn their own children (shell commands, git,
  // etc). Closing mid-send asks for confirmation, then kills the whole
  // process tree (not just the top-level one) via taskkill /T on Windows -
  // matches the guarantee already proven out in the Python prototype.
  mainWindow.on('close', (event) => {
    if (runningTasks.size === 0) return
    event.preventDefault()
    const what = runningTasks.size === 1 ? 'A task is still running' : `${runningTasks.size} tasks are still running`
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'question',
      buttons: ['Cancel', 'Stop and close'],
      defaultId: 0,
      cancelId: 0,
      message: what,
      detail:
        'Closing now will stop it immediately (including anything it spawned) ' +
        'rather than leave it running in the background. Continue?',
    })
    if (choice === 1) {
      for (const task of runningTasks.values()) {
        task.cancelled = true
        killTree(task.proc)
      }
      runningTasks.clear()
      mainWindow?.destroy()
    }
  })

  // forwarded to this process's stdout so renderer errors are visible without
  // opening DevTools - useful while iterating from a terminal.
  mainWindow.webContents.on('console-message', (event) => {
    console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, description) => {
    console.error(`[renderer] failed to load: ${code} ${description}`)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function projectCwd(projectId: string): string | null {
  try {
    return Project.load(projectId).data.cwd
  } catch {
    return null
  }
}

app.whenReady().then(() => {
  createWindow()
  syncAllSkills(
    () => Skill.listAll().map((s) => s.data),
    projectCwd,
  )
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// -- IPC -------------------------------------------------------------------

interface ProviderStatus {
  name: string
  installed: boolean
  verified: boolean
  installHint: string
  canAutoInstall: boolean
  canLogin: boolean
  installUrl?: string
  // true/false = known; null = never checked, or this provider has no
  // status command and nothing's been observed about it yet.
  loggedIn: boolean | null
  // epoch ms; null = not currently skipped. >= INDEFINITE_COOLDOWN (from
  // cooldown.ts) means "blocked until re-login/check", not a countdown.
  cooldownUntil: number | null
  // last RunStatus that triggered a cooldown, even after it's expired -
  // "recovered from RATE_LIMIT 10m ago" is still useful context.
  lastFailureReason: string | null
}

ipcMain.handle('providers:list', async (): Promise<ProviderStatus[]> => {
  const results: ProviderStatus[] = []
  for (const p of Object.values(PROVIDERS) as Provider[]) {
    const installed = await isInstalled(p.binary)
    // gating this on p.loginCommand was wrong: antigravity has no login
    // command at all but can still have a real tracked/checked state (from
    // checkConnection or a successful chat) - that's the whole point of the
    // "unknown, click Check" path. Any installed provider should report
    // whatever we actually know, regardless of how a login button.
    let loggedIn: boolean | null = null
    if (installed) {
      loggedIn = p.statusCommand ? await checkLiveAuthStatus(p) : getKnownAuthState(p.name)
    }
    results.push({
      name: p.name,
      installed,
      verified: p.verified,
      installHint: p.installHint,
      canAutoInstall: !!p.installCommand,
      canLogin: !!p.loginCommand,
      installUrl: p.installUrl,
      loggedIn,
      ...getCooldownInfo(p.name),
    })
  }
  return results
})

ipcMain.handle('provider:install', async (event: IpcMainInvokeEvent, name: string) => {
  const provider = PROVIDERS[name]
  if (!provider?.installCommand) return { code: null }
  const taskId = randomUUID()
  currentSetupTaskId = taskId
  const task: RunningTask = { kind: 'setup', sessionId: null, proc: null, cancelled: false, startedAt: Date.now() }
  runningTasks.set(taskId, task)
  const result = await runStreamingCommand(provider.installCommand, {
    onOutput: (chunk) => event.sender.send('provider:setup-event', chunk),
    onProcess: (proc) => {
      task.proc = proc
    },
  })
  runningTasks.delete(taskId)
  if (currentSetupTaskId === taskId) currentSetupTaskId = null
  return result
})

ipcMain.handle('provider:login', async (event: IpcMainInvokeEvent, name: string) => {
  const provider = PROVIDERS[name]
  if (!provider?.loginCommand) return { code: null }
  const taskId = randomUUID()
  currentSetupTaskId = taskId
  const task: RunningTask = { kind: 'setup', sessionId: null, proc: null, cancelled: false, startedAt: Date.now() }
  runningTasks.set(taskId, task)
  const result = await runStreamingCommand(provider.loginCommand, {
    onOutput: (chunk) => event.sender.send('provider:setup-event', chunk),
    onProcess: (proc) => {
      task.proc = proc
    },
  })
  runningTasks.delete(taskId)
  if (currentSetupTaskId === taskId) currentSetupTaskId = null
  // exit 0 is our best signal short of a real status command (copilot has
  // none) - a cancelled/failed run leaves the prior known state alone rather
  // than assuming it means logged out.
  if (result.code === 0) {
    setKnownAuthState(name, true)
    clearCooldown(name)
  }
  return result
})

ipcMain.handle('provider:cancelSetup', () => {
  if (currentSetupTaskId) killTree(runningTasks.get(currentSetupTaskId)?.proc ?? null)
})

ipcMain.handle('provider:openInstallUrl', (_e: IpcMainInvokeEvent, name: string) => {
  const url = PROVIDERS[name]?.installUrl
  if (url) shell.openExternal(url)
})

// For providers with no status/whoami command at all (antigravity has none -
// confirmed from its own CLI reference docs), this is the only way to
// actually know the connection state rather than wait for it to come up
// naturally in a real chat: send one tiny real prompt and see what happens.
// Costs a small real call each time it's clicked - deliberately not run
// automatically or on a timer.
ipcMain.handle('provider:checkConnection', async (_e: IpcMainInvokeEvent, name: string): Promise<{ status: string }> => {
  const provider = PROVIDERS[name]
  if (!provider) return { status: 'UNKNOWN_ERROR' }
  const probeId = randomUUID()
  const result = await runProvider(provider, 'Reply with exactly: OK', probeId, { timeoutMs: 60_000 })
  if (result.status === 'SUCCESS') {
    setKnownAuthState(name, true)
    clearCooldown(name)
  } else if (result.status === 'AUTH_FAILURE') {
    setKnownAuthState(name, false)
  }
  return { status: result.status }
})

ipcMain.handle('sessions:list', (): SessionData[] => {
  return Session.listAll().map((s) => s.data)
})

ipcMain.handle('sessions:open', (_e: IpcMainInvokeEvent, id: string): SessionData => {
  return Session.load(id).data
})

ipcMain.handle('sessions:delete', (_e: IpcMainInvokeEvent, id: string): void => {
  Session.delete(id)
})

ipcMain.handle('sessions:rename', (_e: IpcMainInvokeEvent, id: string, task: string): SessionData => {
  return Session.rename(id, task)
})

ipcMain.handle('settings:get', (): Settings => getSettings())

ipcMain.handle('settings:set', (_e: IpcMainInvokeEvent, patch: Partial<Settings>): Settings => setSettings(patch))

ipcMain.handle('projects:list', (): ProjectData[] => Project.listAll().map((p) => p.data))

ipcMain.handle(
  'projects:create',
  (_e: IpcMainInvokeEvent, name: string, instructions: string, cwd: string): ProjectData => {
    const p = Project.create(name, instructions, cwd)
    p.save()
    return p.data
  },
)

ipcMain.handle(
  'projects:update',
  (_e: IpcMainInvokeEvent, id: string, patch: Partial<Pick<ProjectData, 'name' | 'instructions' | 'cwd'>>): ProjectData => {
    const oldCwd = projectCwd(id)
    const updated = Project.update(id, patch)
    if (patch.cwd !== undefined) {
      for (const skill of Skill.listAll()) {
        if (skill.data.scope === 'project' && skill.data.projectId === id) {
          unsyncSkill(skill.data, oldCwd)
          syncSkill(skill.data, updated.cwd)
        }
      }
    }
    return updated
  },
)

ipcMain.handle('projects:delete', (_e: IpcMainInvokeEvent, id: string): void => {
  const oldCwd = projectCwd(id)
  for (const skill of Skill.listAll()) {
    if (skill.data.scope === 'project' && skill.data.projectId === id) unsyncSkill(skill.data, oldCwd)
  }
  Project.delete(id)
})

ipcMain.handle('skills:list', (): SkillData[] => Skill.listAll().map((s) => s.data))

ipcMain.handle(
  'skills:create',
  (
    _e: IpcMainInvokeEvent,
    name: string,
    description: string,
    body: string,
    scope: 'global' | 'project',
    projectId: string | null,
  ): SkillData => {
    const s = Skill.create(name, description, body, scope, projectId)
    s.save()
    syncSkill(s.data, scope === 'project' && projectId ? projectCwd(projectId) : null)
    return s.data
  },
)

ipcMain.handle(
  'skills:update',
  (
    _e: IpcMainInvokeEvent,
    id: string,
    patch: Partial<Pick<SkillData, 'name' | 'description' | 'body' | 'scope' | 'projectId'>>,
  ): SkillData => {
    const before = Skill.load(id).data
    const oldCwd = before.scope === 'project' && before.projectId ? projectCwd(before.projectId) : null
    const updated = Skill.update(id, patch)
    unsyncSkill(before, oldCwd)
    const newCwd = updated.scope === 'project' && updated.projectId ? projectCwd(updated.projectId) : null
    syncSkill(updated, newCwd)
    return updated
  },
)

ipcMain.handle('skills:delete', (_e: IpcMainInvokeEvent, id: string): void => {
  const s = Skill.load(id).data
  const cwd = s.scope === 'project' && s.projectId ? projectCwd(s.projectId) : null
  unsyncSkill(s, cwd)
  Skill.delete(id)
})

ipcMain.handle('mcp:list', (): McpServerConfig[] => listMcpServers())

ipcMain.handle('mcp:add', (_e: IpcMainInvokeEvent, input: Omit<McpServerConfig, 'id'>): McpServerConfig => addMcpServer(input))

ipcMain.handle(
  'mcp:update',
  (_e: IpcMainInvokeEvent, id: string, patch: Partial<Omit<McpServerConfig, 'id'>>): McpServerConfig =>
    updateMcpServer(id, patch),
)

ipcMain.handle('mcp:remove', (_e: IpcMainInvokeEvent, id: string): void => {
  removeMcpServer(id)
})

ipcMain.handle('dialog:pickDirectory', async (): Promise<string | null> => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:attach', async (): Promise<string[]> => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] })
  return result.canceled ? [] : result.filePaths
})

const THUMB_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const THUMB_MAX_BYTES = 3 * 1024 * 1024 // ponytail: skip preview past this, add real thumbnail generation (sharp) if that proves too small

ipcMain.handle('attachments:thumbnail', (_e: IpcMainInvokeEvent, filePath: string): string | null => {
  const ext = path.extname(filePath).toLowerCase()
  if (!THUMB_EXT.has(ext)) return null
  try {
    if (fs.statSync(filePath).size > THUMB_MAX_BYTES) return null
    const mime = ext === '.jpg' ? 'jpeg' : ext.slice(1)
    return `data:image/${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
  } catch {
    return null
  }
})

ipcMain.handle('attachments:saveClipboardImage', (_e: IpcMainInvokeEvent, data: ArrayBuffer, ext: string): string => {
  const tmp = path.join(os.tmpdir(), `aicli-paste-${randomUUID()}.${ext}`)
  fs.writeFileSync(tmp, Buffer.from(new Uint8Array(data)))
  return tmp
})

ipcMain.handle('attachments:deleteTemp', (_e: IpcMainInvokeEvent, filePath: string): void => {
  try {
    fs.unlinkSync(filePath)
  } catch {
    // already gone - fine
  }
})

ipcMain.handle(
  'chat:send',
  async (
    event: IpcMainInvokeEvent,
    args: {
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
    },
  ): Promise<{ session: SessionData; answeredBy: string }> => {
    const session = args.sessionData
      ? new Session(args.sessionData)
      : Session.create(args.task, args.cwd, args.projectId, args.sessionId)
    const runningTask: RunningTask = { kind: 'send', sessionId: session.data.id, proc: null, cancelled: false, startedAt: Date.now() }
    runningTasks.set(args.taskId, runningTask)

    // best-effort: a project deleted out from under an existing session just
    // means no instructions get prepended (only matters on the first message
    // anyway, and that's long past if the session already has history).
    let projectInstructions: string | undefined
    if (session.data.projectId) {
      try {
        projectInstructions = Project.load(session.data.projectId).data.instructions
      } catch {
        // project no longer exists - fine, see above
      }
    }

    const answeredBy = await sendMessage(session, args.activeProvider, args.fallbackOrder, args.text, {
      attachments: args.attachments,
      onEvent: (chatEvent) => event.sender.send('chat:event', { ...chatEvent, taskId: args.taskId }),
      onProcess: (proc) => {
        runningTask.proc = proc
      },
      isCancelled: () => runningTask.cancelled,
      projectInstructions,
      mcpServers: activeMcpServers(session.data.projectId),
    })

    runningTasks.delete(args.taskId)

    // opportunistic ground truth for providers with no status command: a
    // real chat outcome is stronger evidence than "the login command exited
    // 0 at some point in the past".
    for (const attempt of session.data.history) {
      if (attempt.status === 'SUCCESS') setKnownAuthState(attempt.provider, true)
      else if (attempt.status === 'AUTH_FAILURE') setKnownAuthState(attempt.provider, false)
    }

    return { session: session.data, answeredBy }
  },
)

ipcMain.handle('chat:cancel', (_e: IpcMainInvokeEvent, taskId: string) => {
  const task = runningTasks.get(taskId)
  if (!task) return
  task.cancelled = true
  killTree(task.proc)
})

/**
 * Canonical session state - the source of truth across provider switches.
 *
 * Providers are disposable; this JSON file on disk is not. Same schema and
 * location (~/.aicli/sessions/) as the earlier Python prototype, so sessions
 * created there are still readable here.
 */
import { execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFile = promisify(execFileCb)

// mutable via setSessionsDir() so tests can point it at a temp dir - ESM
// import bindings are read-only from outside the module, so a bare `export
// let` can't be reassigned by a test file the way the earlier Python
// prototype's module attribute could.
export let SESSIONS_DIR = path.join(os.homedir(), '.aicli', 'sessions')

export function setSessionsDir(dir: string): void {
  SESSIONS_DIR = dir
}

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

export class Session {
  data: SessionData

  constructor(data: SessionData) {
    this.data = data
  }

  static create(task: string, cwd: string, projectId: string | null = null): Session {
    // a real UUID, not a truncated one - providers like claude/copilot require
    // --session-id to be a valid UUID, and reusing this same id as *their*
    // native session id is what makes same-provider chat continuation free.
    return new Session({ id: randomUUID(), task, cwd, projectId, history: [], messages: [], status: 'active' })
  }

  static filePath(id: string): string {
    return path.join(SESSIONS_DIR, `${id}.json`)
  }

  static load(id: string): Session {
    const raw = fs.readFileSync(Session.filePath(id), 'utf-8')
    const data = JSON.parse(raw) as SessionData
    data.messages ??= []
    data.history ??= []
    data.projectId ??= null
    return new Session(data)
  }

  static listAll(): Session[] {
    if (!fs.existsSync(SESSIONS_DIR)) return []
    return fs
      .readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => Session.load(f.slice(0, -'.json'.length)))
  }

  save(): void {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true })
    fs.writeFileSync(Session.filePath(this.data.id), JSON.stringify(this.data, null, 2))
  }

  static rename(id: string, task: string): SessionData {
    const s = Session.load(id)
    s.data.task = task
    s.save()
    return s.data
  }

  static delete(id: string): void {
    fs.rmSync(Session.filePath(id), { force: true })
  }

  record(provider: string, status: string, providerSessionId: string | null): void {
    this.data.history.push({
      provider,
      status,
      provider_session_id: providerSessionId,
      timestamp: new Date().toISOString(),
    })
    this.save()
  }

  addMessage(role: Message['role'], text: string, provider: string | null = null): void {
    this.data.messages.push({ role, text, provider, timestamp: new Date().toISOString() })
    this.save()
  }

  async gitState(): Promise<string> {
    try {
      const status = await execFile('git', ['status', '--short'], { cwd: this.data.cwd })
      const diffstat = await execFile('git', ['diff', '--stat'], { cwd: this.data.cwd })
      const out = status.stdout.trim()
      const stat = diffstat.stdout.trim()
      if (!out && !stat) return '(clean working tree)'
      return `Changed files:\n${out}\n\nDiff summary:\n${stat}`
    } catch {
      return '(no git repository or git unavailable)'
    }
  }

  private formatMessages(messages: Message[]): string {
    return messages
      .map((m) => (m.role === 'assistant' ? `assistant (${m.provider})` : m.role) + ': ' + m.text)
      .join('\n')
  }

  /** Prompt for a provider that hasn't seen this conversation yet - either the
   * first message of a resumed session, or a mid-chat provider switch. A
   * provider continuing its own native session (via --resume) needs none of
   * this; it already has the context.
   *
   * Assumes newMessage was already appended via addMessage(), so it's
   * excluded from the transcript here to avoid repeating it twice. */
  async handoffPrompt(newMessage: string): Promise<string> {
    const prior = this.data.messages.slice(0, -1)
    if (prior.length === 0) return newMessage
    const lines = [
      'You are joining an ongoing coding conversation as a new assistant.',
      '',
      'Recent conversation:',
      this.formatMessages(prior.slice(-6)),
      '',
      'Repository state:',
      await this.gitState(),
      '',
      `Now respond to the latest message:\n${newMessage}`,
    ]
    return lines.join('\n')
  }
}

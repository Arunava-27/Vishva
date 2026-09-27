/**
 * Storage for Cooperative-mode conversations - a dedicated store, not an
 * extension of Session/SessionData, because a cooperative turn (N provider
 * results + 1 judge result) doesn't fit Session's flat single-provider
 * Message list without corrupting handoffPrompt()'s assumptions. Same
 * one-JSON-file-per-record pattern as session.ts/project.ts.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RunStatus } from './providers.ts'
import type { ToolCallSummary, UsageSummary } from './session.ts'

export let COOPERATIVE_SESSIONS_DIR = path.join(os.homedir(), '.aicli', 'cooperative-sessions')

/** Test-only: point the store at a temp dir instead of the real one. */
export function setCooperativeSessionsDir(dir: string): void {
  COOPERATIVE_SESSIONS_DIR = dir
}

export interface CooperativeProviderResult {
  provider: string
  status: RunStatus
  reply: string
  toolCalls?: ToolCallSummary[]
  usage?: UsageSummary
  diffStat: string
  diffPatch: string
  changedFiles: string[]
  rawStderr: string
}

export interface CooperativeJudgeResult {
  provider: string
  status: RunStatus
  reply: string
  toolCalls?: ToolCallSummary[]
  usage?: UsageSummary
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

function lastActivity(s: CooperativeSession): number {
  const last = s.data.turns.at(-1)?.timestamp
  if (last) return Date.parse(last)
  try {
    return fs.statSync(CooperativeSession.filePath(s.data.id)).mtimeMs
  } catch {
    return 0
  }
}

export class CooperativeSession {
  data: CooperativeSessionData

  constructor(data: CooperativeSessionData) {
    this.data = data
  }

  static create(
    task: string,
    cwd: string,
    projectId: string | null = null,
    participants: string[] = [],
    judgeProvider: string = 'claude',
    id: string = randomUUID(),
  ): CooperativeSession {
    return new CooperativeSession({
      id,
      task,
      cwd,
      projectId,
      participants,
      judgeProvider,
      turns: [],
      status: 'active',
    })
  }

  static filePath(id: string): string {
    return path.join(COOPERATIVE_SESSIONS_DIR, `${id}.json`)
  }

  static load(id: string): CooperativeSession {
    const raw = fs.readFileSync(CooperativeSession.filePath(id), 'utf-8')
    const data = JSON.parse(raw) as CooperativeSessionData
    data.turns ??= []
    data.participants ??= []
    data.projectId ??= null
    return new CooperativeSession(data)
  }

  static listAll(): CooperativeSession[] {
    if (!fs.existsSync(COOPERATIVE_SESSIONS_DIR)) return []
    return fs
      .readdirSync(COOPERATIVE_SESSIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => CooperativeSession.load(f.slice(0, -'.json'.length)))
      .sort((a, b) => lastActivity(b) - lastActivity(a))
  }

  save(): void {
    fs.mkdirSync(COOPERATIVE_SESSIONS_DIR, { recursive: true })
    fs.writeFileSync(CooperativeSession.filePath(this.data.id), JSON.stringify(this.data, null, 2))
  }

  static rename(id: string, task: string): CooperativeSessionData {
    const s = CooperativeSession.load(id)
    s.data.task = task
    s.save()
    return s.data
  }

  static delete(id: string): void {
    fs.rmSync(CooperativeSession.filePath(id), { force: true })
  }

  addTurn(turn: CooperativeTurn): void {
    this.data.turns.push(turn)
    this.save()
  }
}

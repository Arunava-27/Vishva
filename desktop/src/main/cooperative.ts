/**
 * Cooperative mode: one prompt, fanned out in parallel to every participating
 * provider, each working in its own isolated git worktree (gitWorktree.ts) so
 * N providers can use full file-editing/shell tools without colliding. Once
 * every provider has finished (or failed), a designated judge provider
 * reviews all replies + diffs and produces one synthesized answer, applied
 * directly to the real project directory (not a worktree - safe, because
 * every fan-out provider has already exited by the time the judge runs, so
 * there is exactly one writer touching the real tree).
 *
 * Structurally mirrors chat.ts's sendMessage(): same event-emission idiom,
 * same reliance on providers.ts's runProvider() as the only thing that ever
 * spawns a CLI, same cooldown bookkeeping - but fans out with
 * Promise.allSettled instead of trying providers one at a time as a fallback
 * chain.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { mergeUsage, streamEventToChatEvent, type ChatEvent, type ChatEventKind } from './chat.ts'
import { clearCooldown, isOnCooldown, recordFailure } from './cooldown.ts'
import {
  checkRepoEligibility,
  createWorktrees,
  diffWorktree,
  removeWorktrees,
  repoRoot as gitRepoRoot,
  unpinSnapshot,
  type WorktreeHandle,
} from './gitWorktree.ts'
import type { McpServerConfig } from './mcpServers.ts'
import { displayOutput, PROVIDERS, runProvider, type RunStatus } from './providers.ts'
import type { ToolCallSummary, UsageSummary } from './session.ts'

export type CooperativeEventKind = ChatEventKind | 'worktree-setup' | 'worktree-error' | 'judge-start' | 'judge-success' | 'judge-failure'

export type CooperativeEvent = Omit<ChatEvent, 'kind'> & { kind: CooperativeEventKind }

function makeEvent(kind: CooperativeEventKind, provider: string | null, message: string, detail?: string): CooperativeEvent {
  return { kind, provider, message, detail, timestamp: new Date().toISOString() }
}

export interface CooperativeProviderResult {
  provider: string
  status: RunStatus
  reply: string
  toolCalls: ToolCallSummary[]
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
  toolCalls: ToolCallSummary[]
  usage?: UsageSummary
}

export interface CooperativeRunResult {
  providerResults: CooperativeProviderResult[]
  judge: CooperativeJudgeResult | null
  judgeError?: string
}

export interface CooperativeRunOptions {
  attachments?: string[]
  onEvent?: (e: CooperativeEvent) => void
  /** 'provider' is the participant name, or the reserved key '__judge__' for
   * the judge phase's own process - lets the caller track/kill every child
   * process this run spawns, keyed the same way regardless of phase. */
  onProcess?: (provider: string, proc: ChildProcessWithoutNullStreams) => void
  isCancelled?: () => boolean
  mcpServers?: McpServerConfig[]
  timeoutMs?: number
}

function capDiffForPrompt(diffPatch: string): string {
  const MAX = 20_000 // per-provider slice of the judge's own context budget
  return diffPatch.length > MAX ? diffPatch.slice(0, MAX) + `\n...[diff truncated, ${diffPatch.length - MAX} more chars]` : diffPatch
}

function buildJudgePrompt(originalPrompt: string, results: CooperativeProviderResult[]): string {
  const blocks = results.map(
    (r) => `--- ${r.provider} (status: ${r.status}) ---
Reply:
${r.reply || '(no reply text)'}

Changed files:
${r.changedFiles.length ? r.changedFiles.join('\n') : '(none)'}

Diff:
${capDiffForPrompt(r.diffPatch) || '(no diff)'}
--- end ${r.provider} ---`,
  )
  return `You were one of several AI assistants asked to independently solve this task, each in
its own isolated copy of the repository. You are now the judge: read every assistant's
reply and the actual code changes they made, then produce the single best solution and
apply it directly to this repository (this is the real project, not a copy).

Original task:
${originalPrompt}

${blocks.join('\n\n')}

Now produce the best possible result: prefer the strongest approach among the attempts
above (or synthesize a better one informed by all of them), apply it as real edits in
this working directory using your tools, and explain briefly what you did and why you
chose that approach over the alternatives.`
}

async function runOneProvider(
  handle: WorktreeHandle,
  prompt: string,
  sessionId: string,
  opts: CooperativeRunOptions,
  onEvent: (e: CooperativeEvent) => void,
): Promise<CooperativeProviderResult> {
  const provider = PROVIDERS[handle.provider]
  const empty: Omit<CooperativeProviderResult, 'status' | 'rawStderr'> = {
    provider: handle.provider,
    reply: '',
    toolCalls: [],
    diffStat: '',
    diffPatch: '',
    changedFiles: [],
  }

  if (!provider) {
    onEvent(makeEvent('failure', handle.provider, `Unknown provider '${handle.provider}'`))
    return { ...empty, status: 'UNKNOWN_ERROR', rawStderr: '' }
  }

  if (isOnCooldown(handle.provider)) {
    onEvent(makeEvent('failure', handle.provider, 'On cooldown, skipping this run'))
    return { ...empty, status: 'RATE_LIMIT', rawStderr: '' }
  }

  onEvent(makeEvent('attempt', handle.provider, 'Thinking...'))

  const toolCalls: ToolCallSummary[] = []
  const toolCallsById = new Map<string, ToolCallSummary>()
  let usage: UsageSummary | undefined

  const result = await runProvider(provider, prompt, `${sessionId}:${handle.provider}`, {
    cwd: handle.cwd,
    attachments: opts.attachments,
    mcpServers: opts.mcpServers,
    timeoutMs: opts.timeoutMs,
    onProcess: (proc) => opts.onProcess?.(handle.provider, proc),
    onStreamEvent: (evt) => {
      const ce = streamEventToChatEvent(handle.provider, evt)
      onEvent(ce as CooperativeEvent)
      if (ce.kind === 'tool') {
        const existing = ce.toolId ? toolCallsById.get(ce.toolId) : undefined
        if (existing) {
          if (ce.toolName) existing.name = ce.toolName
          if (ce.toolInput !== undefined) existing.input = ce.toolInput
          if (ce.toolResult !== undefined) existing.result = ce.toolResult
          if (ce.toolDiff) existing.diff = ce.toolDiff
        } else {
          const summary: ToolCallSummary = { name: ce.toolName ?? 'tool', input: ce.toolInput, result: ce.toolResult, diff: ce.toolDiff }
          toolCalls.push(summary)
          if (ce.toolId) toolCallsById.set(ce.toolId, summary)
        }
      }
      if (ce.kind === 'usage') usage = mergeUsage(usage, ce.usage)
    },
  })

  if (result.status === 'SUCCESS') clearCooldown(handle.provider)
  else recordFailure(handle.provider, result.status)

  // Diff the worktree regardless of status - a provider that errored out
  // partway through may still have left useful edits behind.
  let diff = { changedFiles: [] as string[], diffStat: '', diffPatch: '' }
  try {
    diff = await diffWorktree(handle)
  } catch {
    // worktree may already be gone if this ran after cancellation - fine, empty diff.
  }

  onEvent(
    makeEvent(
      result.status === 'SUCCESS' ? 'success' : 'failure',
      handle.provider,
      result.status === 'SUCCESS' ? 'Responded.' : result.status,
      result.status === 'SUCCESS' ? undefined : result.rawStderr.trim().slice(0, 300) || '(no output)',
    ),
  )

  return {
    provider: handle.provider,
    status: result.status,
    reply: result.status === 'SUCCESS' ? displayOutput(result.output) : '',
    toolCalls,
    usage,
    diffStat: diff.diffStat,
    diffPatch: diff.diffPatch,
    changedFiles: diff.changedFiles,
    rawStderr: result.rawStderr,
  }
}

export async function runCooperative(
  sessionCwd: string,
  sessionId: string,
  prompt: string,
  providerNames: string[],
  judgeProviderName: string,
  opts: CooperativeRunOptions = {},
): Promise<CooperativeRunResult> {
  const onEvent = opts.onEvent ?? (() => {})
  const isCancelled = opts.isCancelled ?? (() => false)

  const eligibility = await checkRepoEligibility(sessionCwd)
  if (!eligibility.isRepo || !eligibility.hasCommits) {
    return {
      providerResults: [],
      judge: null,
      judgeError: 'Cooperative mode needs a git repository with at least one commit.',
    }
  }

  const repoRootPath = await gitRepoRoot(sessionCwd)
  let handles: WorktreeHandle[] = []
  try {
    handles = await createWorktrees(repoRootPath, sessionCwd, sessionId, providerNames)
  } catch (err) {
    return {
      providerResults: [],
      judge: null,
      judgeError: `Failed to set up isolated worktrees: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  for (const h of handles) onEvent(makeEvent('worktree-setup', h.provider, 'Isolated worktree ready.'))

  try {
    if (isCancelled()) {
      await removeWorktrees(repoRootPath, handles)
      await unpinSnapshot(repoRootPath, sessionId)
      return { providerResults: [], judge: null, judgeError: 'cancelled' }
    }

    const settled = await Promise.allSettled(handles.map((h) => runOneProvider(h, prompt, sessionId, opts, onEvent)))
    const providerResults: CooperativeProviderResult[] = settled.map((s, i) =>
      s.status === 'fulfilled'
        ? s.value
        : {
            provider: handles[i].provider,
            status: 'UNKNOWN_ERROR' as RunStatus,
            reply: '',
            toolCalls: [],
            diffStat: '',
            diffPatch: '',
            changedFiles: [],
            rawStderr: s.reason instanceof Error ? s.reason.message : String(s.reason),
          },
    )

    // Every per-provider worktree is removed as it finishes inside
    // runOneProvider's caller flow would be ideal, but diffWorktree() must run
    // before removal - so remove them all here, once every diff has been
    // captured above.
    await removeWorktrees(repoRootPath, handles)
    await unpinSnapshot(repoRootPath, sessionId)
    handles = []

    if (isCancelled()) {
      return { providerResults, judge: null, judgeError: 'cancelled' }
    }

    const succeeded = providerResults.filter((r) => r.status === 'SUCCESS')
    if (succeeded.length === 0) {
      return { providerResults, judge: null, judgeError: 'All providers failed or were unavailable.' }
    }

    const judgeProviderObj = PROVIDERS[judgeProviderName]
    if (!judgeProviderObj) {
      return { providerResults, judge: null, judgeError: `Unknown judge provider '${judgeProviderName}'.` }
    }

    onEvent(makeEvent('judge-start', judgeProviderName, 'Reviewing all attempts...'))
    const judgePrompt = buildJudgePrompt(prompt, providerResults)
    const judgeToolCalls: ToolCallSummary[] = []
    const judgeToolCallsById = new Map<string, ToolCallSummary>()
    let judgeUsage: UsageSummary | undefined

    const judgeRun = await runProvider(judgeProviderObj, judgePrompt, `${sessionId}:judge`, {
      cwd: sessionCwd,
      mcpServers: opts.mcpServers,
      timeoutMs: opts.timeoutMs,
      onProcess: (proc) => opts.onProcess?.('__judge__', proc),
      onStreamEvent: (evt) => {
        const ce = streamEventToChatEvent(judgeProviderName, evt)
        onEvent(ce as CooperativeEvent)
        if (ce.kind === 'tool') {
          const existing = ce.toolId ? judgeToolCallsById.get(ce.toolId) : undefined
          if (existing) {
            if (ce.toolName) existing.name = ce.toolName
            if (ce.toolInput !== undefined) existing.input = ce.toolInput
            if (ce.toolResult !== undefined) existing.result = ce.toolResult
            if (ce.toolDiff) existing.diff = ce.toolDiff
          } else {
            const summary: ToolCallSummary = { name: ce.toolName ?? 'tool', input: ce.toolInput, result: ce.toolResult, diff: ce.toolDiff }
            judgeToolCalls.push(summary)
            if (ce.toolId) judgeToolCallsById.set(ce.toolId, summary)
          }
        }
        if (ce.kind === 'usage') judgeUsage = mergeUsage(judgeUsage, ce.usage)
      },
    })

    if (isCancelled()) {
      onEvent(makeEvent('cancelled', judgeProviderName, 'Cancelled.'))
      return { providerResults, judge: null, judgeError: 'cancelled' }
    }

    if (judgeRun.status !== 'SUCCESS') {
      onEvent(makeEvent('judge-failure', judgeProviderName, judgeRun.status))
      return { providerResults, judge: null, judgeError: `Judge (${judgeProviderName}) failed: ${judgeRun.status}` }
    }

    onEvent(makeEvent('judge-success', judgeProviderName, 'Synthesized the best result.'))
    return {
      providerResults,
      judge: {
        provider: judgeProviderName,
        status: 'SUCCESS',
        reply: displayOutput(judgeRun.output),
        toolCalls: judgeToolCalls,
        usage: judgeUsage,
      },
    }
  } finally {
    if (handles.length > 0) {
      await removeWorktrees(repoRootPath, handles).catch(() => {})
      await unpinSnapshot(repoRootPath, sessionId).catch(() => {})
    }
  }
}


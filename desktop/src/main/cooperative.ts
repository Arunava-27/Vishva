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
 * A fan-out provider or the judge can also pause mid-turn to ask the user a
 * clarifying question (via a marker convention detected in its reply - see
 * extractClarifyingQuestion) or generate a real deliverable file (PDF/xlsx/
 * diagram/etc, surfaced via `generatedFiles`) - both features share the same
 * per-round prompt loop in runOneProvider/runJudge below.
 *
 * Structurally mirrors chat.ts's sendMessage(): same event-emission idiom,
 * same reliance on providers.ts's runProvider() as the only thing that ever
 * spawns a CLI, same cooldown bookkeeping - but fans out with
 * Promise.allSettled instead of trying providers one at a time as a fallback
 * chain.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mergeUsage, streamEventToChatEvent, type ChatEvent, type ChatEventKind } from './chat.ts'
import { copyOutGeneratedFiles, locateJudgeGeneratedFiles, type GeneratedFile } from './cooperativeAttachments.ts'
import { clearCooldown, isOnCooldown, recordFailure } from './cooldown.ts'
import {
  checkRepoEligibility,
  createWorktrees,
  diffWorktree,
  gitStatusShort,
  removeWorktrees,
  repoRoot as gitRepoRoot,
  unpinSnapshot,
  type WorktreeHandle,
} from './gitWorktree.ts'
import type { McpServerConfig } from './mcpServers.ts'
import { displayOutput, PROVIDERS, runProvider, type RunResult, type RunStatus } from './providers.ts'
import type { ToolCallSummary, UsageSummary } from './session.ts'
import { recordUsage } from './usage.ts'

export type { GeneratedFile }

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

export type CooperativeEvent = Omit<ChatEvent, 'kind'> & { kind: CooperativeEventKind }

function makeEvent(kind: CooperativeEventKind, provider: string | null, message: string, detail?: string): CooperativeEvent {
  return { kind, provider, message, detail, timestamp: new Date().toISOString() }
}

/** A cooperative-mode-only status widening ('cancelled while paused awaiting
 * an answer') - deliberately NOT merged into providers.ts's shared RunStatus,
 * which chat.ts/cooldown.ts's COOLDOWN_MS switch also consume. */
export type CooperativeStatus = RunStatus | 'CANCELLED'

export interface CooperativeProviderResult {
  provider: string
  status: CooperativeStatus
  reply: string
  toolCalls: ToolCallSummary[]
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
  toolCalls: ToolCallSummary[]
  usage?: UsageSummary
  generatedFiles: GeneratedFile[]
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
  /** Called when a fan-out provider or the judge (real provider name either
   * way, not a reserved token - the same identity CooperativeEvent.provider
   * already uses) emits a clarification-marker reply. Must resolve with the
   * user's typed answer, or null if the wait was cancelled - null tells the
   * loop to stop and treat this attempt as cancelled. Omitting this option
   * entirely just proceeds with whatever the provider said (no pause). */
  onClarificationNeeded?: (provider: string, question: string, round: number) => Promise<string | null>
  /** Ceiling on clarification round-trips per provider (fan-out or judge)
   * before it's force-told to give its best answer with no further
   * questions. */
  maxClarifyRounds?: number
  /** Keyed by provider name, same shape as chat.ts's SendMessageOptions -
   * the judge's own model choice is looked up under judgeProviderName; if
   * the judge is also a fan-out participant, they intentionally share one
   * entry (same provider doing two jobs, not a case needing separate keys). */
  modelByProvider?: Record<string, string>
}

const MAX_CLARIFY_ROUNDS = 3

const CLARIFY_START = '===AICLI_CLARIFICATION_NEEDED==='
const CLARIFY_END = '===AICLI_CLARIFICATION_NEEDED_END==='
const CLARIFY_RE = new RegExp(`^${CLARIFY_START}\\s*\\r?\\n([\\s\\S]*?)\\r?\\n${CLARIFY_END}\\s*$`, 'm')

/** Detects the clarification marker block in a provider's reply text. A
 * line-anchored fenced block (the `m` flag makes ^/$ match line boundaries,
 * not just string boundaries) so it's found amid other prose while being
 * effectively impossible to trigger by a provider merely discussing the
 * concept of asking a question. */
export function extractClarifyingQuestion(replyText: string): string | null {
  const m = CLARIFY_RE.exec(replyText)
  return m ? m[1].trim() : null
}

function clarifyInstructionsBlock(forceFinalAnswer: boolean): string {
  if (forceFinalAnswer) {
    return `You have used all available clarification rounds. Do not ask any further questions and do not use the clarification block below. Proceed now and give the best possible answer, using reasonable assumptions for anything still unclear.`
  }
  return `If, and only if, you genuinely cannot proceed correctly without more information from the user, respond with ONLY the block below instead of attempting the task, and make no file edits yet:

${CLARIFY_START}
<your one specific question, in plain language>
${CLARIFY_END}

Do not use this for anything you can reasonably resolve yourself with a sensible assumption - only for genuine ambiguity or missing required information. You will be given the user's answer and asked to continue.`
}

function fileGenInstructionsBlock(): string {
  return `If a real deliverable file (a PDF report, an .xlsx/.csv spreadsheet, a .docx/.pptx document, or a chart/diagram image) would serve this request better than plain text, generate it for real using whatever tool/library you have available (write and run a small script if needed) and save it in this working directory - don't just describe it. If a plain-text answer is genuinely sufficient, don't manufacture a file just to have one.`
}

function buildFanOutPrompt(originalPrompt: string, opts: { forceFinalAnswer: boolean }): string {
  return `${originalPrompt}\n\n${fileGenInstructionsBlock()}\n\n${clarifyInstructionsBlock(opts.forceFinalAnswer)}`
}

function buildClarifyFollowupPrompt(originalPrompt: string, question: string, answer: string, opts: { forceFinalAnswer: boolean }): string {
  return `${buildFanOutPrompt(originalPrompt, opts)}\n\n--- Previous round ---\nYou asked: ${question}\nThe user answered: ${answer}\n\nContinue the task now using this new information.`
}

function capDiffForPrompt(diffPatch: string): string {
  const MAX = 20_000 // per-provider slice of the judge's own context budget
  return diffPatch.length > MAX ? diffPatch.slice(0, MAX) + `\n...[diff truncated, ${diffPatch.length - MAX} more chars]` : diffPatch
}

function buildJudgePrompt(originalPrompt: string, results: CooperativeProviderResult[], opts: { forceFinalAnswer: boolean }): string {
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
chose that approach over the alternatives.

${fileGenInstructionsBlock()} If one of the attempts above already produced a good deliverable file, prefer keeping or improving it over regenerating from scratch.

${clarifyInstructionsBlock(opts.forceFinalAnswer)}`
}

function buildJudgeClarifyFollowupPrompt(
  originalPrompt: string,
  results: CooperativeProviderResult[],
  question: string,
  answer: string,
  opts: { forceFinalAnswer: boolean },
): string {
  return `${buildJudgePrompt(originalPrompt, results, opts)}\n\n--- Previous round ---\nYou asked: ${question}\nThe user answered: ${answer}\n\nContinue now using this new information.`
}

function cancelledRunResult(detail: string): RunResult {
  return { status: 'UNKNOWN_ERROR', output: '', sessionId: null, rawStderr: detail }
}

async function runOneProvider(
  handle: WorktreeHandle,
  originalPrompt: string,
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
    generatedFiles: [],
  }

  if (!provider) {
    onEvent(makeEvent('failure', handle.provider, `Unknown provider '${handle.provider}'`))
    return { ...empty, status: 'UNKNOWN_ERROR', rawStderr: '' }
  }

  if (isOnCooldown(handle.provider)) {
    onEvent(makeEvent('failure', handle.provider, 'On cooldown, skipping this run'))
    return { ...empty, status: 'RATE_LIMIT', rawStderr: '' }
  }

  const maxRounds = opts.maxClarifyRounds ?? MAX_CLARIFY_ROUNDS
  const toolCalls: ToolCallSummary[] = []
  const toolCallsById = new Map<string, ToolCallSummary>()
  let usage: UsageSummary | undefined

  let round = 0
  let forcedFinal = false
  let cancelled = false
  let promptForRound = buildFanOutPrompt(originalPrompt, { forceFinalAnswer: false })
  let result!: RunResult

  while (true) {
    if (opts.isCancelled?.()) {
      cancelled = true
      result = cancelledRunResult('Cancelled.')
      break
    }
    round += 1
    onEvent(makeEvent('attempt', handle.provider, round === 1 ? 'Thinking...' : 'Resuming with your answer...'))

    result = await runProvider(provider, promptForRound, randomUUID(), {
      cwd: handle.cwd,
      attachments: opts.attachments,
      mcpServers: opts.mcpServers,
      timeoutMs: opts.timeoutMs,
      model: opts.modelByProvider?.[handle.provider],
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

    if (result.status !== 'SUCCESS') break
    if (forcedFinal) break

    const question = extractClarifyingQuestion(displayOutput(result.output))
    if (question === null) break

    if (round >= maxRounds) {
      onEvent(makeEvent('clarify-cap-reached', handle.provider, `Reached the ${maxRounds}-round limit; asking for a best-effort final answer.`))
      forcedFinal = true
      promptForRound = buildFanOutPrompt(originalPrompt, { forceFinalAnswer: true })
      continue
    }

    onEvent(makeEvent('clarify-question', handle.provider, question, `round ${round} of ${maxRounds}`))
    if (!opts.onClarificationNeeded) break

    const answer = await opts.onClarificationNeeded(handle.provider, question, round)
    if (answer === null) {
      cancelled = true
      onEvent(makeEvent('cancelled', handle.provider, 'Cancelled while awaiting clarification.'))
      result = cancelledRunResult('Cancelled while awaiting clarification.')
      break
    }
    onEvent(makeEvent('clarify-answered', handle.provider, 'Answer received, resuming...'))
    promptForRound = buildClarifyFollowupPrompt(originalPrompt, question, answer, { forceFinalAnswer: false })
  }

  const status: CooperativeStatus = cancelled ? 'CANCELLED' : result.status

  // Diff the worktree regardless of status - a provider that errored out
  // partway through may still have left useful edits behind.
  let diff = { changedFiles: [] as string[], diffStat: '', diffPatch: '' }
  try {
    diff = await diffWorktree(handle)
  } catch {
    // worktree may already be gone if this ran after cancellation - fine, empty diff.
  }

  let generatedFiles: GeneratedFile[] = []
  try {
    generatedFiles = await copyOutGeneratedFiles(handle.path, diff.changedFiles, sessionId, handle.provider)
  } catch {
    // best-effort - never let attachment copying fail the whole attempt
  }

  if (!cancelled) {
    onEvent(
      makeEvent(
        status === 'SUCCESS' ? 'success' : 'failure',
        handle.provider,
        status === 'SUCCESS' ? 'Responded.' : status,
        status === 'SUCCESS' ? undefined : result.rawStderr.trim().slice(0, 300) || '(no output)',
      ),
    )
  }

  if (status === 'SUCCESS') {
    recordUsage(handle.provider, opts.modelByProvider?.[handle.provider] ?? 'default', usage)
  }

  return {
    provider: handle.provider,
    status,
    reply: status === 'SUCCESS' ? displayOutput(result.output) : '',
    toolCalls,
    usage,
    diffStat: diff.diffStat,
    diffPatch: diff.diffPatch,
    changedFiles: diff.changedFiles,
    rawStderr: result.rawStderr,
    generatedFiles,
  }
}

interface JudgeOutcome {
  judge: CooperativeJudgeResult | null
  judgeError?: string
}

async function runJudge(
  sessionCwd: string,
  judgeProviderName: string,
  originalPrompt: string,
  providerResults: CooperativeProviderResult[],
  opts: CooperativeRunOptions,
  onEvent: (e: CooperativeEvent) => void,
): Promise<JudgeOutcome> {
  const judgeProviderObj = PROVIDERS[judgeProviderName]
  if (!judgeProviderObj) {
    return { judge: null, judgeError: `Unknown judge provider '${judgeProviderName}'.` }
  }

  let preStatus: string[] = []
  try {
    preStatus = await gitStatusShort(sessionCwd)
  } catch {
    // fine - generated-file detection will just see everything as "new"
  }

  onEvent(makeEvent('judge-start', judgeProviderName, 'Reviewing all attempts...'))

  const maxRounds = opts.maxClarifyRounds ?? MAX_CLARIFY_ROUNDS
  const judgeToolCalls: ToolCallSummary[] = []
  const judgeToolCallsById = new Map<string, ToolCallSummary>()
  let judgeUsage: UsageSummary | undefined

  let round = 0
  let forcedFinal = false
  let judgePrompt = buildJudgePrompt(originalPrompt, providerResults, { forceFinalAnswer: false })
  let judgeRun!: RunResult

  while (true) {
    if (opts.isCancelled?.()) return { judge: null, judgeError: 'cancelled' }
    round += 1

    judgeRun = await runProvider(judgeProviderObj, judgePrompt, randomUUID(), {
      cwd: sessionCwd,
      mcpServers: opts.mcpServers,
      timeoutMs: opts.timeoutMs,
      model: opts.modelByProvider?.[judgeProviderName],
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

    if (opts.isCancelled?.()) {
      onEvent(makeEvent('cancelled', judgeProviderName, 'Cancelled.'))
      return { judge: null, judgeError: 'cancelled' }
    }

    if (judgeRun.status !== 'SUCCESS') {
      onEvent(makeEvent('judge-failure', judgeProviderName, judgeRun.status))
      return { judge: null, judgeError: `Judge (${judgeProviderName}) failed: ${judgeRun.status}` }
    }

    if (forcedFinal) break

    const question = extractClarifyingQuestion(displayOutput(judgeRun.output))
    if (question === null) break

    if (round >= maxRounds) {
      onEvent(makeEvent('clarify-cap-reached', judgeProviderName, `Reached the ${maxRounds}-round limit; asking for a best-effort final answer.`))
      forcedFinal = true
      judgePrompt = buildJudgePrompt(originalPrompt, providerResults, { forceFinalAnswer: true })
      continue
    }

    onEvent(makeEvent('clarify-question', judgeProviderName, question, `round ${round} of ${maxRounds}`))
    if (!opts.onClarificationNeeded) break

    const answer = await opts.onClarificationNeeded(judgeProviderName, question, round)
    if (answer === null) {
      onEvent(makeEvent('cancelled', judgeProviderName, 'Cancelled while awaiting clarification.'))
      return { judge: null, judgeError: 'cancelled' }
    }
    onEvent(makeEvent('clarify-answered', judgeProviderName, 'Answer received, resuming...'))
    judgePrompt = buildJudgeClarifyFollowupPrompt(originalPrompt, providerResults, question, answer, { forceFinalAnswer: false })
  }

  onEvent(makeEvent('judge-success', judgeProviderName, 'Synthesized the best result.'))

  let postStatus: string[] = []
  try {
    postStatus = await gitStatusShort(sessionCwd)
  } catch {
    // fine - generated-file detection will just see nothing as "new"
  }
  const newStatusLines = postStatus.filter((l) => !preStatus.includes(l))
  const generatedFiles = locateJudgeGeneratedFiles(sessionCwd, newStatusLines)

  recordUsage(judgeProviderName, opts.modelByProvider?.[judgeProviderName] ?? 'default', judgeUsage)

  return {
    judge: {
      provider: judgeProviderName,
      status: 'SUCCESS',
      reply: displayOutput(judgeRun.output),
      toolCalls: judgeToolCalls,
      usage: judgeUsage,
      generatedFiles,
    },
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
            status: 'UNKNOWN_ERROR' as CooperativeStatus,
            reply: '',
            toolCalls: [],
            diffStat: '',
            diffPatch: '',
            changedFiles: [],
            rawStderr: s.reason instanceof Error ? s.reason.message : String(s.reason),
            generatedFiles: [],
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

    const { judge, judgeError } = await runJudge(sessionCwd, judgeProviderName, prompt, providerResults, opts, onEvent)
    return { providerResults, judge, judgeError }
  } finally {
    if (handles.length > 0) {
      await removeWorktrees(repoRootPath, handles).catch(() => {})
      await unpinSnapshot(repoRootPath, sessionId).catch(() => {})
    }
  }
}

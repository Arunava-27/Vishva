/**
 * One chat turn. Tries activeProvider first - natively resuming its own
 * session via --resume if it already answered in this session before, which
 * costs no context-rebuilding and is cache-cheap. On failure, falls back
 * through fallbackOrder, handing off via session.handoffPrompt() since a
 * provider joining mid-conversation has no native memory of it.
 *
 * Cancellation is checked *before* deciding SUCCESS, not just on the failure
 * path - a provider killed right as it happens to exit 0 must still be
 * reported as cancelled, not as a false success (found the hard way in the
 * Python prototype's test suite).
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { clearCooldown, getCooldownInfo, INDEFINITE_COOLDOWN, isOnCooldown, recordFailure } from './cooldown.ts'
import type { McpServerConfig } from './mcpServers.ts'
import { displayOutput, PROVIDERS, runProvider, type ProviderToolOrUsageEvent } from './providers.ts'
import type { Session, ToolCallSummary, UsageSummary } from './session.ts'

export type ChatEventKind = 'attempt' | 'skip' | 'failure' | 'handoff' | 'success' | 'cancelled' | 'exhausted' | 'tool' | 'usage'

export interface ChatEvent {
  kind: ChatEventKind
  provider: string | null
  message: string
  detail?: string
  timestamp: string
  // only populated when kind === 'tool'
  toolId?: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  toolDiff?: { added: number; removed: number }
  // only populated when kind === 'usage'
  usage?: UsageSummary
}

export type EventFn = (event: ChatEvent) => void

function makeEvent(kind: ChatEventKind, provider: string | null, message: string, detail?: string): ChatEvent {
  return { kind, provider, message, detail, timestamp: new Date().toISOString() }
}

/** Normalizes a mid-flight ProviderStreamEvent (providers.ts's per-CLI
 * schema translation) into the ChatEvent vocabulary the renderer speaks -
 * keeps providers.ts ignorant of ChatEvent's shape. */
function streamEventToChatEvent(provider: string, evt: ProviderToolOrUsageEvent): ChatEvent {
  const timestamp = new Date().toISOString()
  if (evt.type === 'tool') {
    return {
      kind: 'tool', provider, message: `Used ${evt.name}`, timestamp,
      toolId: evt.id, toolName: evt.name, toolInput: evt.input, toolResult: evt.result, toolDiff: evt.diff,
    }
  }
  const bits = [
    evt.tokens && `${(evt.tokens.input ?? 0) + (evt.tokens.output ?? 0)} tokens`,
    evt.costUsd != null && `$${evt.costUsd.toFixed(2)}`,
    evt.other && Object.entries(evt.other).map(([k, v]) => `${v} ${k}`).join(', '),
  ].filter(Boolean)
  return {
    kind: 'usage', provider, message: bits.join(' · ') || 'Usage', timestamp,
    usage: {
      inputTokens: evt.tokens?.input, outputTokens: evt.tokens?.output, reasoningTokens: evt.tokens?.reasoning,
      costUsd: evt.costUsd, diff: evt.diff, other: evt.other,
    },
  }
}

/** Sums usage across however many 'usage' events fired during one attempt -
 * safe because none of the confirmed per-step numbers are running cumulative
 * totals (claude emits one per tool-loop step, the others emit one final
 * one). `diff` is copilot's already-final aggregate, not additive - the
 * latest one wins rather than summing. */
function mergeUsage(acc: UsageSummary | undefined, u: UsageSummary | undefined): UsageSummary | undefined {
  if (!u) return acc
  const other = { ...acc?.other }
  if (u.other) for (const [k, v] of Object.entries(u.other)) other[k] = (other[k] ?? 0) + v
  return {
    inputTokens: (acc?.inputTokens ?? 0) + (u.inputTokens ?? 0),
    outputTokens: (acc?.outputTokens ?? 0) + (u.outputTokens ?? 0),
    reasoningTokens: (acc?.reasoningTokens ?? 0) + (u.reasoningTokens ?? 0),
    costUsd: (acc?.costUsd ?? 0) + (u.costUsd ?? 0),
    diff: u.diff ?? acc?.diff,
    ...(Object.keys(other).length > 0 ? { other } : {}),
  }
}

export interface SendMessageOptions {
  attachments?: string[]
  onEvent?: EventFn
  onProcess?: (proc: ChildProcessWithoutNullStreams) => void
  isCancelled?: () => boolean
  /** A project's custom instructions - prepended once, to this session's very
   * first message only. Every later turn (including a mid-conversation
   * provider switch, via handoffPrompt's transcript reconstruction) inherits
   * it from that first message rather than needing to be re-injected. */
  projectInstructions?: string
  mcpServers?: McpServerConfig[]
}

export async function sendMessage(
  session: Session,
  activeProvider: string,
  fallbackOrder: string[],
  text: string,
  opts: SendMessageOptions = {},
): Promise<string> {
  const onEvent = opts.onEvent ?? (() => {})
  const isCancelled = opts.isCancelled ?? (() => false)

  let finalText = text
  if (opts.projectInstructions && session.data.messages.length === 0) {
    finalText = `${opts.projectInstructions}\n\n---\n\n${finalText}`
  }
  if (opts.attachments && opts.attachments.length > 0) {
    const note = 'Attached file(s) - read them if relevant:\n' + opts.attachments.map((p) => `- ${p}`).join('\n')
    finalText = `${text}\n\n${note}`
  }
  session.addMessage('user', finalText)

  const order = [activeProvider, ...fallbackOrder.filter((p) => p !== activeProvider)]

  for (let i = 0; i < order.length; i++) {
    const name = order[i]
    if (isCancelled()) {
      onEvent(makeEvent('cancelled', null, 'Cancelled.'))
      return activeProvider
    }

    const provider = PROVIDERS[name]
    if (!provider) {
      onEvent(makeEvent('skip', name, `Unknown provider '${name}', skipping`))
      continue
    }

    // The user's own explicit choice (order[0]) is never silently skipped -
    // they may know better than a 15-minute-old cooldown guess. Only
    // auto-selected fallback candidates get skipped outright, since avoiding
    // a known-bad attempt is the whole point of a fallback list.
    if (isOnCooldown(name)) {
      const { cooldownUntil, lastFailureReason } = getCooldownInfo(name)
      const detail =
        cooldownUntil !== null && cooldownUntil < INDEFINITE_COOLDOWN
          ? `retry in ${Math.ceil((cooldownUntil - Date.now()) / 60_000)}m`
          : 'needs re-login/check'
      if (i > 0) {
        onEvent(makeEvent('skip', name, 'On cooldown', `${lastFailureReason}, ${detail}`))
        continue
      }
      onEvent(makeEvent('attempt', name, 'On cooldown, trying anyway (you selected it)', lastFailureReason ?? undefined))
    }

    const usedBefore = session.data.history.some((h) => h.provider === name && h.status === 'SUCCESS')
    // a provider with no resumeArgs (e.g. antigravity - it assigns its own
    // conversation id instead of accepting ours, not wired up yet) has no way
    // to actually continue natively even if it succeeded before; sending it
    // the raw follow-up text alone would be context-free nonsense, so it
    // still needs the full reconstructed prompt every time.
    const canResumeNatively = usedBefore && !!provider.resumeArgs
    const prompt = canResumeNatively ? finalText : await session.handoffPrompt(finalText)

    onEvent(makeEvent('attempt', name, 'Thinking...'))
    const attemptToolCalls: ToolCallSummary[] = []
    const toolCallsById = new Map<string, ToolCallSummary>()
    let attemptUsage: UsageSummary | undefined
    const result = await runProvider(provider, prompt, session.data.id, {
      useResume: canResumeNatively,
      attachments: opts.attachments,
      mcpServers: opts.mcpServers,
      onProcess: opts.onProcess,
      cwd: session.data.cwd,
      onStreamEvent: (evt) => {
        const ce = streamEventToChatEvent(name, evt)
        onEvent(ce)
        if (ce.kind === 'tool') {
          // copilot emits a start/complete pair sharing one toolId - the
          // complete half doesn't repeat toolName/toolInput (confirmed live),
          // so only overwrite fields that are actually present, never
          // clobber good data from the start half with undefined. The other
          // 3 providers' tool events arrive complete in one shot (no id) and
          // just push a new entry every time.
          const existing = ce.toolId ? toolCallsById.get(ce.toolId) : undefined
          if (existing) {
            if (ce.toolName) existing.name = ce.toolName
            if (ce.toolInput !== undefined) existing.input = ce.toolInput
            if (ce.toolResult !== undefined) existing.result = ce.toolResult
            if (ce.toolDiff) existing.diff = ce.toolDiff
          } else {
            const summary: ToolCallSummary = { name: ce.toolName ?? 'tool', input: ce.toolInput, result: ce.toolResult, diff: ce.toolDiff }
            attemptToolCalls.push(summary)
            if (ce.toolId) toolCallsById.set(ce.toolId, summary)
          }
        }
        if (ce.kind === 'usage') attemptUsage = mergeUsage(attemptUsage, ce.usage)
      },
    })
    session.record(name, result.status, result.sessionId)
    if (result.status === 'SUCCESS') clearCooldown(name)
    else recordFailure(name, result.status)

    if (result.status === 'NOT_INSTALLED') {
      onEvent(makeEvent('failure', name, 'Not installed', provider.installHint))
      continue
    }

    if (isCancelled()) {
      onEvent(makeEvent('cancelled', name, 'Cancelled.'))
      return activeProvider
    }

    if (result.status === 'SUCCESS') {
      const reply = displayOutput(result.output)
      session.addMessage('assistant', reply, name, attemptToolCalls, attemptUsage)
      onEvent(makeEvent('success', name, 'Responded.'))
      return name
    }

    const detail = result.rawStderr.trim().slice(0, 300) || '(no output)'
    onEvent(makeEvent('failure', name, result.status, detail))
    if (i + 1 < order.length) {
      onEvent(makeEvent('handoff', name, 'Falling back to the next provider...'))
    }
  }

  session.addMessage('system', '(all providers failed or are unavailable)')
  onEvent(makeEvent('exhausted', null, 'All providers exhausted or unavailable.'))
  return activeProvider
}

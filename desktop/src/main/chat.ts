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
import { displayOutput, PROVIDERS, runProvider } from './providers.ts'
import type { Session } from './session.ts'

export type EventFn = (line: string) => void

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
      onEvent('[aicli] cancelled.')
      return activeProvider
    }

    const provider = PROVIDERS[name]
    if (!provider) {
      onEvent(`[aicli] unknown provider '${name}', skipping`)
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
        onEvent(`[${name}] skipped - on cooldown (${lastFailureReason}, ${detail})`)
        continue
      }
      onEvent(`[${name}] note: on cooldown (${lastFailureReason}) but trying anyway - you selected it`)
    }

    const usedBefore = session.data.history.some((h) => h.provider === name && h.status === 'SUCCESS')
    // a provider with no resumeArgs (e.g. antigravity - it assigns its own
    // conversation id instead of accepting ours, not wired up yet) has no way
    // to actually continue natively even if it succeeded before; sending it
    // the raw follow-up text alone would be context-free nonsense, so it
    // still needs the full reconstructed prompt every time.
    const canResumeNatively = usedBefore && !!provider.resumeArgs
    const prompt = canResumeNatively ? finalText : await session.handoffPrompt(finalText)

    onEvent(`[${name}] thinking...`)
    const result = await runProvider(provider, prompt, session.data.id, {
      useResume: canResumeNatively,
      attachments: opts.attachments,
      onProcess: opts.onProcess,
    })
    session.record(name, result.status, result.sessionId)
    if (result.status === 'SUCCESS') clearCooldown(name)
    else recordFailure(name, result.status)

    if (result.status === 'NOT_INSTALLED') {
      onEvent(`[${name}] not installed. Install with: ${provider.installHint}`)
      continue
    }

    if (isCancelled()) {
      onEvent(`[${name}] cancelled.`)
      return activeProvider
    }

    if (result.status === 'SUCCESS') {
      const reply = displayOutput(result.output)
      session.addMessage('assistant', reply, name)
      onEvent(`[${name}] ${reply}`)
      return name
    }

    const detail = result.rawStderr.trim().slice(0, 300) || '(no output)'
    onEvent(`[${name}] ${result.status}. ${detail}`)
    if (i + 1 < order.length) {
      onEvent(`[aicli] ${name} unavailable, handing off to the next provider...`)
    }
  }

  session.addMessage('system', '(all providers failed or are unavailable)')
  onEvent('[aicli] all providers exhausted or unavailable.')
  return activeProvider
}

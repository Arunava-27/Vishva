/**
 * None of the 4 provider CLIs expose a real "requests/tokens remaining"
 * number - the app only learns a provider hit its usage limit reactively,
 * when a request fails and cooldown.ts's classifyFailure() recognizes the
 * error text (see providers.ts's FAILURE_PATTERNS). What we DO always know
 * once that happens is the absolute epoch-ms timestamp it should be safe to
 * retry at (ProviderStatus.cooldownUntil) - this is the single source of
 * truth "live usage limit" status is built on. Shared by ProviderPanel,
 * App.tsx's chat composer, and CooperativeView so all three render the exact
 * same "is this provider currently usable" verdict.
 */
import type { ProviderStatus } from '../types'

export interface LimitStatus {
  /** true = do not send to this provider right now. */
  blocked: boolean
  /** true = indefinite (AUTH_FAILURE) cooldown - re-login needed, not a countdown. */
  needsReauth: boolean
  /** Short human label, e.g. "Limit reached - resumes in 12m". */
  label: string
}

/** Null = not currently limited (either no cooldown was ever recorded, or
 * its window has already passed `now`). Passing `now` in rather than reading
 * Date.now() internally is what lets callers tick a single shared clock and
 * have every consumer's countdown - and its automatic "resumed" flip - stay
 * in sync off that one clock. */
export function limitStatus(p: Pick<ProviderStatus, 'cooldownUntil' | 'lastFailureReason'>, now: number): LimitStatus | null {
  if (p.cooldownUntil === null) return null
  if (p.cooldownUntil >= Number.MAX_SAFE_INTEGER) {
    return { blocked: true, needsReauth: true, label: `Needs re-login (${p.lastFailureReason})` }
  }
  if (p.cooldownUntil <= now) return null
  const mins = Math.ceil((p.cooldownUntil - now) / 60_000)
  return { blocked: true, needsReauth: false, label: `Limit reached - resumes in ${mins}m (${p.lastFailureReason})` }
}

/** True while at least one provider has a live (non-indefinite is fine too,
 * it just never counts down) cooldown worth ticking a clock for - callers
 * use this to gate a setInterval so it isn't running for nothing when every
 * provider is clear. */
export function anyLimited(providers: Pick<ProviderStatus, 'cooldownUntil'>[]): boolean {
  return providers.some((p) => p.cooldownUntil !== null)
}

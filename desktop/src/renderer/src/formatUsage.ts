import type { UsageSummary } from './types'

/** Not every provider's usage is token-shaped (copilot's is a
 * premiumRequests quota, not tokens) - this stays generic instead of always
 * saying "tokens". Returns null when there's nothing worth showing. */
export function formatUsage(usage: UsageSummary | undefined): string | null {
  if (!usage) return null
  const bits: string[] = []
  const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  if (tokens > 0) bits.push(`${tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens`)
  if (usage.costUsd) bits.push(`$${usage.costUsd.toFixed(2)}`)
  if (usage.other) {
    for (const [k, v] of Object.entries(usage.other)) bits.push(`${v} ${k}`)
  }
  return bits.length > 0 ? bits.join(' · ') : null
}

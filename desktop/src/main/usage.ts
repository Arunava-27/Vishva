/**
 * Running usage totals per provider and model - tokens, cost, request count.
 * Same flat-JSON-file pattern as settings.ts: no DB, single reader/writer
 * process. Recorded once per successful provider attempt (see chat.ts's
 * sendMessage() and cooperative.ts's runOneProvider()/runJudge()) - a
 * failed/cancelled attempt never reaches here, since it didn't actually
 * serve a response worth counting toward a cost/usage dashboard.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { UsageSummary } from './session.ts'

export interface UsageEntry {
  requestCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
  other: Record<string, number>
  lastUsedAt: string
}

// provider name -> model key -> entry. modelKey is the exact string passed
// to recordUsage(), or the sentinel 'default' when no model was selected for
// that call (the provider ran with whatever its CLI defaults to).
export type UsageData = Record<string, Record<string, UsageEntry>>

let file = path.join(os.homedir(), '.aicli', 'usage.json')

/** Test-only: point the store at a temp file instead of the real one. */
export function setUsageFile(newPath: string): void {
  file = newPath
}

function readAll(): UsageData {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
}

function writeAll(data: UsageData): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

export function getUsage(): UsageData {
  return readAll()
}

/** Always increments requestCount by 1, even when `usage` is undefined - a
 * provider that never reports token/cost data should still show "how many
 * times used". usage.diff (code-change line counts) is deliberately not
 * tracked here - it's not a usage/cost metric. */
export function recordUsage(provider: string, model: string, usage: UsageSummary | undefined): UsageData {
  const data = readAll()
  data[provider] ??= {}
  const entry: UsageEntry = data[provider][model] ?? {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    other: {},
    lastUsedAt: '',
  }
  entry.requestCount += 1
  entry.inputTokens += usage?.inputTokens ?? 0
  entry.outputTokens += usage?.outputTokens ?? 0
  entry.reasoningTokens += usage?.reasoningTokens ?? 0
  entry.costUsd += usage?.costUsd ?? 0
  if (usage?.other) {
    for (const [k, v] of Object.entries(usage.other)) entry.other[k] = (entry.other[k] ?? 0) + v
  }
  entry.lastUsedAt = new Date().toISOString()
  data[provider][model] = entry
  writeAll(data)
  return data
}

/** Clears the whole store - a dashboard "Reset" button means "clear all
 * stats"; per-entry reset wasn't requested. */
export function resetUsage(): UsageData {
  writeAll({})
  return {}
}

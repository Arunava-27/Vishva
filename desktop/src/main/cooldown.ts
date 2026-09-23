/**
 * App-wide memory of "don't bother with this provider right now" - a provider
 * that just got rate-limited (or hit a transient server error, or needs
 * re-auth) shouldn't be retried on the very next message just because
 * classifyFailure() is stateless per-call. Same flat-JSON-file pattern as
 * authState.ts, kept in its own file since the question it answers ("can I
 * attempt this provider right now") is different from authState's ("did we
 * last see it logged in").
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RunStatus } from './providers.ts'

interface CooldownEntry {
  until: number
  reason: RunStatus
}

// A concrete far-future sentinel keeps `until` always a plain number, so
// consumers never need to special-case null-as-indefinite vs null-as-inactive.
export const INDEFINITE_COOLDOWN = Number.MAX_SAFE_INTEGER

// Deliberately not every RunStatus: TIMEOUT is likely transient network noise
// unrelated to account capacity, UNKNOWN_ERROR is too broad a catch-all to
// safely blacklist on, and NOT_INSTALLED is already cheaply re-verified live
// via resolveExecutablePath() on every call - remembering it adds nothing.
const COOLDOWN_MS: Partial<Record<RunStatus, number>> = {
  RATE_LIMIT: 15 * 60_000,
  TEMPORARY_SERVER_ERROR: 2 * 60_000,
  AUTH_FAILURE: INDEFINITE_COOLDOWN,
}

let file = path.join(os.homedir(), '.aicli', 'provider-cooldowns.json')

/** Test-only: point the store at a temp file instead of the real one. */
export function setCooldownFile(newPath: string): void {
  file = newPath
}

function readAll(): Record<string, CooldownEntry> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, CooldownEntry>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(all, null, 2))
}

/** Called once per attempt right after classifyFailure() resolves. No-ops for
 * any status not in COOLDOWN_MS (SUCCESS is handled by clearCooldown instead). */
export function recordFailure(name: string, status: RunStatus): void {
  const ms = COOLDOWN_MS[status]
  if (ms === undefined) return
  const all = readAll()
  all[name] = { until: ms === INDEFINITE_COOLDOWN ? INDEFINITE_COOLDOWN : Date.now() + ms, reason: status }
  writeAll(all)
}

/** Called on SUCCESS, and anywhere authState.ts's setKnownAuthState(name, true)
 * is already called (login success, checkConnection success) - same "we now
 * have positive evidence" moments, just also clearing this store. */
export function clearCooldown(name: string): void {
  const all = readAll()
  if (name in all) {
    delete all[name]
    writeAll(all)
  }
}

export function isOnCooldown(name: string): boolean {
  const entry = readAll()[name]
  return entry !== undefined && Date.now() < entry.until
}

export function getCooldownInfo(name: string): { cooldownUntil: number | null; lastFailureReason: string | null } {
  const entry = readAll()[name]
  if (!entry) return { cooldownUntil: null, lastFailureReason: null }
  return { cooldownUntil: Date.now() < entry.until ? entry.until : null, lastFailureReason: entry.reason }
}

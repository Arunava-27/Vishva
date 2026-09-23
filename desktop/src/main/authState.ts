/**
 * Last-known login state for providers with no status/whoami command of
 * their own (copilot has none - `copilot login` re-runs full OAuth even when
 * already authenticated, it doesn't short-circuit). Not a live check - just
 * the app's own record of what it last observed: a login run completing with
 * exit 0, or a chat call actually succeeding or hitting AUTH_FAILURE. Prefer
 * checkLiveAuthStatus() (providers.ts) when a provider has a real status
 * command; this is the fallback for the ones that don't.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let file = path.join(os.homedir(), '.aicli', 'auth-state.json')

/** Test-only: point the store at a temp file instead of the real one. */
export function setAuthStateFile(newPath: string): void {
  file = newPath
}

function readAll(): Record<string, boolean> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
}

export function getKnownAuthState(name: string): boolean | null {
  const state = readAll()[name]
  return state === undefined ? null : state
}

export function setKnownAuthState(name: string, loggedIn: boolean): void {
  const all = readAll()
  all[name] = loggedIn
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(all, null, 2))
}

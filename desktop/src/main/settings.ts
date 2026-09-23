/**
 * User preferences - theme, default provider, default fallback order. Same
 * flat-JSON-file pattern as authState.ts: no DB, single reader/writer process.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  defaultProvider: string
  defaultFallbackOrder: string[]
}

const DEFAULTS: Settings = {
  theme: 'system',
  defaultProvider: 'claude',
  defaultFallbackOrder: ['claude', 'codex', 'copilot', 'antigravity'],
}

let file = path.join(os.homedir(), '.aicli', 'settings.json')

/** Test-only: point the store at a temp file instead of the real one. */
export function setSettingsFile(newPath: string): void {
  file = newPath
}

function readSaved(): Partial<Settings> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
}

export function getSettings(): Settings {
  return { ...DEFAULTS, ...readSaved() }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next, null, 2))
  return next
}

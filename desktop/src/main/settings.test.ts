import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSettings, setSettings, setSettingsFile } from './settings.ts'

test('settings: defaults when nothing saved yet', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-settings-')), 'settings.json')
  setSettingsFile(tmp)
  try {
    const s = getSettings()
    assert.equal(s.theme, 'system')
    assert.equal(s.defaultProvider, 'claude')
    assert.deepEqual(s.defaultFallbackOrder, ['claude', 'codex', 'copilot', 'antigravity'])
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  }
})

test('settings: partial patch merges over defaults and persists', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-settings-')), 'settings.json')
  setSettingsFile(tmp)
  try {
    const after = setSettings({ theme: 'dark' })
    assert.equal(after.theme, 'dark')
    assert.equal(after.defaultProvider, 'claude', 'unrelated fields keep their default')

    setSettings({ defaultFallbackOrder: ['copilot', 'claude'] })
    const reloaded = getSettings()
    assert.equal(reloaded.theme, 'dark', 'earlier patch survives a later, unrelated one')
    assert.deepEqual(reloaded.defaultFallbackOrder, ['copilot', 'claude'])

    assert.equal(JSON.parse(fs.readFileSync(tmp, 'utf-8')).theme, 'dark', 'persisted to disk, not just in-memory')
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getKnownAuthState, setAuthStateFile, setKnownAuthState } from './authState.ts'

test('authState: unknown provider is null, not false', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-auth-')), 'state.json')
  setAuthStateFile(tmp)
  try {
    assert.equal(getKnownAuthState('never-seen'), null)
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  }
})

test('authState: records and persists login/logout observations independently per provider', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-auth-')), 'state.json')
  setAuthStateFile(tmp)
  try {
    setKnownAuthState('copilot', true)
    setKnownAuthState('codex', false)
    assert.equal(getKnownAuthState('copilot'), true)
    assert.equal(getKnownAuthState('codex'), false)

    setKnownAuthState('copilot', false)
    assert.equal(getKnownAuthState('copilot'), false, 'a later observation overwrites the earlier one')

    // survives a fresh read from disk, not just an in-memory cache
    assert.equal(JSON.parse(fs.readFileSync(tmp, 'utf-8')).codex, false)
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  }
})

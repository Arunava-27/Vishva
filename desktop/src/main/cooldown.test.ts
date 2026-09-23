import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clearCooldown,
  getCooldownInfo,
  INDEFINITE_COOLDOWN,
  isOnCooldown,
  recordFailure,
  setCooldownFile,
} from './cooldown.ts'

function withTempCooldownFile(fn: () => void): void {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-cooldown-')), 'cooldowns.json')
  setCooldownFile(tmp)
  try {
    fn()
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  }
}

test('cooldown: RATE_LIMIT puts a provider on cooldown', () => {
  withTempCooldownFile(() => {
    assert.equal(isOnCooldown('codex'), false)
    recordFailure('codex', 'RATE_LIMIT')
    assert.equal(isOnCooldown('codex'), true)
    const info = getCooldownInfo('codex')
    assert.equal(info.lastFailureReason, 'RATE_LIMIT')
    assert.ok(info.cooldownUntil !== null && info.cooldownUntil > Date.now())
  })
})

test('cooldown: AUTH_FAILURE is indefinite until manually cleared', () => {
  withTempCooldownFile(() => {
    recordFailure('copilot', 'AUTH_FAILURE')
    assert.equal(isOnCooldown('copilot'), true)
    assert.equal(getCooldownInfo('copilot').cooldownUntil, INDEFINITE_COOLDOWN)
    clearCooldown('copilot')
    assert.equal(isOnCooldown('copilot'), false)
    assert.equal(getCooldownInfo('copilot').cooldownUntil, null)
  })
})

test('cooldown: a later failure overwrites/extends an earlier one', () => {
  withTempCooldownFile(() => {
    recordFailure('claude', 'TEMPORARY_SERVER_ERROR')
    const first = getCooldownInfo('claude').cooldownUntil!
    recordFailure('claude', 'RATE_LIMIT')
    const second = getCooldownInfo('claude').cooldownUntil!
    assert.ok(second > first, 'RATE_LIMIT (15m) should push the cooldown further out than TEMPORARY_SERVER_ERROR (2m)')
    assert.equal(getCooldownInfo('claude').lastFailureReason, 'RATE_LIMIT')
  })
})

test('cooldown: statuses outside the cooldown list never create an entry', () => {
  withTempCooldownFile(() => {
    for (const status of ['SUCCESS', 'TIMEOUT', 'UNKNOWN_ERROR', 'NOT_INSTALLED'] as const) {
      recordFailure('antigravity', status)
      assert.equal(isOnCooldown('antigravity'), false, `${status} should not create a cooldown`)
    }
  })
})

test('cooldown: clearing a name with no entry is a harmless no-op', () => {
  withTempCooldownFile(() => {
    clearCooldown('never-recorded')
    assert.equal(isOnCooldown('never-recorded'), false)
  })
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getUsage, recordUsage, resetUsage, setUsageFile } from './usage.ts'

function withTempUsageFile(fn: () => void): void {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-usage-')), 'usage.json')
  setUsageFile(tmp)
  try {
    fn()
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  }
}

test('usage: starts empty', () => {
  withTempUsageFile(() => {
    assert.deepEqual(getUsage(), {})
  })
})

test('usage: recordUsage creates a provider/model entry and persists it', () => {
  withTempUsageFile(() => {
    recordUsage('claude', 'sonnet', { inputTokens: 100, outputTokens: 50, costUsd: 0.02 })
    const usage = getUsage()
    assert.equal(usage.claude.sonnet.requestCount, 1)
    assert.equal(usage.claude.sonnet.inputTokens, 100)
    assert.equal(usage.claude.sonnet.outputTokens, 50)
    assert.equal(usage.claude.sonnet.costUsd, 0.02)
    assert.ok(usage.claude.sonnet.lastUsedAt)
  })
})

test('usage: multiple calls to the same provider+model sum, not overwrite', () => {
  withTempUsageFile(() => {
    recordUsage('claude', 'sonnet', { inputTokens: 100, outputTokens: 50 })
    recordUsage('claude', 'sonnet', { inputTokens: 30, outputTokens: 10 })
    const usage = getUsage()
    assert.equal(usage.claude.sonnet.requestCount, 2)
    assert.equal(usage.claude.sonnet.inputTokens, 130)
    assert.equal(usage.claude.sonnet.outputTokens, 60)
  })
})

test('usage: different models of the same provider get separate entries', () => {
  withTempUsageFile(() => {
    recordUsage('claude', 'sonnet', { inputTokens: 100 })
    recordUsage('claude', 'opus', { inputTokens: 200 })
    const usage = getUsage()
    assert.equal(usage.claude.sonnet.inputTokens, 100)
    assert.equal(usage.claude.opus.inputTokens, 200)
  })
})

test('usage: different providers never share entries', () => {
  withTempUsageFile(() => {
    recordUsage('claude', 'default', { inputTokens: 10 })
    recordUsage('codex', 'default', { inputTokens: 20 })
    const usage = getUsage()
    assert.equal(usage.claude.default.inputTokens, 10)
    assert.equal(usage.codex.default.inputTokens, 20)
  })
})

test('usage: requestCount increments even when usage is undefined', () => {
  withTempUsageFile(() => {
    recordUsage('antigravity', 'default', undefined)
    recordUsage('antigravity', 'default', undefined)
    const usage = getUsage()
    assert.equal(usage.antigravity.default.requestCount, 2)
    assert.equal(usage.antigravity.default.inputTokens, 0)
  })
})

test('usage: other key/value pairs merge additively', () => {
  withTempUsageFile(() => {
    recordUsage('copilot', 'default', { other: { premiumRequests: 1 } })
    recordUsage('copilot', 'default', { other: { premiumRequests: 2 } })
    const usage = getUsage()
    assert.equal(usage.copilot.default.other.premiumRequests, 3)
  })
})

test('usage: reasoningTokens and costUsd accumulate independently', () => {
  withTempUsageFile(() => {
    recordUsage('codex', 'gpt-5', { reasoningTokens: 500, costUsd: 0.1 })
    recordUsage('codex', 'gpt-5', { reasoningTokens: 250, costUsd: 0.05 })
    const usage = getUsage()
    assert.equal(usage.codex['gpt-5'].reasoningTokens, 750)
    assert.equal(usage.codex['gpt-5'].costUsd.toFixed(2), '0.15')
  })
})

test('usage: resetUsage clears everything', () => {
  withTempUsageFile(() => {
    recordUsage('claude', 'sonnet', { inputTokens: 100 })
    recordUsage('codex', 'default', { inputTokens: 50 })
    assert.notDeepEqual(getUsage(), {})
    resetUsage()
    assert.deepEqual(getUsage(), {})
  })
})

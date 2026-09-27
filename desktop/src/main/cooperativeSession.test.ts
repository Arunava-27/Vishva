import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CooperativeSession, setCooperativeSessionsDir, type CooperativeTurn } from './cooperativeSession.ts'

function withTempDir(fn: () => void): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-sessions-'))
  setCooperativeSessionsDir(tmp)
  try {
    fn()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function sampleTurn(prompt: string): CooperativeTurn {
  return {
    prompt,
    timestamp: new Date().toISOString(),
    providerResults: [
      {
        provider: 'claude',
        status: 'SUCCESS',
        reply: 'did the thing',
        diffStat: '1 file changed',
        diffPatch: '+ hello',
        changedFiles: ['a.txt'],
        rawStderr: '',
      },
    ],
    judge: { provider: 'claude', status: 'SUCCESS', reply: 'best answer' },
  }
}

test('cooperativeSession: create/save/load round-trips all fields', () => {
  withTempDir(() => {
    const s = CooperativeSession.create('My task', 'D:/proj', null, ['claude', 'codex'], 'claude')
    s.save()
    const loaded = CooperativeSession.load(s.data.id)
    assert.equal(loaded.data.task, 'My task')
    assert.equal(loaded.data.cwd, 'D:/proj')
    assert.deepEqual(loaded.data.participants, ['claude', 'codex'])
    assert.equal(loaded.data.judgeProvider, 'claude')
    assert.deepEqual(loaded.data.turns, [])
    assert.equal(loaded.data.status, 'active')
  })
})

test('cooperativeSession: addTurn appends and persists', () => {
  withTempDir(() => {
    const s = CooperativeSession.create('Task', '.', null, ['claude'], 'claude')
    s.save()
    s.addTurn(sampleTurn('do X'))
    const loaded = CooperativeSession.load(s.data.id)
    assert.equal(loaded.data.turns.length, 1)
    assert.equal(loaded.data.turns[0].prompt, 'do X')
    assert.equal(loaded.data.turns[0].judge?.reply, 'best answer')
    assert.equal(loaded.data.turns[0].providerResults[0].provider, 'claude')
  })
})

test('cooperativeSession: listAll returns every saved session, most recent turn first', () => {
  withTempDir(() => {
    const a = CooperativeSession.create('A', '.', null, [], 'claude')
    a.save()
    a.addTurn({ ...sampleTurn('first'), timestamp: new Date(Date.now() - 10_000).toISOString() })
    const b = CooperativeSession.create('B', '.', null, [], 'claude')
    b.save()
    b.addTurn({ ...sampleTurn('second'), timestamp: new Date().toISOString() })

    const all = CooperativeSession.listAll()
    assert.equal(all.length, 2)
    assert.equal(all[0].data.id, b.data.id)
  })
})

test('cooperativeSession: rename updates task and persists', () => {
  withTempDir(() => {
    const s = CooperativeSession.create('Old name', '.', null, [], 'claude')
    s.save()
    const updated = CooperativeSession.rename(s.data.id, 'New name')
    assert.equal(updated.task, 'New name')
    assert.equal(CooperativeSession.load(s.data.id).data.task, 'New name')
  })
})

test('cooperativeSession: delete removes it from listAll', () => {
  withTempDir(() => {
    const s = CooperativeSession.create('Doomed', '.', null, [], 'claude')
    s.save()
    assert.equal(CooperativeSession.listAll().length, 1)
    CooperativeSession.delete(s.data.id)
    assert.equal(CooperativeSession.listAll().length, 0)
  })
})

test('cooperativeSession: judge: null and judgeError are preserved through round-trip', () => {
  withTempDir(() => {
    const s = CooperativeSession.create('Task', '.', null, ['claude'], 'claude')
    s.save()
    s.addTurn({
      prompt: 'do Y',
      timestamp: new Date().toISOString(),
      providerResults: [],
      judge: null,
      judgeError: 'All providers failed or were unavailable.',
    })
    const loaded = CooperativeSession.load(s.data.id)
    assert.equal(loaded.data.turns[0].judge, null)
    assert.equal(loaded.data.turns[0].judgeError, 'All providers failed or were unavailable.')
  })
})

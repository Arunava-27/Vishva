import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sendMessage } from './chat.ts'
import { PROVIDERS, type Provider } from './providers.ts'
import { Session, setSessionsDir } from './session.ts'

function withTempSessions<T>(fn: () => Promise<T>): () => Promise<T> {
  return async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-test-'))
    setSessionsDir(tmp)
    try {
      return await fn()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
}

const NODE = process.execPath

test(
  'send_message: native resume on same provider, handoff-free fallback and back',
  withTempSessions(async () => {
    // echoes a tag showing which arg template (fresh vs resumed) ran, plus
    // the exact prompt text received.
    const chatty: Provider = {
      name: 'chatty',
      binary: NODE,
      installHint: 'n/a',
      printArgs: ['-e', "process.stdout.write('FRESH:' + process.argv[1])", '{prompt}'],
      resumeArgs: ['-e', "process.stdout.write('RESUMED:' + process.argv[1])", '{prompt}'],
      verified: true,
    }
    const failing: Provider = {
      name: 'failing',
      binary: NODE,
      installHint: 'n/a',
      printArgs: ['-e', 'process.exit(1)'],
      verified: true,
    }
    PROVIDERS.chatty = chatty
    PROVIDERS.failing = failing
    try {
      const session = Session.create('chat', '.')

      // turn 1: brand new provider -> fresh call, native session id established
      let answered = await sendMessage(session, 'chatty', ['chatty'], 'hello')
      assert.equal(answered, 'chatty')
      assert.equal(session.data.messages.at(-1)!.text, 'FRESH:hello')

      // turn 2: same provider again -> native resume, raw message only
      answered = await sendMessage(session, 'chatty', ['chatty'], 'follow up')
      assert.equal(answered, 'chatty')
      assert.equal(session.data.messages.at(-1)!.text, 'RESUMED:follow up')

      // turn 3: active provider fails -> falls back to chatty, which already
      // succeeded earlier in this session -> resumes natively again
      answered = await sendMessage(session, 'failing', ['failing', 'chatty'], 'another message')
      assert.equal(answered, 'chatty')
      assert.equal(session.data.messages.at(-1)!.text, 'RESUMED:another message')

      assert.equal(session.data.messages.length, 6)
    } finally {
      delete PROVIDERS.chatty
      delete PROVIDERS.failing
    }
  }),
)

test(
  'send_message: a provider with no resumeArgs never gets the bare follow-up text, even after succeeding before',
  withTempSessions(async () => {
    // echoes back exactly the prompt text it received, so the test can see
    // whether it was raw follow-up text or a reconstructed handoff prompt.
    const noResume: Provider = {
      name: 'no_resume',
      binary: NODE,
      installHint: 'n/a',
      printArgs: ['-e', "process.stdout.write(process.argv[1])", '{prompt}'],
      // deliberately no resumeArgs - mirrors antigravity, which assigns its
      // own conversation id instead of accepting ours.
      verified: true,
    }
    PROVIDERS.no_resume = noResume
    try {
      const session = Session.create('chat', '.')

      await sendMessage(session, 'no_resume', ['no_resume'], 'hello')
      const turn2 = await sendMessage(session, 'no_resume', ['no_resume'], 'follow up')

      assert.equal(turn2, 'no_resume')
      const lastReply = session.data.messages.at(-1)!.text
      assert.notEqual(lastReply.trim(), 'follow up', 'must not be the bare follow-up text')
      assert.ok(lastReply.includes('follow up'), 'the follow-up text should still appear inside the reconstruction')
      assert.ok(lastReply.includes('Recent conversation'), 'should be a handoff-style reconstructed prompt')
    } finally {
      delete PROVIDERS.no_resume
    }
  }),
)

test(
  'send_message: cancelling mid-turn stops before the next provider runs',
  withTempSessions(async () => {
    let cancelled = false
    const markerPath = path.join(os.tmpdir(), `aicli-test-marker-${Date.now()}`)

    const first: Provider = {
      name: 'first',
      binary: NODE,
      installHint: 'n/a',
      printArgs: ['-e', "process.stdout.write('partial output')"],
      verified: true,
    }
    const neverRun: Provider = {
      name: 'never_run',
      binary: NODE,
      installHint: 'n/a',
      printArgs: ['-e', `require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'x')`],
      verified: true,
    }
    PROVIDERS.first = first
    PROVIDERS.never_run = neverRun
    try {
      const session = Session.create('chat', '.')
      const answered = await sendMessage(session, 'first', ['first', 'never_run'], 'demo', {
        onProcess: () => {
          cancelled = true
        },
        isCancelled: () => cancelled,
      })
      assert.equal(answered, 'first')
      assert.deepEqual(
        session.data.history.map((h) => h.provider),
        ['first'],
      )
      assert.ok(!fs.existsSync(markerPath))
    } finally {
      delete PROVIDERS.first
      delete PROVIDERS.never_run
      fs.rmSync(markerPath, { force: true })
    }
  }),
)

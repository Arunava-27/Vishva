import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyFailure, buildArgs, displayOutput, runProvider, type Provider } from './providers.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test('classifyFailure', () => {
  assert.equal(classifyFailure(0, 'all good'), 'SUCCESS')
  assert.equal(classifyFailure(1, 'Error: rate limit exceeded, try again later'), 'RATE_LIMIT')
  assert.equal(classifyFailure(1, 'Usage quota exhausted for this billing period'), 'RATE_LIMIT')
  assert.equal(classifyFailure(1, 'Error: not logged in. Run `claude login`.'), 'AUTH_FAILURE')
  assert.equal(classifyFailure(1, 'invalid api key'), 'AUTH_FAILURE')
  assert.equal(classifyFailure(1, '503 Service Unavailable'), 'TEMPORARY_SERVER_ERROR')
  assert.equal(classifyFailure(1, 'request timed out'), 'TIMEOUT')
  assert.equal(classifyFailure(1, 'some totally novel crash nobody has seen'), 'UNKNOWN_ERROR')
})

test('buildArgs - no attachments leaves args unchanged', () => {
  const args = buildArgs(['-p', '{prompt}', '--session-id', '{session_id}'], 'hello', 'sid-1')
  assert.deepEqual(args, ['-p', 'hello', '--session-id', 'sid-1'])
})

test('buildArgs - claude-style: add-dir only, no attachment flag', () => {
  const here = __filename
  const args = buildArgs(['-p', '{prompt}'], 'hello', 'sid-1', [here], undefined, '--add-dir')
  assert.ok(!args.includes('--attachment'))
  assert.deepEqual(args.slice(-2), ['--add-dir', path.dirname(here)])
})

test('buildArgs - copilot-style: native attachment flag plus add-dir', () => {
  const here = __filename
  const args = buildArgs(['-p', '{prompt}'], 'hello', 'sid-1', [here], '--attachment', '--add-dir')
  assert.ok(args.includes('--attachment') && args.includes(here))
  assert.ok(args.includes('--add-dir'))
})

test('buildArgs - one attachment/add-dir pair per file', () => {
  const files = [__filename, path.join(__dirname, 'session.ts')]
  const args = buildArgs(['-p', '{prompt}'], 'hello', 'sid-1', files, '--attachment', '--add-dir')
  assert.equal(args.filter((a) => a === '--attachment').length, 2)
})

test('displayOutput - claude/copilot use "result"', () => {
  assert.equal(displayOutput(JSON.stringify({ result: 'the answer' })), 'the answer')
})

test('displayOutput - agy uses "response" instead (confirmed live, not just docs)', () => {
  assert.equal(displayOutput(JSON.stringify({ conversation_id: 'x', status: 'SUCCESS', response: 'agy works' })), 'agy works')
})

test('displayOutput - non-JSON or unrecognized shape falls back to the raw output', () => {
  assert.equal(displayOutput('plain text reply'), 'plain text reply')
  assert.equal(displayOutput(JSON.stringify({ something: 'else' })), JSON.stringify({ something: 'else' }))
})

test('runProvider: outputFileFlag reads the clean reply from the file, not noisy stdout (codex-style)', async () => {
  // simulates codex: prints a noisy transcript to stdout, but the *reply* used
  // is whatever got written to the file path appended via outputFileFlag.
  const provider: Provider = {
    name: 'noisy',
    binary: process.execPath,
    installHint: 'n/a',
    // argv layout after run() appends [outputFileFlag, path]: [1]=prompt,
    // [2]=the flag string itself (unused, just a marker), [3]=the real path.
    printArgs: [
      '-e',
      "process.stdout.write('noisy banner\\nuser\\n' + process.argv[1] + '\\nnoisy\\n'); " +
        "require('fs').writeFileSync(process.argv[3], 'clean:' + process.argv[1])",
      '{prompt}',
    ],
    outputFileFlag: '--not-a-real-flag-just-a-marker',
    verified: true,
  }
  const result = await runProvider(provider, 'hello', 'sid-1')
  assert.equal(result.status, 'SUCCESS')
  assert.equal(result.output, 'clean:hello', 'should be the file content, not the noisy stdout')
})

test('runProvider: outputFileFlag falls back to stdout if the file was never written', async () => {
  const provider: Provider = {
    name: 'crashes_before_writing',
    binary: process.execPath,
    installHint: 'n/a',
    // {prompt} must come first, same as any real provider's printArgs - a
    // bare "-e script --some-flag" with no leading positional arg makes
    // node's *own* CLI parser choke on "--some-flag" as an unrecognized node
    // option (confirmed while writing this test), unrelated to run() itself.
    // process.exitCode (not process.exit()) so the stdout write actually
    // flushes before exit - process.exit() can truncate pending writes, a
    // real documented Node gotcha.
    printArgs: ['-e', "process.stdout.write('partial output'); process.exitCode = 1", '{prompt}'],
    outputFileFlag: '--not-a-real-flag-just-a-marker',
    verified: true,
  }
  const result = await runProvider(provider, 'hello', 'sid-1')
  assert.equal(result.status, 'UNKNOWN_ERROR')
  assert.equal(result.output, 'partial output')
})

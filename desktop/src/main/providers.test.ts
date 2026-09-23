import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildMcpInvocationArgs,
  classifyFailure,
  buildArgs,
  codexMcpArgs,
  displayOutput,
  runProvider,
  PROVIDERS,
  type Provider,
  type ProviderStreamEvent,
} from './providers.ts'
import type { McpServerConfig } from './mcpServers.ts'

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

test('buildArgs - cwd grants --add-dir even with zero attachments (project folder access bug)', () => {
  const args = buildArgs(['-p', '{prompt}'], 'hello', 'sid-1', [], null, '--add-dir', 'D:\\some\\project')
  assert.deepEqual(args, ['-p', 'hello', '--add-dir', 'D:\\some\\project'])
})

test('buildArgs - cwd is a no-op when the provider has no addDirFlag', () => {
  const args = buildArgs(['-p', '{prompt}'], 'hello', 'sid-1', [], null, null, 'D:\\some\\project')
  assert.deepEqual(args, ['-p', 'hello'])
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

test('runProvider: opts.cwd actually sets the spawned process working directory (previously never set at all)', async () => {
  const provider: Provider = {
    name: 'cwd-check',
    binary: process.execPath,
    installHint: 'n/a',
    printArgs: ['-e', 'process.stdout.write(process.cwd())', '{prompt}'],
    verified: true,
  }
  const targetDir = fs.realpathSync(os.tmpdir())
  const result = await runProvider(provider, 'hello', 'sid-1', { cwd: targetDir })
  assert.equal(result.output, targetDir)
})

function mcpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'x',
    name: 'fs',
    scope: 'global',
    projectId: null,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'server'],
    env: {},
    url: '',
    ...overrides,
  }
}

test('buildMcpInvocationArgs: no servers is a no-op', () => {
  const { args, cleanup } = buildMcpInvocationArgs({ mcpConfigFlag: '--mcp-config' } as Provider, [])
  assert.deepEqual(args, [])
  cleanup() // should not throw with nothing to clean up
})

test('buildMcpInvocationArgs: file-based flag writes a temp JSON config and cleans it up', () => {
  const { args, cleanup } = buildMcpInvocationArgs({ mcpConfigFlag: '--mcp-config' } as Provider, [
    mcpServer({ name: 'fs' }),
    mcpServer({ name: 'remote', transport: 'http', url: 'https://example.com/mcp' }),
  ])
  assert.equal(args[0], '--mcp-config')
  const tmpPath = args[1]
  const written = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'))
  assert.deepEqual(written.mcpServers.fs, { command: 'npx', args: ['-y', 'server'], env: {} })
  assert.deepEqual(written.mcpServers.remote, { type: 'http', url: 'https://example.com/mcp' })
  cleanup()
  assert.equal(fs.existsSync(tmpPath), false)
})

test('codexMcpArgs: builds repeatable dotted -c overrides, skips http servers', () => {
  const args = codexMcpArgs([
    mcpServer({ name: 'fs', command: 'npx', args: ['-y', 'server'], env: { KEY: 'v' } }),
    mcpServer({ name: 'remote', transport: 'http' }),
  ])
  assert.deepEqual(args, [
    '-c', 'mcp_servers.fs.command="npx"',
    '-c', 'mcp_servers.fs.args=["-y","server"]',
    '-c', 'mcp_servers.fs.env.KEY="v"',
  ])
})

test('buildMcpInvocationArgs: codex-style arg-builder is used instead of a file', () => {
  const provider = { mcpServerArgsFn: codexMcpArgs } as Provider
  const { args } = buildMcpInvocationArgs(provider, [mcpServer({ name: 'fs' })])
  assert.deepEqual(args, ['-c', 'mcp_servers.fs.command="npx"', '-c', 'mcp_servers.fs.args=["-y","server"]'])
})

test('buildMcpInvocationArgs: a provider with neither mechanism (antigravity) is a no-op', () => {
  const { args } = buildMcpInvocationArgs({} as Provider, [mcpServer()])
  assert.deepEqual(args, [])
})

// Fixtures below are the exact shapes captured against the real, installed,
// authenticated binaries (see the Phase 3 plan) - not guessed from docs.

test('parseStreamLine (claude): tool_use block, per-message usage, final result reply+cost', () => {
  const parse = PROVIDERS.claude.parseStreamLine!
  const toolEvents = parse({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }], usage: { input_tokens: 2, output_tokens: 3 } },
  })
  assert.deepEqual(toolEvents[0], { type: 'tool', id: 't1', name: 'Read', input: { file_path: 'a.ts' } })
  assert.deepEqual(toolEvents[1], { type: 'usage', tokens: { input: 2, output: 3 } })

  const finalEvents = parse({ type: 'result', result: 'Hi', total_cost_usd: 0.05, usage: { input_tokens: 2, output_tokens: 5 } })
  assert.deepEqual(finalEvents[0], { type: 'reply', text: 'Hi' })
  assert.deepEqual(finalEvents[1], { type: 'usage', tokens: { input: 2, output: 5 }, costUsd: 0.05 })
})

test('parseStreamLine (codex): command_execution tool, agent_message reply, turn.completed usage', () => {
  const parse = PROVIDERS.codex.parseStreamLine!
  const toolEvents = parse({ type: 'item.completed', item: { type: 'command_execution', command: 'ls', aggregated_output: 'a.ts\n', exit_code: 0 } })
  assert.deepEqual(toolEvents, [{ type: 'tool', name: 'shell', input: 'ls', result: 'a.ts\n' }])

  const replyEvents = parse({ type: 'item.completed', item: { type: 'agent_message', text: 'The answer is 4.' } })
  assert.deepEqual(replyEvents, [{ type: 'reply', text: 'The answer is 4.' }])

  const usageEvents = parse({ type: 'turn.completed', usage: { input_tokens: 42, output_tokens: 10, reasoning_output_tokens: 2 } })
  assert.deepEqual(usageEvents, [{ type: 'usage', tokens: { input: 42, output: 10, reasoning: 2 } }])

  assert.deepEqual(parse({ type: 'item.started', item: { type: 'command_execution' } }), [], 'only item.completed is consumed')
})

test('parseStreamLine (copilot): execution_start/complete tool events, assistant.message reply (not delta), diff stats', () => {
  const parse = PROVIDERS.copilot.parseStreamLine!
  assert.deepEqual(parse({ type: 'tool.execution_start', data: { toolCallId: 'x1', toolName: 'glob', arguments: { pattern: '*.ts' } } }), [
    { type: 'tool', id: 'x1', name: 'glob', input: { pattern: '*.ts' }, result: undefined },
  ])
  assert.deepEqual(parse({ type: 'assistant.message_delta', data: { content: 'partial' } }), [], 'deltas are not the reply')
  assert.deepEqual(parse({ type: 'assistant.message', data: { content: 'Hello' } }), [{ type: 'reply', text: 'Hello' }])
  assert.deepEqual(
    parse({ type: 'result', usage: { premiumRequests: 1, codeChanges: { linesAdded: 12, linesRemoved: 3, filesModified: ['a.ts'] } } }),
    [{ type: 'usage', other: { premiumRequests: 1 }, diff: { added: 12, removed: 3 } }],
  )
})

test('parseStreamLine (antigravity): step_update tool event only fires on state DONE (ACTIVE is the same tool call, would double-count), result event reply+usage (event-keyed, not type-keyed)', () => {
  const parse = PROVIDERS.antigravity.parseStreamLine!
  const toolInfo = { step_type: 'tool', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'ls' } } }
  assert.deepEqual(parse({ event: 'step_update', step_update: { ...toolInfo, state: 'ACTIVE' } }), [], 'ACTIVE is not recorded - DONE repeats the same call')
  assert.deepEqual(
    parse({ event: 'step_update', step_update: { ...toolInfo, state: 'DONE' } }),
    [{ type: 'tool', name: 'run_command', input: { CommandLine: 'ls' } }],
  )
  assert.deepEqual(
    parse({ event: 'result', result: { status: 'SUCCESS', response: 'done', usage: { input_tokens: 9, output_tokens: 1 } } }),
    [{ type: 'reply', text: 'done' }, { type: 'usage', tokens: { input: 9, output: 1 } }],
  )
})

test('runProvider: streaming NDJSON tool/usage events forward via onStreamEvent, reply text wins over raw stdout, partial line split across chunks still parses', async () => {
  const events: ProviderStreamEvent[] = []
  const provider: Provider = {
    name: 'streaming-fake',
    binary: process.execPath,
    installHint: 'n/a',
    // writes one line, then the START of a second line, then (after a tick,
    // forcing a separate 'data' event) the REST of that line plus a final
    // line - exercises the partial-line buffering path for real.
    printArgs: [
      '-e',
      "process.stdout.write(JSON.stringify({type:'tool',name:'Read'})+'\\n'+JSON.stringify({type:'noise'}).slice(0,10));" +
        "setTimeout(()=>{process.stdout.write(JSON.stringify({type:'noise'}).slice(10)+'\\n'+JSON.stringify({type:'result',text:'{prompt}'})+'\\n')},10)",
    ],
    verified: true,
    parseStreamLine: (line) => {
      if (line.type === 'tool') return [{ type: 'tool', name: String(line.name) }]
      if (line.type === 'result') return [{ type: 'reply', text: String(line.text) }]
      return []
    },
  }
  const result = await runProvider(provider, 'hello', 'sid-1', { onStreamEvent: (e) => events.push(e) })
  assert.equal(result.status, 'SUCCESS')
  assert.equal(result.output, 'hello', 'reply text extracted from the stream, not the raw NDJSON blob')
  assert.deepEqual(events, [{ type: 'tool', name: 'Read' }])
})

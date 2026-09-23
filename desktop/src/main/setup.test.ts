import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runStreamingCommand } from './setup.ts'

const NODE = process.execPath

test('runStreamingCommand: streams output as it arrives and reports exit code', async () => {
  const chunks: string[] = []
  const { code } = await runStreamingCommand(
    { cmd: NODE, args: ['-e', "process.stdout.write('line1\\n'); process.stdout.write('line2\\n')"] },
    { onOutput: (c) => chunks.push(c) },
  )
  assert.equal(code, 0)
  assert.ok(chunks.join('').includes('line1'))
  assert.ok(chunks.join('').includes('line2'))
})

test('runStreamingCommand: non-zero exit is reported, not thrown', async () => {
  const { code } = await runStreamingCommand({ cmd: NODE, args: ['-e', 'process.exit(3)'] }, { onOutput: () => {} })
  assert.equal(code, 3)
})

test('runStreamingCommand: onProcess handle can kill the running process', async () => {
  const chunks: string[] = []
  const { code } = await runStreamingCommand(
    { cmd: NODE, args: ['-e', "setTimeout(() => process.stdout.write('should not print'), 5000)"] },
    {
      onOutput: (c) => chunks.push(c),
      onProcess: (proc) => proc.kill(),
    },
  )
  assert.notEqual(code, 0)
  assert.ok(!chunks.join('').includes('should not print'))
})

test('runStreamingCommand: unknown binary resolves instead of throwing', async () => {
  const { code } = await runStreamingCommand(
    { cmd: 'this-binary-does-not-exist-xyz', args: [] },
    { onOutput: () => {} },
  )
  assert.equal(code, null)
})

test('runStreamingCommand: real npm.cmd install actually runs (regression - spawn cannot exec .cmd files by name)', async () => {
  const chunks: string[] = []
  const { code } = await runStreamingCommand({ cmd: 'npm', args: ['--version'] }, { onOutput: (c) => chunks.push(c) })
  assert.equal(code, 0)
  assert.ok(/^\d+\.\d+\.\d+/.test(chunks.join('').trim()), chunks.join(''))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { activeMcpServers, addMcpServer, listMcpServers, removeMcpServer, setMcpServersFile, updateMcpServer } from './mcpServers.ts'

function withTempFile(fn: () => void): void {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-mcp-')), 'mcp-servers.json')
  setMcpServersFile(tmp)
  try {
    fn()
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
  }
}

test('mcpServers: starts empty, add persists', () => {
  withTempFile(() => {
    assert.deepEqual(listMcpServers(), [])
    const s = addMcpServer({
      name: 'fs',
      scope: 'global',
      projectId: null,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: {},
      url: '',
    })
    assert.equal(listMcpServers().length, 1)
    assert.equal(listMcpServers()[0].id, s.id)
  })
})

test('mcpServers: update patches fields, remove deletes', () => {
  withTempFile(() => {
    const s = addMcpServer({ name: 'a', scope: 'global', projectId: null, transport: 'stdio', command: 'cmd', args: [], env: {}, url: '' })
    updateMcpServer(s.id, { name: 'renamed' })
    assert.equal(listMcpServers()[0].name, 'renamed')
    removeMcpServer(s.id)
    assert.equal(listMcpServers().length, 0)
  })
})

test('mcpServers: activeMcpServers returns global + the given project only', () => {
  withTempFile(() => {
    addMcpServer({ name: 'global-one', scope: 'global', projectId: null, transport: 'stdio', command: 'a', args: [], env: {}, url: '' })
    addMcpServer({ name: 'proj-a', scope: 'project', projectId: 'p1', transport: 'stdio', command: 'b', args: [], env: {}, url: '' })
    addMcpServer({ name: 'proj-b', scope: 'project', projectId: 'p2', transport: 'stdio', command: 'c', args: [], env: {}, url: '' })

    const forP1 = activeMcpServers('p1').map((s) => s.name).sort()
    assert.deepEqual(forP1, ['global-one', 'proj-a'])

    const forNoProject = activeMcpServers(null).map((s) => s.name)
    assert.deepEqual(forNoProject, ['global-one'])
  })
})

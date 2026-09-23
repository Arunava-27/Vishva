/**
 * User-configured MCP servers - a small flat list (same pattern as
 * settings.ts, not project.ts's one-file-per-record store, since this list
 * is always small). aicli itself never speaks the MCP protocol; it only
 * keeps this list and hands the active subset to providers.ts, which
 * materializes it into whatever format+flag each CLI actually accepts.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type McpTransport = 'stdio' | 'http'

export interface McpServerConfig {
  id: string
  name: string
  scope: 'global' | 'project'
  projectId: string | null
  transport: McpTransport
  command: string
  args: string[]
  env: Record<string, string>
  url: string
}

interface McpServersFile {
  servers: McpServerConfig[]
}

let file = path.join(os.homedir(), '.aicli', 'mcp-servers.json')

/** Test-only: point the store at a temp file instead of the real one. */
export function setMcpServersFile(newPath: string): void {
  file = newPath
}

function readAll(): McpServersFile {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return { servers: [] }
  }
}

function writeAll(data: McpServersFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

export function listMcpServers(): McpServerConfig[] {
  return readAll().servers
}

export function addMcpServer(input: Omit<McpServerConfig, 'id'>): McpServerConfig {
  const data = readAll()
  const server: McpServerConfig = { id: randomUUID(), ...input }
  data.servers.push(server)
  writeAll(data)
  return server
}

export function updateMcpServer(id: string, patch: Partial<Omit<McpServerConfig, 'id'>>): McpServerConfig {
  const data = readAll()
  const server = data.servers.find((s) => s.id === id)
  if (!server) throw new Error(`no such MCP server: ${id}`)
  Object.assign(server, patch)
  writeAll(data)
  return server
}

export function removeMcpServer(id: string): void {
  const data = readAll()
  data.servers = data.servers.filter((s) => s.id !== id)
  writeAll(data)
}

/** global servers + this project's own - the active set for a given chat. */
export function activeMcpServers(projectId: string | null): McpServerConfig[] {
  return listMcpServers().filter((s) => s.scope === 'global' || s.projectId === projectId)
}

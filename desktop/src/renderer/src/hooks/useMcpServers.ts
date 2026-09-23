import { useState } from 'react'
import type { McpServerConfig } from '../types'

export function useMcpServers() {
  const [servers, setServers] = useState<McpServerConfig[]>([])

  const refreshMcpServers = () => window.aicli.listMcpServers().then(setServers)

  async function addMcpServer(input: Omit<McpServerConfig, 'id'>) {
    await window.aicli.addMcpServer(input)
    refreshMcpServers()
  }

  async function updateMcpServer(id: string, patch: Partial<Omit<McpServerConfig, 'id'>>) {
    await window.aicli.updateMcpServer(id, patch)
    refreshMcpServers()
  }

  async function removeMcpServer(id: string) {
    await window.aicli.removeMcpServer(id)
    refreshMcpServers()
  }

  return { servers, refreshMcpServers, addMcpServer, updateMcpServer, removeMcpServer }
}

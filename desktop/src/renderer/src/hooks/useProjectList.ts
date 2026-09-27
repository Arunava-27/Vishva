import { useState } from 'react'
import type { ProjectData } from '../types'

export function useProjectList() {
  const [projects, setProjects] = useState<ProjectData[]>([])

  const refreshProjects = () => {
    if (!window.aicli) return
    window.aicli.listProjects().then(setProjects)
  }

  async function createProject(name: string, instructions: string, cwd: string): Promise<ProjectData> {
    if (!window.aicli) throw new Error('API not available')
    const p = await window.aicli.createProject(name, instructions, cwd)
    refreshProjects()
    return p
  }

  async function updateProject(id: string, patch: Partial<Pick<ProjectData, 'name' | 'instructions' | 'cwd'>>) {
    if (!window.aicli) return
    await window.aicli.updateProject(id, patch)
    refreshProjects()
  }

  async function deleteProject(id: string) {
    if (!window.aicli) return
    await window.aicli.deleteProject(id)
    refreshProjects()
  }

  return { projects, refreshProjects, createProject, updateProject, deleteProject }
}

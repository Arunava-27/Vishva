import { useState } from 'react'
import type { SkillData } from '../types'

export function useSkillList() {
  const [skills, setSkills] = useState<SkillData[]>([])

  const refreshSkills = () => window.aicli.listSkills().then(setSkills)

  async function createSkill(
    name: string,
    description: string,
    body: string,
    scope: 'global' | 'project',
    projectId: string | null,
  ): Promise<SkillData> {
    const s = await window.aicli.createSkill(name, description, body, scope, projectId)
    refreshSkills()
    return s
  }

  async function updateSkill(
    id: string,
    patch: Partial<Pick<SkillData, 'name' | 'description' | 'body' | 'scope' | 'projectId'>>,
  ) {
    await window.aicli.updateSkill(id, patch)
    refreshSkills()
  }

  async function deleteSkill(id: string) {
    await window.aicli.deleteSkill(id)
    refreshSkills()
  }

  return { skills, refreshSkills, createSkill, updateSkill, deleteSkill }
}

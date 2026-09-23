import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SkillData } from './skill.ts'
import { setSkillHomeDir, syncAllSkills, syncSkill, unsyncSkill } from './skillSync.ts'

function makeSkill(overrides: Partial<SkillData> = {}): SkillData {
  return {
    id: 'sid-1',
    slug: 'my-skill',
    name: 'My Skill',
    description: 'a test skill',
    body: 'do the thing',
    scope: 'global',
    projectId: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

test('skillSync: global scope writes SKILL.md under both claude and agents skill dirs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-home-'))
  setSkillHomeDir(home)
  try {
    syncSkill(makeSkill(), null)
    const claudeMd = fs.readFileSync(path.join(home, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'utf-8')
    const agentsMd = fs.readFileSync(path.join(home, '.agents', 'skills', 'my-skill', 'SKILL.md'), 'utf-8')
    assert.match(claudeMd, /description: a test skill/)
    assert.match(claudeMd, /do the thing/)
    assert.equal(claudeMd, agentsMd)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('skillSync: project scope writes under the given cwd, unsync removes it', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-project-'))
  try {
    const skill = makeSkill({ scope: 'project', projectId: 'p1' })
    syncSkill(skill, cwd)
    assert.ok(fs.existsSync(path.join(cwd, '.claude', 'skills', 'my-skill', 'SKILL.md')))
    unsyncSkill(skill, cwd)
    assert.ok(!fs.existsSync(path.join(cwd, '.claude', 'skills', 'my-skill')))
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('skillSync: syncAllSkills skips a project-scoped skill whose project no longer resolves', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-home-'))
  setSkillHomeDir(home)
  try {
    const orphan = makeSkill({ scope: 'project', projectId: 'gone' })
    syncAllSkills(
      () => [orphan],
      () => null,
    )
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills', 'my-skill')), 'nothing materialized for an unresolvable project')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

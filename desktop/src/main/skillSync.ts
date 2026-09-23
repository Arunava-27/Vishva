/**
 * Materializes aicli's own skill records out into each provider CLI's real,
 * native skill-discovery location as a SKILL.md file - the CLI's own model
 * then decides on its own when to use it. aicli never matches keywords or
 * injects skill content into a prompt itself; that would just be a weaker
 * duplicate of what claude/codex already do natively once the file exists.
 *
 * Antigravity's discovery directory and Copilot's entirely different
 * "custom agent profile" format were not confirmed against real docs -
 * deliberately not guessed at here. Only claude and codex are materialized.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SkillData } from './skill.ts'

let homeDir = os.homedir()

/** Test-only: point global-scope materialization at a temp dir instead of
 * the real home directory. */
export function setSkillHomeDir(dir: string): void {
  homeDir = dir
}

function skillMd(skill: SkillData): string {
  return `---\nname: ${skill.slug}\ndescription: ${skill.description}\n---\n\n${skill.body}\n`
}

function targetDirs(skill: SkillData, cwd: string | null): string[] {
  if (skill.scope === 'global') {
    return [path.join(homeDir, '.claude', 'skills', skill.slug), path.join(homeDir, '.agents', 'skills', skill.slug)]
  }
  if (!cwd) return []
  return [path.join(cwd, '.claude', 'skills', skill.slug), path.join(cwd, '.agents', 'skills', skill.slug)]
}

/** Idempotent: (re)writes this skill's materialized SKILL.md at every
 * discovery location implied by its current scope. `cwd` is the owning
 * project's working directory for a project-scoped skill (or the OLD cwd
 * when cleaning up after a move - callers pass whichever cwd is relevant). */
export function syncSkill(skill: SkillData, cwd: string | null): void {
  for (const dir of targetDirs(skill, cwd)) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd(skill))
  }
}

/** Removes this skill's materialized folder(s) at every location implied by
 * scope+cwd, without touching aicli's own JSON record. */
export function unsyncSkill(skill: SkillData, cwd: string | null): void {
  for (const dir of targetDirs(skill, cwd)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Startup self-heal: re-materializes every stored skill against its current
 * scope. Best-effort for a project-scoped skill whose project no longer
 * resolves - same tolerance chat.ts already applies elsewhere. */
export function syncAllSkills(listAll: () => SkillData[], projectCwd: (projectId: string) => string | null): void {
  for (const skill of listAll()) {
    const cwd = skill.scope === 'project' && skill.projectId ? projectCwd(skill.projectId) : null
    if (skill.scope === 'project' && !cwd) continue // project no longer exists - nowhere to materialize into
    syncSkill(skill, cwd)
  }
}

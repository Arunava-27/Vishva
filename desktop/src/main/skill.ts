/**
 * A Skill is aicli's own bookkeeping record for a reusable instruction pack -
 * name, description, and body content. This module only owns that
 * bookkeeping (same one-JSON-file-per-record pattern as project.ts); it
 * knows nothing about where a materialized SKILL.md actually lives on disk
 * for any given provider CLI - that's skillSync.ts's job.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export let SKILLS_DIR = path.join(os.homedir(), '.aicli', 'skills')

export function setSkillsDir(dir: string): void {
  SKILLS_DIR = dir
}

export interface SkillData {
  id: string
  /** Filesystem-safe name, slugified from `name` once at creation and never
   * recomputed - stays stable across renames so an edit never orphans an
   * already-materialized SKILL.md folder under a name that no longer matches. */
  slug: string
  name: string
  description: string
  body: string
  scope: 'global' | 'project'
  projectId: string | null
  createdAt: string
  updatedAt: string
}

function slugify(name: string, existing: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill'
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export class Skill {
  data: SkillData

  constructor(data: SkillData) {
    this.data = data
  }

  static create(
    name: string,
    description: string,
    body: string,
    scope: 'global' | 'project',
    projectId: string | null,
  ): Skill {
    const existingSlugs = new Set(Skill.listAll().map((s) => s.data.slug))
    const now = new Date().toISOString()
    return new Skill({
      id: randomUUID(),
      slug: slugify(name, existingSlugs),
      name,
      description,
      body,
      scope,
      projectId,
      createdAt: now,
      updatedAt: now,
    })
  }

  static filePath(id: string): string {
    return path.join(SKILLS_DIR, `${id}.json`)
  }

  static load(id: string): Skill {
    return new Skill(JSON.parse(fs.readFileSync(Skill.filePath(id), 'utf-8')))
  }

  static listAll(): Skill[] {
    if (!fs.existsSync(SKILLS_DIR)) return []
    return fs
      .readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => Skill.load(f.slice(0, -'.json'.length)))
  }

  static update(
    id: string,
    patch: Partial<Pick<SkillData, 'name' | 'description' | 'body' | 'scope' | 'projectId'>>,
  ): SkillData {
    const s = Skill.load(id)
    Object.assign(s.data, patch, { updatedAt: new Date().toISOString() })
    s.save()
    return s.data
  }

  static delete(id: string): void {
    fs.rmSync(Skill.filePath(id), { force: true })
  }

  save(): void {
    fs.mkdirSync(SKILLS_DIR, { recursive: true })
    fs.writeFileSync(Skill.filePath(this.data.id), JSON.stringify(this.data, null, 2))
  }
}

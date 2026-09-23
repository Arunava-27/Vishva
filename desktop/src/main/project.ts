/**
 * A Project groups chats under a name, a default working directory, and
 * custom instructions prepended to the first message of every chat created
 * under it - same idea as claude.ai's Projects. Same JSON-file-per-record
 * pattern as session.ts, just without history/messages/git-state (a project
 * isn't a conversation, it's a container for them).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export let PROJECTS_DIR = path.join(os.homedir(), '.aicli', 'projects')

export function setProjectsDir(dir: string): void {
  PROJECTS_DIR = dir
}

export interface ProjectData {
  id: string
  name: string
  instructions: string
  cwd: string
  createdAt: string
}

export class Project {
  data: ProjectData

  constructor(data: ProjectData) {
    this.data = data
  }

  static create(name: string, instructions: string, cwd: string): Project {
    return new Project({ id: randomUUID(), name, instructions, cwd, createdAt: new Date().toISOString() })
  }

  static filePath(id: string): string {
    return path.join(PROJECTS_DIR, `${id}.json`)
  }

  static load(id: string): Project {
    return new Project(JSON.parse(fs.readFileSync(Project.filePath(id), 'utf-8')))
  }

  static listAll(): Project[] {
    if (!fs.existsSync(PROJECTS_DIR)) return []
    return fs
      .readdirSync(PROJECTS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => Project.load(f.slice(0, -'.json'.length)))
  }

  static update(id: string, patch: Partial<Pick<ProjectData, 'name' | 'instructions' | 'cwd'>>): ProjectData {
    const p = Project.load(id)
    Object.assign(p.data, patch)
    p.save()
    return p.data
  }

  /** Deletes the project only - sessions created under it keep their stored
   * projectId and simply become ungrouped once it no longer resolves,
   * rather than being cascade-deleted along with it. */
  static delete(id: string): void {
    fs.rmSync(Project.filePath(id), { force: true })
  }

  save(): void {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true })
    fs.writeFileSync(Project.filePath(this.data.id), JSON.stringify(this.data, null, 2))
  }
}

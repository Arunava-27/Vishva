/**
 * Persists deliverable files (PDF/xlsx/csv/docx/diagram images/etc) a
 * Cooperative-mode provider generates, so they survive past their isolated
 * worktree being torn down. Same `~/.aicli/*` storage convention as every
 * other store in this codebase (session.ts, project.ts, gitWorktree.ts's
 * WORKTREES_DIR): a mutable `let DIR` + a setXDir() test seam.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyDeliverableFiles } from './gitWorktree.ts'

export let COOPERATIVE_ATTACHMENTS_DIR = path.join(os.homedir(), '.aicli', 'cooperative-attachments')

/** Test-only: point attachment storage at a temp dir instead of the real one. */
export function setCooperativeAttachmentsDir(dir: string): void {
  COOPERATIVE_ATTACHMENTS_DIR = dir
}

export interface GeneratedFile {
  /** Path as reported by git status, relative to its source directory - used for display. */
  name: string
  /** Absolute, openable path: a copied-out path under
   * COOPERATIVE_ATTACHMENTS_DIR for a fan-out provider (its worktree is
   * about to be deleted), or the real project path for the judge (nothing
   * to copy - it wrote directly into the persistent project directory). */
  path: string
}

function isNonEmptyFile(p: string): boolean {
  try {
    return fs.statSync(p).size > 0
  } catch {
    return false
  }
}

/** Copies any deliverable-looking file a fan-out provider changed out of its
 * (about-to-be-removed) worktree into persistent storage, preserving
 * subpaths. Best-effort per file - a file that vanished or became unreadable
 * between the diff and this copy is silently skipped, never thrown. */
export async function copyOutGeneratedFiles(
  sourceDir: string,
  changedFiles: string[],
  sessionId: string,
  provider: string,
): Promise<GeneratedFile[]> {
  const deliverables = classifyDeliverableFiles(changedFiles)
  const destBase = path.join(COOPERATIVE_ATTACHMENTS_DIR, sessionId, provider)
  const result: GeneratedFile[] = []
  for (const rel of deliverables) {
    const src = path.join(sourceDir, rel)
    if (!isNonEmptyFile(src)) continue
    const dest = path.join(destBase, rel)
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.cpSync(src, dest)
      result.push({ name: rel, path: dest })
    } catch {
      // best-effort - skip a file that failed to copy rather than losing the rest
    }
  }
  return result
}

/** No copy needed - the judge writes directly into the real, persistent
 * project directory, so its deliverable files are already exactly where the
 * user would look for them. Just resolves absolute paths and confirms each
 * still exists and is non-empty. */
export function locateJudgeGeneratedFiles(projectCwd: string, changedFiles: string[]): GeneratedFile[] {
  const deliverables = classifyDeliverableFiles(changedFiles)
  const result: GeneratedFile[] = []
  for (const rel of deliverables) {
    const abs = path.join(projectCwd, rel)
    if (isNonEmptyFile(abs)) result.push({ name: rel, path: abs })
  }
  return result
}

/**
 * Isolated per-provider working copies for Cooperative mode: each participating
 * provider gets its own `git worktree` checked out from the same starting
 * commit, so N providers can all use full file-editing/shell tools in
 * parallel without colliding on the same files. Same raw execFile('git', ...)
 * philosophy as Session.gitState() - no git npm dependency exists in this
 * codebase, and this follows that precedent rather than introducing one.
 */
import { execFile as execFileCb, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

export let WORKTREES_DIR = path.join(os.homedir(), '.aicli', 'worktrees')

/** Test-only: point worktree storage at a temp dir instead of the real one. */
export function setWorktreesDir(dir: string): void {
  WORKTREES_DIR = dir
}

export interface WorktreeHandle {
  provider: string
  path: string
  /** The subdirectory-of-repo-aware cwd to actually hand to runProvider() -
   * equals `path` when the session's cwd was the repo root itself. */
  cwd: string
  /** What diffWorktree() compares this worktree's current state against -
   * the commit right AFTER the dirty-tree carryover (stash-apply + untracked
   * copy) landed, not the original repo HEAD. This isolates what the
   * PROVIDER itself changed from whatever pre-existing uncommitted work was
   * already in the real working tree when the run started - otherwise every
   * provider's diff would also include that shared baseline, making
   * unrelated providers look like they'd all made identical edits. */
  diffBaseCommit: string
}

export interface RepoEligibility {
  isRepo: boolean
  hasCommits: boolean
  dirty: boolean
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd })
  return stdout.trim()
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    return (await git(['rev-parse', '--is-inside-work-tree'], cwd)) === 'true'
  } catch {
    return false
  }
}

export async function hasCommits(cwd: string): Promise<boolean> {
  try {
    await git(['rev-parse', 'HEAD'], cwd)
    return true
  } catch {
    return false
  }
}

export async function repoRoot(cwd: string): Promise<string> {
  return git(['rev-parse', '--show-toplevel'], cwd)
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  return (await git(['status', '--porcelain'], cwd)) !== ''
}

/** Everything Cooperative mode needs to know before offering itself for a
 * given project cwd - surfaced to the renderer via the cooperative:checkRepo
 * IPC channel so the composer can be disabled with a clear reason instead of
 * failing mid-run. */
export async function checkRepoEligibility(cwd: string): Promise<RepoEligibility> {
  const isRepo = await isGitRepo(cwd)
  if (!isRepo) return { isRepo: false, hasCommits: false, dirty: false }
  const [commits, dirty] = await Promise.all([hasCommits(cwd), hasUncommittedChanges(cwd)])
  return { isRepo: true, hasCommits: commits, dirty }
}

function worktreeBaseDir(sessionId: string): string {
  return path.join(WORKTREES_DIR, sessionId)
}

/** After a worktree's dirty-tree carryover (stash-apply + untracked copy)
 * lands, this bakes that carried-over state into a throwaway local commit
 * and returns its SHA - the reference point diffWorktree() should compare
 * against, so a provider's reported diff reflects only what it itself
 * changed, not the pre-existing uncommitted work every worktree started
 * with. Returns `checkoutCommit` unchanged when the worktree came up clean
 * (nothing to bake in). Uses -c user.name/user.email so this works even on a
 * machine with no git identity configured globally - never pushed or
 * shared, purely internal bookkeeping local to this one worktree. */
async function snapshotWorktreeBaseline(worktreePath: string, checkoutCommit: string): Promise<string> {
  const dirty = await hasUncommittedChanges(worktreePath)
  const hasUntracked = (await git(['ls-files', '--others', '--exclude-standard'], worktreePath)) !== ''
  if (!dirty && !hasUntracked) return checkoutCommit
  try {
    await execFile('git', ['add', '-A'], { cwd: worktreePath })
    await execFile(
      'git',
      ['-c', 'user.name=aicli', '-c', 'user.email=aicli@localhost', 'commit', '--no-verify', '-q', '-m', 'aicli-cooperative baseline (carried-over local changes)'],
      { cwd: worktreePath },
    )
    return await git(['rev-parse', 'HEAD'], worktreePath)
  } catch {
    // best-effort - if this fails for any reason (e.g. no writable git
    // config path), fall back to the original commit; the diff will simply
    // include the carried-over changes alongside the provider's own, same as
    // before this baselining existed.
    return checkoutCommit
  }
}

/**
 * Creates one isolated worktree per provider, all detached at the same
 * starting commit. Uncommitted changes in the real working tree are carried
 * over via `git stash create` (a pure snapshot - unlike `stash push`, it
 * never touches the real index/working tree/stash list) applied into each
 * worktree with `git stash apply <sha>`. Untracked-but-not-ignored files
 * aren't captured by `stash create` at all, so those are copied in
 * separately. The real working tree is never modified by this function.
 */
export async function createWorktrees(
  repoRootPath: string,
  sessionCwd: string,
  sessionId: string,
  providerNames: string[],
): Promise<WorktreeHandle[]> {
  const baseCommit = await git(['rev-parse', 'HEAD'], repoRootPath)
  const dirty = await hasUncommittedChanges(repoRootPath)

  let snapshotSha: string | null = null
  if (dirty) {
    const sha = await git(['stash', 'create', `aicli-cooperative-${sessionId}`], repoRootPath)
    if (sha) {
      snapshotSha = sha
      // Pin against GC for the run's duration - a plain `stash create` result
      // is otherwise an unreferenced dangling commit that could be collected
      // before every worktree has had a chance to `stash apply` it.
      await git(['update-ref', `refs/aicli-cooperative/${sessionId}`, snapshotSha], repoRootPath)
    }
    // empty stdout means only ignored files were dirty - nothing to carry over.
  }

  const untracked = (await git(['ls-files', '--others', '--exclude-standard'], repoRootPath))
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)

  const relativeCwd = path.relative(repoRootPath, sessionCwd)
  const handles: WorktreeHandle[] = []

  for (const provider of providerNames) {
    const worktreePath = path.join(worktreeBaseDir(sessionId), provider)
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
    await execFile('git', ['worktree', 'add', '--detach', worktreePath, baseCommit], { cwd: repoRootPath })

    if (snapshotSha) {
      try {
        await execFile('git', ['stash', 'apply', snapshotSha], { cwd: worktreePath })
      } catch {
        // A stash that only touched files unrelated to conflicts can still
        // partially fail to apply cleanly in rare cases - proceed with
        // whatever did apply rather than aborting this provider's worktree
        // entirely; the diff phase will simply reflect less carry-over.
      }
    }

    for (const rel of untracked) {
      const src = path.join(repoRootPath, rel)
      const dest = path.join(worktreePath, rel)
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.cpSync(src, dest)
      } catch {
        // best-effort - a file that vanished between listing and copying is fine to skip
      }
    }

    const diffBaseCommit = await snapshotWorktreeBaseline(worktreePath, baseCommit)
    const cwd = relativeCwd ? path.join(worktreePath, relativeCwd) : worktreePath
    handles.push({ provider, path: worktreePath, cwd, diffBaseCommit })
  }

  return handles
}

export interface WorktreeDiff {
  changedFiles: string[]
  diffStat: string
  diffPatch: string
}

const DIFF_PATCH_MAX_CHARS = 200_000

export async function diffWorktree(handle: WorktreeHandle): Promise<WorktreeDiff> {
  const [status, diffStat, diffPatch] = await Promise.all([
    // `status --short` compares against HEAD, which is diffBaseCommit itself
    // (that's what the baseline commit moved HEAD to) - so this already
    // reflects only the provider's own changes, no explicit ref needed here.
    git(['status', '--short'], handle.path),
    git(['diff', handle.diffBaseCommit, '--stat'], handle.path),
    git(['diff', handle.diffBaseCommit], handle.path),
  ])
  const changedFiles = status
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const truncated =
    diffPatch.length > DIFF_PATCH_MAX_CHARS
      ? diffPatch.slice(0, DIFF_PATCH_MAX_CHARS) + `\n...[diff truncated, ${diffPatch.length - DIFF_PATCH_MAX_CHARS} more chars]`
      : diffPatch
  return { changedFiles, diffStat, diffPatch: truncated }
}

export async function gitStatusShort(cwd: string): Promise<string[]> {
  const raw = await git(['status', '--short'], cwd)
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Extracts the file path from one `git status --short` line - handles the
 * plain `XY path` form, rename lines (`XY orig -> new`, keeping the new
 * path), and git's quoted-path form (a path containing spaces/special
 * characters is wrapped in double quotes with C-style escapes; git's escape
 * set overlaps enough with JSON's for common cases that JSON.parse is a good
 * enough unescaper here - this is a classification helper, not a strict
 * parser). Returns null for a line too short to contain a real path. */
export function parseStatusLinePath(line: string): string | null {
  const trimmed = line.trim()
  if (trimmed.length < 4) return null
  let rest = trimmed.slice(2).trimStart()
  const arrow = rest.indexOf(' -> ')
  if (arrow !== -1) rest = rest.slice(arrow + 4)
  if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
    try {
      return JSON.parse(rest)
    } catch {
      return rest.slice(1, -1)
    }
  }
  return rest || null
}

const DELIVERABLE_EXTENSIONS = new Set(['.pdf', '.xlsx', '.xls', '.csv', '.docx', '.pptx', '.png', '.jpg', '.jpeg', '.svg', '.gif'])

/** Which of these `git status --short` lines look like a real deliverable
 * file by extension - a UI suggestion surface (offer a preview/open chip),
 * not a security boundary, so extension-only classification is accepted;
 * callers that touch the filesystem (cooperativeAttachments.ts) additionally
 * skip zero-byte files. Returns relative paths, not raw status lines. */
export function classifyDeliverableFiles(changedFiles: string[]): string[] {
  const result: string[] = []
  for (const line of changedFiles) {
    const rel = parseStatusLinePath(line)
    if (!rel) continue
    if (DELIVERABLE_EXTENSIONS.has(path.extname(rel).toLowerCase())) result.push(rel)
  }
  return result
}

/** Removes worktrees and unpins the stash snapshot. Never throws - a failed
 * removal falls back to a raw directory delete so one bad worktree can't
 * leak the rest or abort the caller's cleanup path. */
export async function removeWorktrees(repoRootPath: string, handles: WorktreeHandle[]): Promise<void> {
  for (const handle of handles) {
    try {
      await execFile('git', ['worktree', 'remove', '--force', handle.path], { cwd: repoRootPath })
    } catch {
      try {
        fs.rmSync(handle.path, { recursive: true, force: true })
      } catch {
        // already gone - fine
      }
    }
  }
  try {
    await execFile('git', ['worktree', 'prune'], { cwd: repoRootPath })
  } catch {
    // best-effort
  }
  removeEmptySessionDirs(handles)
}

/** `git worktree remove` only deletes the provider's own subdirectory, not
 * the parent `<sessionId>/` folder that held it - clean that up too so no
 * empty directory lingers under WORKTREES_DIR once every provider's worktree
 * is gone. */
function removeEmptySessionDirs(handles: WorktreeHandle[]): void {
  const parents = new Set(handles.map((h) => path.dirname(h.path)))
  for (const dir of parents) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
    } catch {
      // not empty (a provider's worktree removal failed above) or already gone - fine
    }
  }
}

/** Explicit ref cleanup, called with the same sessionId used in
 * createWorktrees() - kept separate from removeWorktrees() (which only has
 * handles, not the sessionId) rather than trying to recover the id from a
 * worktree path. */
export async function unpinSnapshot(repoRootPath: string, sessionId: string): Promise<void> {
  try {
    await execFile('git', ['update-ref', '-d', `refs/aicli-cooperative/${sessionId}`], { cwd: repoRootPath })
  } catch {
    // no snapshot was ever pinned (clean working tree) - fine
  }
}

/** Synchronous variant of the removal path, used only from the
 * mainWindow.on('close') emergency-kill branch so cleanup has a chance to
 * finish before app.quit() tears down the process. */
export function removeWorktreesSync(repoRootPath: string, handles: WorktreeHandle[]): void {
  for (const handle of handles) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', handle.path], { cwd: repoRootPath })
    } catch {
      try {
        fs.rmSync(handle.path, { recursive: true, force: true })
      } catch {
        // already gone - fine
      }
    }
  }
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: repoRootPath })
  } catch {
    // best-effort
  }
  removeEmptySessionDirs(handles)
}

/** Crash backstop: force-removes any worktree directory left behind under
 * WORKTREES_DIR whose owning repo no longer lists it as a real worktree (or
 * whose repo can't be resolved at all, e.g. the session's cwd is gone).
 * Called once at app startup. `ownerCwds` maps sessionId -> the repo cwd that
 * session used, recovered by the caller from cooperativeSession.ts records. */
export async function sweepOrphanedWorktrees(ownerCwds: Map<string, string>): Promise<void> {
  if (!fs.existsSync(WORKTREES_DIR)) return
  for (const sessionId of fs.readdirSync(WORKTREES_DIR)) {
    const sessionDir = path.join(WORKTREES_DIR, sessionId)
    if (!fs.statSync(sessionDir).isDirectory()) continue
    const ownerCwd = ownerCwds.get(sessionId)
    if (!ownerCwd) {
      // no session record refers to this id at all - definitely orphaned.
      fs.rmSync(sessionDir, { recursive: true, force: true })
      continue
    }
    try {
      const root = await repoRoot(ownerCwd)
      const listed = await git(['worktree', 'list', '--porcelain'], root)
      for (const provider of fs.readdirSync(sessionDir)) {
        const wtPath = path.join(sessionDir, provider)
        if (!listed.includes(wtPath.replace(/\\/g, '/')) && !listed.includes(wtPath)) {
          fs.rmSync(wtPath, { recursive: true, force: true })
        }
      }
      await unpinSnapshot(root, sessionId).catch(() => {})
      // remove the now-possibly-empty session dir
      try {
        fs.rmdirSync(sessionDir)
      } catch {
        // still has entries - fine, leave it
      }
    } catch {
      // owner repo no longer resolvable (deleted project, moved folder, etc.) - safe to nuke.
      fs.rmSync(sessionDir, { recursive: true, force: true })
    }
  }
}

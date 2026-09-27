import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  checkRepoEligibility,
  createWorktrees,
  diffWorktree,
  hasCommits,
  hasUncommittedChanges,
  isGitRepo,
  removeWorktrees,
  repoRoot,
  setWorktreesDir,
  sweepOrphanedWorktrees,
  unpinSnapshot,
} from './gitWorktree.ts'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd }).toString().trim()
}

function initRepo(dir: string): void {
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  // Pin autocrlf off for these throwaway repos so file contents round-trip
  // byte-for-byte through worktree checkout/stash-apply - otherwise Windows's
  // global autocrlf=true setting rewrites LF to CRLF on checkout, unrelated
  // to anything this module does.
  git(dir, ['config', 'core.autocrlf', 'false'])
}

function withTempRepo(fn: (repo: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-gitwt-repo-'))
    const worktrees = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-gitwt-wt-'))
    setWorktreesDir(worktrees)
    try {
      await fn(repo)
    } finally {
      // repo may itself have leftover worktree admin files if a test forgot
      // to clean up - force-remove both unconditionally.
      fs.rmSync(repo, { recursive: true, force: true })
      fs.rmSync(worktrees, { recursive: true, force: true })
    }
  }
}

test('isGitRepo / hasCommits: false for a plain non-repo directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-gitwt-plain-'))
  try {
    assert.equal(await isGitRepo(dir), false)
    assert.equal(await hasCommits(dir), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test(
  'isGitRepo: true but hasCommits: false for a freshly-init repo with no commits',
  withTempRepo(async (repo) => {
    initRepo(repo)
    assert.equal(await isGitRepo(repo), true)
    assert.equal(await hasCommits(repo), false)
    const elig = await checkRepoEligibility(repo)
    assert.deepEqual(elig, { isRepo: true, hasCommits: false, dirty: false })
  }),
)

test(
  'checkRepoEligibility: clean repo with commits reports dirty: false',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])
    const elig = await checkRepoEligibility(repo)
    assert.deepEqual(elig, { isRepo: true, hasCommits: true, dirty: false })
  }),
)

test(
  'hasUncommittedChanges: true after an uncommitted edit',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])
    fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n')
    assert.equal(await hasUncommittedChanges(repo), true)
  }),
)

test(
  'createWorktrees: each provider gets its own directory at the same base commit',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])
    const root = await repoRoot(repo)

    const handles = await createWorktrees(root, repo, 'sess-1', ['claude', 'codex'])
    try {
      assert.equal(handles.length, 2)
      const names = handles.map((h) => h.provider).sort()
      assert.deepEqual(names, ['claude', 'codex'])
      for (const h of handles) {
        assert.ok(fs.existsSync(path.join(h.path, 'a.txt')))
        assert.equal(fs.readFileSync(path.join(h.cwd, 'a.txt'), 'utf-8'), 'hello\n')
      }
      // distinct paths
      assert.notEqual(handles[0].path, handles[1].path)
    } finally {
      await removeWorktrees(root, handles)
      await unpinSnapshot(root, 'sess-1')
    }
  }),
)

test(
  'createWorktrees: uncommitted changes in the real tree are visible in every worktree, and the real tree is untouched',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])
    // uncommitted edit
    fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty-edit\n')
    const root = await repoRoot(repo)

    const handles = await createWorktrees(root, repo, 'sess-2', ['claude'])
    try {
      assert.equal(fs.readFileSync(path.join(handles[0].cwd, 'a.txt'), 'utf-8'), 'dirty-edit\n')
      // the real tree must be completely unaffected by stash create/apply
      assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8'), 'dirty-edit\n')
      assert.equal(await hasUncommittedChanges(repo), true)
    } finally {
      await removeWorktrees(root, handles)
      await unpinSnapshot(root, 'sess-2')
    }
  }),
)

test(
  'createWorktrees: untracked files are copied into every worktree',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])
    fs.writeFileSync(path.join(repo, 'new-untracked.txt'), 'brand new\n')
    const root = await repoRoot(repo)

    const handles = await createWorktrees(root, repo, 'sess-3', ['claude'])
    try {
      assert.equal(fs.readFileSync(path.join(handles[0].cwd, 'new-untracked.txt'), 'utf-8'), 'brand new\n')
    } finally {
      await removeWorktrees(root, handles)
      await unpinSnapshot(root, 'sess-3')
    }
  }),
)

test(
  'diffWorktree: reports a file the provider "edited" inside its own worktree',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])
    const root = await repoRoot(repo)

    const handles = await createWorktrees(root, repo, 'sess-4', ['claude'])
    try {
      fs.writeFileSync(path.join(handles[0].cwd, 'a.txt'), 'edited by provider\n')
      const diff = await diffWorktree(handles[0])
      assert.ok(diff.changedFiles.some((f) => f.includes('a.txt')))
      assert.ok(diff.diffStat.includes('a.txt'))
      assert.ok(diff.diffPatch.includes('edited by provider'))
      // the real repo's file must still be the original - worktree edits are isolated.
      assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8'), 'hello\n')
    } finally {
      await removeWorktrees(root, handles)
      await unpinSnapshot(root, 'sess-4')
    }
  }),
)

test(
  'removeWorktrees: cleans up worktree directories and git worktree list',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])
    const root = await repoRoot(repo)

    const handles = await createWorktrees(root, repo, 'sess-5', ['claude', 'codex'])
    // simulate a provider having edited a file, which would otherwise make
    // `git worktree remove` (without --force) refuse to remove it.
    fs.writeFileSync(path.join(handles[0].cwd, 'a.txt'), 'dirty inside worktree\n')

    await removeWorktrees(root, handles)
    await unpinSnapshot(root, 'sess-5')

    for (const h of handles) assert.equal(fs.existsSync(h.path), false)
    const listed = git(root, ['worktree', 'list'])
    for (const h of handles) assert.ok(!listed.includes(h.path))
  }),
)

test(
  'sweepOrphanedWorktrees: removes a leftover worktree dir whose session has no owner record',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])

    const orphanSessionDir = path.join((await import('./gitWorktree.ts')).WORKTREES_DIR, 'orphan-sess')
    fs.mkdirSync(orphanSessionDir, { recursive: true })
    fs.writeFileSync(path.join(orphanSessionDir, 'placeholder.txt'), 'leftover')

    await sweepOrphanedWorktrees(new Map())

    assert.equal(fs.existsSync(orphanSessionDir), false)
  }),
)

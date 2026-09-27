import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  checkRepoEligibility,
  classifyDeliverableFiles,
  createWorktrees,
  diffWorktree,
  gitStatusShort,
  hasCommits,
  hasUncommittedChanges,
  isGitRepo,
  parseStatusLinePath,
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

test('parseStatusLinePath: plain modified/untracked lines', () => {
  assert.equal(parseStatusLinePath('?? report.pdf'), 'report.pdf')
  assert.equal(parseStatusLinePath(' M dir/chart.png'), 'dir/chart.png')
  assert.equal(parseStatusLinePath('A  new-file.csv'), 'new-file.csv')
})

test('parseStatusLinePath: rename lines keep the new path', () => {
  assert.equal(parseStatusLinePath('R  old.csv -> new.csv'), 'new.csv')
  assert.equal(parseStatusLinePath('R  dir/old.xlsx -> dir/renamed.xlsx'), 'dir/renamed.xlsx')
})

test('parseStatusLinePath: quoted paths (spaces/special chars) are unescaped', () => {
  assert.equal(parseStatusLinePath('?? "report with spaces.pdf"'), 'report with spaces.pdf')
})

test('parseStatusLinePath: too-short or empty lines return null', () => {
  assert.equal(parseStatusLinePath(''), null)
  assert.equal(parseStatusLinePath('??'), null)
})

test('classifyDeliverableFiles: filters to known deliverable extensions, case-insensitively', () => {
  const lines = ['?? report.PDF', ' M src/index.ts', 'A  chart.png', '?? notes.txt', 'R  a.csv -> b.csv']
  assert.deepEqual(classifyDeliverableFiles(lines), ['report.PDF', 'chart.png', 'b.csv'])
})

test('classifyDeliverableFiles: excludes source-code extensions', () => {
  const lines = ['?? main.ts', 'M  index.js', '?? styles.css']
  assert.deepEqual(classifyDeliverableFiles(lines), [])
})

test(
  'gitStatusShort: returns trimmed non-empty status lines',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])
    fs.writeFileSync(path.join(repo, 'b.txt'), 'new\n')
    const lines = await gitStatusShort(repo)
    assert.deepEqual(lines, ['?? b.txt'])
  }),
)

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
  'diffWorktree: a dirty real repo does NOT leak into the diff for a provider that made no edits of its own',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])
    // pre-existing uncommitted work in the real repo, carried into every
    // worktree by design (createWorktrees) - this must NOT show up as if the
    // provider itself had made these changes.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'pre-existing dirty edit\n')
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'pre-existing untracked file\n')
    const root = await repoRoot(repo)

    const handles = await createWorktrees(root, repo, 'sess-baseline', ['claude'])
    try {
      // provider makes no edits at all (e.g. answered a question, wrote no files)
      const diff = await diffWorktree(handles[0])
      assert.deepEqual(diff.changedFiles, [])
      assert.equal(diff.diffStat, '')
      assert.equal(diff.diffPatch, '')
      // but the carried-over content really was there for the provider to see
      assert.equal(fs.readFileSync(path.join(handles[0].cwd, 'a.txt'), 'utf-8'), 'pre-existing dirty edit\n')
      assert.equal(fs.readFileSync(path.join(handles[0].cwd, 'untracked.txt'), 'utf-8'), 'pre-existing untracked file\n')
    } finally {
      await removeWorktrees(root, handles)
      await unpinSnapshot(root, 'sess-baseline')
    }
  }),
)

test(
  'diffWorktree: a provider\'s own edit on top of a dirty real repo shows only that edit',
  withTempRepo(async (repo) => {
    initRepo(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
    fs.writeFileSync(path.join(repo, 'b.txt'), 'hello\n')
    git(repo, ['add', 'a.txt', 'b.txt'])
    git(repo, ['commit', '-q', '-m', 'init'])
    fs.writeFileSync(path.join(repo, 'a.txt'), 'pre-existing dirty edit\n')
    const root = await repoRoot(repo)

    const handles = await createWorktrees(root, repo, 'sess-baseline2', ['claude'])
    try {
      fs.writeFileSync(path.join(handles[0].cwd, 'b.txt'), 'edited by the provider\n')
      const diff = await diffWorktree(handles[0])
      assert.ok(diff.changedFiles.some((f) => f.includes('b.txt')))
      assert.ok(!diff.changedFiles.some((f) => f.includes('a.txt')), 'the pre-existing dirty edit to a.txt must not appear')
      assert.ok(diff.diffPatch.includes('edited by the provider'))
      assert.ok(!diff.diffPatch.includes('pre-existing dirty edit'))
    } finally {
      await removeWorktrees(root, handles)
      await unpinSnapshot(root, 'sess-baseline2')
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

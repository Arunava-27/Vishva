import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copyOutGeneratedFiles, locateJudgeGeneratedFiles, setCooperativeAttachmentsDir } from './cooperativeAttachments.ts'

function withTempAttachmentsDir(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-attach-'))
    setCooperativeAttachmentsDir(tmp)
    try {
      await fn()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
}

test(
  'copyOutGeneratedFiles: copies deliverable files preserving subpaths, skips non-deliverables',
  withTempAttachmentsDir(async () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-attach-src-'))
    try {
      fs.mkdirSync(path.join(source, 'out'), { recursive: true })
      fs.writeFileSync(path.join(source, 'out', 'report.pdf'), 'fake pdf bytes')
      fs.writeFileSync(path.join(source, 'index.ts'), 'not a deliverable')

      const changedFiles = ['?? out/report.pdf', '?? index.ts']
      const files = await copyOutGeneratedFiles(source, changedFiles, 'sess-1', 'claude')

      assert.equal(files.length, 1)
      assert.equal(files[0].name, 'out/report.pdf')
      assert.ok(fs.existsSync(files[0].path))
      assert.equal(fs.readFileSync(files[0].path, 'utf-8'), 'fake pdf bytes')
      // survives after the "worktree" (source) is deleted
      fs.rmSync(source, { recursive: true, force: true })
      assert.ok(fs.existsSync(files[0].path))
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
    }
  }),
)

test(
  'copyOutGeneratedFiles: skips zero-byte and vanished files without throwing',
  withTempAttachmentsDir(async () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-attach-src2-'))
    try {
      fs.writeFileSync(path.join(source, 'empty.pdf'), '')
      // 'missing.csv' is listed as changed but never actually created - simulates
      // a file that vanished between the diff and this copy step.
      const changedFiles = ['?? empty.pdf', '?? missing.csv']
      const files = await copyOutGeneratedFiles(source, changedFiles, 'sess-2', 'codex')
      assert.deepEqual(files, [])
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
    }
  }),
)

test(
  'copyOutGeneratedFiles: namespaces by session and provider, no collisions',
  withTempAttachmentsDir(async () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-attach-src3-'))
    try {
      fs.writeFileSync(path.join(source, 'chart.png'), 'png-a')
      const a = await copyOutGeneratedFiles(source, ['?? chart.png'], 'sess-3', 'claude')
      fs.writeFileSync(path.join(source, 'chart.png'), 'png-b')
      const b = await copyOutGeneratedFiles(source, ['?? chart.png'], 'sess-3', 'codex')
      assert.notEqual(a[0].path, b[0].path)
      assert.equal(fs.readFileSync(a[0].path, 'utf-8'), 'png-a')
      assert.equal(fs.readFileSync(b[0].path, 'utf-8'), 'png-b')
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
    }
  }),
)

test('locateJudgeGeneratedFiles: resolves absolute real-project paths without copying anything', () => {
  const projectCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-judge-proj-'))
  try {
    fs.writeFileSync(path.join(projectCwd, 'report.xlsx'), 'xlsx bytes')
    fs.writeFileSync(path.join(projectCwd, 'main.py'), 'not a deliverable')
    const files = locateJudgeGeneratedFiles(projectCwd, ['?? report.xlsx', '?? main.py'])
    assert.equal(files.length, 1)
    assert.equal(files[0].name, 'report.xlsx')
    assert.equal(files[0].path, path.join(projectCwd, 'report.xlsx'))
  } finally {
    fs.rmSync(projectCwd, { recursive: true, force: true })
  }
})

test('locateJudgeGeneratedFiles: excludes a listed file that no longer exists', () => {
  const projectCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-judge-proj2-'))
  try {
    const files = locateJudgeGeneratedFiles(projectCwd, ['?? never-written.pdf'])
    assert.deepEqual(files, [])
  } finally {
    fs.rmSync(projectCwd, { recursive: true, force: true })
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCooperative, type CooperativeEvent } from './cooperative.ts'
import { PROVIDERS, type Provider } from './providers.ts'
import { setWorktreesDir, WORKTREES_DIR } from './gitWorktree.ts'

const NODE = process.execPath

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd }).toString().trim()
}

function initRepo(dir: string): void {
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  git(dir, ['config', 'core.autocrlf', 'false'])
  fs.writeFileSync(path.join(dir, 'shared.txt'), 'start\n')
  git(dir, ['add', 'shared.txt'])
  git(dir, ['commit', '-q', '-m', 'init'])
}

/** A fake provider that, after `delayMs`, overwrites shared.txt in its own
 * (worktree) cwd with `marker` and writes a plain-text reply to stdout. */
function editingProvider(name: string, marker: string, delayMs = 0, exitCode = 0): Provider {
  const script = `
const fs = require('fs');
setTimeout(() => {
  fs.writeFileSync('shared.txt', 'edited by ${marker}\\n');
  process.stdout.write('reply from ${name}');
  process.exit(${exitCode});
}, ${delayMs});
`
  return { name, binary: NODE, installHint: 'n/a', printArgs: ['-e', script, '{prompt}'], verified: true }
}

/** A fake judge that reads its prompt (argv[1]) and reports which markers it
 * saw embedded in it - proves the judge prompt actually carries every
 * provider's diff content. Then "applies" its result by writing a file in
 * its own cwd (the REAL repo when run through runCooperative, not a worktree). */
function judgeProvider(name: string, markersToCheck: string[], exitCode = 0): Provider {
  const checks = markersToCheck.map((m) => `(prompt.includes('${m}') ? '${m}=true' : '${m}=false')`).join(" + ' ' + ")
  const script = `
const fs = require('fs');
const prompt = process.argv[1] || '';
fs.writeFileSync('judge-applied.txt', 'judge picked the best answer\\n');
process.stdout.write('JUDGE_SAW ' + ${checks});
process.exit(${exitCode});
`
  return { name, binary: NODE, installHint: 'n/a', printArgs: ['-e', script, '{prompt}'], verified: true }
}

function withRepo(fn: (repo: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-repo-'))
    const worktrees = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-wt-'))
    setWorktreesDir(worktrees)
    try {
      await fn(repo)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
      fs.rmSync(worktrees, { recursive: true, force: true })
    }
  }
}

function registerProviders(...providers: Provider[]): () => void {
  for (const p of providers) PROVIDERS[p.name] = p
  return () => {
    for (const p of providers) delete PROVIDERS[p.name]
  }
}

test(
  'runCooperative: providers run in parallel, not sequentially',
  withRepo(async (repo) => {
    initRepo(repo)
    const unregister = registerProviders(editingProvider('alpha', 'ALPHA', 300), editingProvider('beta', 'BETA', 300))
    try {
      const attemptTimes: Record<string, number> = {}
      const result = await runCooperative(repo, 'sess-parallel', 'do the thing', ['alpha', 'beta'], 'alpha', {
        onEvent: (e: CooperativeEvent) => {
          if (e.kind === 'attempt' && e.provider) attemptTimes[e.provider] = Date.parse(e.timestamp)
        },
      })
      assert.ok(attemptTimes.alpha && attemptTimes.beta, 'both providers should have emitted an attempt event')
      // If dispatched sequentially, beta's attempt would fire ~300ms+ after
      // alpha's (only once alpha's whole delay had elapsed). Truly parallel
      // dispatch fires both within the same tick.
      assert.ok(Math.abs(attemptTimes.alpha - attemptTimes.beta) < 150, 'attempts should start within the same short window')
      assert.equal(result.providerResults.length, 2)
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: worktree paths are distinct per provider and diffs reflect each provider\'s own edit',
  withRepo(async (repo) => {
    initRepo(repo)
    const unregister = registerProviders(editingProvider('alpha', 'ALPHA_MARKER'), editingProvider('beta', 'BETA_MARKER'))
    try {
      const result = await runCooperative(repo, 'sess-distinct', 'do the thing', ['alpha', 'beta'], 'alpha', {})
      const alpha = result.providerResults.find((r) => r.provider === 'alpha')!
      const beta = result.providerResults.find((r) => r.provider === 'beta')!
      assert.equal(alpha.status, 'SUCCESS')
      assert.equal(beta.status, 'SUCCESS')
      assert.ok(alpha.diffPatch.includes('ALPHA_MARKER'))
      assert.ok(!alpha.diffPatch.includes('BETA_MARKER'))
      assert.ok(beta.diffPatch.includes('BETA_MARKER'))
      assert.ok(!beta.diffPatch.includes('ALPHA_MARKER'))
      // no worktree directories should remain once the run has completed
      assert.equal(fs.existsSync(path.join(WORKTREES_DIR, 'sess-distinct')), false)
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: judge prompt embeds every provider\'s diff, and the judge applies to the REAL repo, not a worktree',
  withRepo(async (repo) => {
    initRepo(repo)
    const unregister = registerProviders(
      editingProvider('alpha', 'ALPHA_MARKER'),
      editingProvider('beta', 'BETA_MARKER'),
      judgeProvider('judge', ['ALPHA_MARKER', 'BETA_MARKER']),
    )
    try {
      const result = await runCooperative(repo, 'sess-judge', 'do the thing', ['alpha', 'beta'], 'judge', {})
      assert.ok(result.judge)
      assert.equal(result.judge!.status, 'SUCCESS')
      assert.ok(result.judge!.reply.includes('ALPHA_MARKER=true'))
      assert.ok(result.judge!.reply.includes('BETA_MARKER=true'))
      // the judge's fake "apply" really landed in the real repo directory
      assert.ok(fs.existsSync(path.join(repo, 'judge-applied.txt')))
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: partial success still invokes the judge, using only the successful (plus failed) results',
  withRepo(async (repo) => {
    initRepo(repo)
    const unregister = registerProviders(
      editingProvider('alpha', 'ALPHA_MARKER'),
      editingProvider('beta', 'BETA_MARKER', 0, 1), // exits non-zero -> FAILURE
      judgeProvider('judge', ['ALPHA_MARKER']),
    )
    try {
      const result = await runCooperative(repo, 'sess-partial', 'do the thing', ['alpha', 'beta'], 'judge', {})
      const alpha = result.providerResults.find((r) => r.provider === 'alpha')!
      const beta = result.providerResults.find((r) => r.provider === 'beta')!
      assert.equal(alpha.status, 'SUCCESS')
      assert.notEqual(beta.status, 'SUCCESS')
      assert.ok(result.judge, 'judge should still run with at least one success')
      assert.equal(result.judge!.status, 'SUCCESS')
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: all providers failing skips the judge entirely',
  withRepo(async (repo) => {
    initRepo(repo)
    const unregister = registerProviders(
      editingProvider('alpha', 'ALPHA_MARKER', 0, 1),
      editingProvider('beta', 'BETA_MARKER', 0, 1),
    )
    try {
      const result = await runCooperative(repo, 'sess-allfail', 'do the thing', ['alpha', 'beta'], 'alpha', {})
      assert.equal(result.judge, null)
      assert.match(result.judgeError ?? '', /all providers failed/i)
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: judge failure returns raw provider results with judge: null',
  withRepo(async (repo) => {
    initRepo(repo)
    const unregister = registerProviders(editingProvider('alpha', 'ALPHA_MARKER'), judgeProvider('judge', ['ALPHA_MARKER'], 1))
    try {
      const result = await runCooperative(repo, 'sess-judgefail', 'do the thing', ['alpha'], 'judge', {})
      assert.equal(result.judge, null)
      assert.match(result.judgeError ?? '', /judge.*failed/i)
      assert.equal(result.providerResults.length, 1)
      assert.equal(result.providerResults[0].status, 'SUCCESS')
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: not a git repo returns a clear judgeError and never spawns a provider',
  async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-notrepo-'))
    const worktrees = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-wt-'))
    setWorktreesDir(worktrees)
    const unregister = registerProviders({
      name: 'alpha',
      binary: NODE,
      installHint: 'n/a',
      printArgs: ['-e', 'process.exit(0)'],
      verified: true,
    })
    try {
      const result = await runCooperative(plain, 'sess-notrepo', 'do the thing', ['alpha'], 'alpha', {})
      assert.equal(result.judge, null)
      assert.match(result.judgeError ?? '', /git repository/i)
      // zero provider results proves no provider was ever spawned - the repo
      // check short-circuits before any worktree/provider work begins.
      assert.equal(result.providerResults.length, 0)
    } finally {
      unregister()
      fs.rmSync(plain, { recursive: true, force: true })
      fs.rmSync(worktrees, { recursive: true, force: true })
    }
  },
)

test(
  'runCooperative: cancellation before the judge phase skips the judge and still cleans up worktrees',
  withRepo(async (repo) => {
    initRepo(repo)
    const unregister = registerProviders(editingProvider('alpha', 'ALPHA_MARKER', 50), judgeProvider('judge', ['ALPHA_MARKER']))
    try {
      let cancelled = false
      const runPromise = runCooperative(repo, 'sess-cancel', 'do the thing', ['alpha'], 'judge', {
        isCancelled: () => cancelled,
      })
      // flip cancellation shortly after dispatch, before the provider's own
      // 50ms delay resolves.
      await new Promise((r) => setTimeout(r, 10))
      cancelled = true
      const result = await runPromise
      assert.equal(result.judge, null)
      assert.equal(result.judgeError, 'cancelled')
      assert.equal(fs.existsSync(path.join(WORKTREES_DIR, 'sess-cancel')), false)
    } finally {
      unregister()
    }
  }),
)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractClarifyingQuestion, runCooperative, type CooperativeEvent } from './cooperative.ts'
import { setCooperativeAttachmentsDir } from './cooperativeAttachments.ts'
import { PROVIDERS, type Provider } from './providers.ts'
import { setWorktreesDir, WORKTREES_DIR } from './gitWorktree.ts'
import { getUsage, setUsageFile } from './usage.ts'

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

/** A fake provider that asks a clarifying question for its first
 * `asksBeforeAnswering` invocations (tracked via a counter file persisted in
 * its own worktree cwd, since each round is a genuinely fresh subprocess
 * with no memory of prior rounds), then answers for real and edits
 * shared.txt with `marker`. */
function clarifyingProvider(name: string, question: string, asksBeforeAnswering: number, marker: string): Provider {
  const script = `
const fs = require('fs');
let round = 1;
try { round = parseInt(fs.readFileSync('clarify-round.txt', 'utf8'), 10) + 1; } catch {}
fs.writeFileSync('clarify-round.txt', String(round));
if (round <= ${asksBeforeAnswering}) {
  process.stdout.write('===AICLI_CLARIFICATION_NEEDED===\\n${question}\\n===AICLI_CLARIFICATION_NEEDED_END===');
} else {
  fs.writeFileSync('shared.txt', 'edited by ${marker} after clarification (round ' + round + ')\\n');
  process.stdout.write('final answer after ' + round + ' rounds');
}
process.exit(0);
`
  return { name, binary: NODE, installHint: 'n/a', printArgs: ['-e', script, '{prompt}'], verified: true }
}

/** A fake provider that "generates" a deliverable file alongside a normal reply. */
function fileGeneratingProvider(name: string, filename: string, content: string): Provider {
  const script = `
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(filename)}, ${JSON.stringify(content)});
process.stdout.write('generated a file: ${filename}');
process.exit(0);
`
  return { name, binary: NODE, installHint: 'n/a', printArgs: ['-e', script, '{prompt}'], verified: true }
}

/** A fake provider (with a real modelFlag) that scans its own argv for
 * --model and echoes back what it received - proves the model choice
 * actually reached the CLI invocation. */
function modelAwareProvider(name: string): Provider {
  const script = "const a=process.argv.slice(1);const i=a.indexOf('--model');process.stdout.write('model=' + (i!==-1?a[i+1]:'none'))"
  return { name, binary: NODE, installHint: 'n/a', printArgs: ['-e', script, '{prompt}'], modelFlag: '--model', verified: true }
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

test('extractClarifyingQuestion: detects the marker block amid other prose', () => {
  const reply = `Sure, let me think.\n===AICLI_CLARIFICATION_NEEDED===\nWhich file did you mean?\n===AICLI_CLARIFICATION_NEEDED_END===\nThanks.`
  assert.equal(extractClarifyingQuestion(reply), 'Which file did you mean?')
})

test('extractClarifyingQuestion: multi-line question body', () => {
  const reply = `===AICLI_CLARIFICATION_NEEDED===\nLine one.\nLine two?\n===AICLI_CLARIFICATION_NEEDED_END===`
  assert.equal(extractClarifyingQuestion(reply), 'Line one.\nLine two?')
})

test('extractClarifyingQuestion: plain prose discussing clarification does not false-positive', () => {
  assert.equal(extractClarifyingQuestion('I might need to ask for clarification on this.'), null)
  assert.equal(extractClarifyingQuestion('Here is my final answer, no questions.'), null)
})

test('extractClarifyingQuestion: no marker at all returns null', () => {
  assert.equal(extractClarifyingQuestion('Just a normal reply.'), null)
})

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

test(
  'runCooperative: a provider that asks a clarifying question pauses, gets answered, and resumes to a real result',
  withRepo(async (repo) => {
    initRepo(repo)
    // A separate, non-clarifying judge - using the clarifying provider as its
    // own judge would exercise the clarify loop a second time (independently,
    // in the real project cwd) and confound these fan-out-only assertions.
    const unregister = registerProviders(clarifyingProvider('alpha', 'What color?', 1, 'ALPHA_ANSWERED'), editingProvider('judge', 'JUDGE_MARKER'))
    try {
      const questions: { provider: string; question: string; round: number }[] = []
      const answers: string[] = []
      const result = await runCooperative(repo, 'sess-clarify', 'do the thing', ['alpha'], 'judge', {
        onEvent: (e) => {
          if (e.kind === 'clarify-question') questions.push({ provider: e.provider!, question: e.message, round: 1 })
        },
        onClarificationNeeded: async (provider, question, round) => {
          answers.push(`answering ${provider} round ${round}: ${question}`)
          return 'blue'
        },
      })
      assert.equal(questions.length, 1)
      assert.equal(questions[0].provider, 'alpha')
      assert.equal(questions[0].question, 'What color?')
      assert.equal(answers.length, 1)
      const alpha = result.providerResults.find((r) => r.provider === 'alpha')!
      assert.equal(alpha.status, 'SUCCESS')
      assert.match(alpha.reply, /final answer after 2 rounds/)
      assert.ok(alpha.diffPatch.includes('ALPHA_ANSWERED'), 'the post-clarification edit should be in the diff')
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: a provider that keeps asking is capped at maxClarifyRounds, then forced to answer',
  withRepo(async (repo) => {
    initRepo(repo)
    // asksBeforeAnswering is effectively infinite - it would never naturally
    // stop asking on its own, proving the cap (not the provider) ends the loop.
    const unregister = registerProviders(clarifyingProvider('alpha', 'Still unclear?', 999, 'ALPHA_FORCED'), editingProvider('judge', 'JUDGE_MARKER'))
    try {
      let invocationCount = 0
      const questionRounds: number[] = []
      const result = await runCooperative(repo, 'sess-clarify-cap', 'do the thing', ['alpha'], 'judge', {
        maxClarifyRounds: 2,
        onEvent: (e) => {
          if (e.kind === 'attempt' && e.provider === 'alpha') invocationCount++
          if (e.kind === 'clarify-question' && e.provider === 'alpha') questionRounds.push(Number(e.detail?.match(/round (\d+)/)?.[1]))
        },
        onClarificationNeeded: async () => 'some answer',
      })
      // Round 1 asks and gets answered; round 2 hits the cap (the cap check
      // happens before emitting a 'clarify-question' for that round, so it's
      // never asked normally) and forces round 3, which is accepted
      // unconditionally = 3 total invocations, never infinite, and only one
      // real clarify-question event (round 1).
      assert.equal(invocationCount, 3)
      assert.deepEqual(questionRounds, [1])
      const alpha = result.providerResults.find((r) => r.provider === 'alpha')!
      assert.equal(alpha.status, 'SUCCESS')
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: cancelling while a provider is paused awaiting an answer resolves cleanly as CANCELLED',
  withRepo(async (repo) => {
    initRepo(repo)
    const unregister = registerProviders(clarifyingProvider('alpha', 'Need info', 1, 'ALPHA_NEVER'))
    try {
      const result = await runCooperative(repo, 'sess-clarify-cancel', 'do the thing', ['alpha'], 'alpha', {
        onClarificationNeeded: async () => null, // simulates cooperative:cancel resolving the pending answer with null
      })
      const alpha = result.providerResults.find((r) => r.provider === 'alpha')!
      assert.equal(alpha.status, 'CANCELLED')
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: the judge can also ask a clarifying question and resumes once answered',
  withRepo(async (repo) => {
    initRepo(repo)
    const unregister = registerProviders(editingProvider('alpha', 'ALPHA_MARKER'), clarifyingProvider('judge', 'Which approach?', 1, 'JUDGE_ANSWERED'))
    try {
      let sawJudgeQuestion = false
      const result = await runCooperative(repo, 'sess-judge-clarify', 'do the thing', ['alpha'], 'judge', {
        onEvent: (e) => {
          if (e.kind === 'clarify-question' && e.provider === 'judge') sawJudgeQuestion = true
        },
        onClarificationNeeded: async () => 'go with approach B',
      })
      assert.ok(sawJudgeQuestion)
      assert.ok(result.judge)
      assert.equal(result.judge!.status, 'SUCCESS')
      assert.match(result.judge!.reply, /final answer after 2 rounds/)
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: a fan-out provider\'s generated file survives after its worktree is removed',
  withRepo(async (repo) => {
    initRepo(repo)
    const unregister = registerProviders(fileGeneratingProvider('alpha', 'report.pdf', 'fake pdf content'))
    const tmpAttachments = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-attach-int-'))
    setCooperativeAttachmentsDir(tmpAttachments)
    try {
      const result = await runCooperative(repo, 'sess-genfile', 'write a report', ['alpha'], 'alpha', {})
      const alpha = result.providerResults.find((r) => r.provider === 'alpha')!
      assert.equal(alpha.status, 'SUCCESS')
      assert.equal(alpha.generatedFiles.length, 1)
      assert.equal(alpha.generatedFiles[0].name, 'report.pdf')
      assert.ok(fs.existsSync(alpha.generatedFiles[0].path))
      assert.equal(fs.readFileSync(alpha.generatedFiles[0].path, 'utf-8'), 'fake pdf content')
      // the worktree itself is already gone
      assert.equal(fs.existsSync(path.join(WORKTREES_DIR, 'sess-genfile')), false)
    } finally {
      unregister()
      fs.rmSync(tmpAttachments, { recursive: true, force: true })
    }
  }),
)

test(
  'runCooperative: the judge\'s generated file is detected in the real project, excluding pre-existing untracked files',
  withRepo(async (repo) => {
    initRepo(repo)
    // a pre-existing untracked dummy file, unrelated to the judge, already
    // sitting in the repo before the run starts.
    fs.writeFileSync(path.join(repo, 'preexisting.csv'), 'not from the judge')
    const unregister = registerProviders(
      editingProvider('alpha', 'ALPHA_MARKER'),
      fileGeneratingProvider('judge', 'summary.xlsx', 'fake xlsx content'),
    )
    try {
      const result = await runCooperative(repo, 'sess-judge-genfile', 'do the thing', ['alpha'], 'judge', {})
      assert.ok(result.judge)
      assert.equal(result.judge!.generatedFiles.length, 1)
      assert.equal(result.judge!.generatedFiles[0].name, 'summary.xlsx')
      assert.equal(result.judge!.generatedFiles[0].path, path.join(repo, 'summary.xlsx'))
    } finally {
      unregister()
    }
  }),
)

test(
  'runCooperative: modelByProvider threads the right model into each fan-out provider AND the judge, and records usage per provider+model',
  withRepo(async (repo) => {
    initRepo(repo)
    const tmpUsageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-usage-'))
    setUsageFile(path.join(tmpUsageDir, 'usage.json'))
    const unregister = registerProviders(modelAwareProvider('alpha'), modelAwareProvider('judge'))
    try {
      const result = await runCooperative(repo, 'sess-model', 'do the thing', ['alpha'], 'judge', {
        modelByProvider: { alpha: 'opus', judge: 'sonnet' },
      })
      const alpha = result.providerResults.find((r) => r.provider === 'alpha')!
      assert.equal(alpha.status, 'SUCCESS')
      assert.equal(alpha.reply, 'model=opus')
      assert.ok(result.judge)
      assert.equal(result.judge!.reply, 'model=sonnet')

      const usage = getUsage()
      assert.equal(usage.alpha.opus.requestCount, 1)
      assert.equal(usage.judge.sonnet.requestCount, 1)
    } finally {
      unregister()
      fs.rmSync(tmpUsageDir, { recursive: true, force: true })
    }
  }),
)

test(
  'runCooperative: usage is recorded under the "default" model key when no model was selected',
  withRepo(async (repo) => {
    initRepo(repo)
    const tmpUsageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-usage2-'))
    setUsageFile(path.join(tmpUsageDir, 'usage.json'))
    const unregister = registerProviders(editingProvider('alpha', 'ALPHA_MARKER'), editingProvider('judge', 'JUDGE_MARKER'))
    try {
      await runCooperative(repo, 'sess-model-default', 'do the thing', ['alpha'], 'judge', {})
      const usage = getUsage()
      assert.equal(usage.alpha.default.requestCount, 1)
      assert.equal(usage.judge.default.requestCount, 1)
    } finally {
      unregister()
      fs.rmSync(tmpUsageDir, { recursive: true, force: true })
    }
  }),
)

test(
  'runCooperative: a failed provider does NOT get its usage recorded',
  withRepo(async (repo) => {
    initRepo(repo)
    const tmpUsageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicli-coop-usage3-'))
    setUsageFile(path.join(tmpUsageDir, 'usage.json'))
    const unregister = registerProviders(editingProvider('alpha', 'ALPHA_MARKER', 0, 1))
    try {
      const result = await runCooperative(repo, 'sess-model-fail', 'do the thing', ['alpha'], 'alpha', {})
      assert.notEqual(result.providerResults[0].status, 'SUCCESS')
      const usage = getUsage()
      assert.equal(usage.alpha, undefined)
    } finally {
      unregister()
      fs.rmSync(tmpUsageDir, { recursive: true, force: true })
    }
  }),
)

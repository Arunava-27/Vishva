import { useEffect, useMemo, useState } from 'react'
import { useCooperative } from '../hooks/useCooperative'
import type {
  ChatEvent,
  CooperativeEvent,
  CooperativeJudgeResult,
  CooperativeProviderResult,
  Message,
  ProviderStatus,
  RepoEligibility,
} from '../types'
import ActivityFeed from './ActivityFeed'
import ClarifyPrompt from './ClarifyPrompt'
import Composer from './Composer'
import CooperativeSessionList from './CooperativeSessionList'
import GeneratedFileChip from './GeneratedFileChip'
import MessageBubble from './MessageBubble'

const MAX_CLARIFY_ROUNDS = 3 // mirrors cooperative.ts's own default - not yet user-configurable

interface Props {
  providers: ProviderStatus[]
  cwd: string
  projectId: string | null
  defaultJudgeProvider: string
}

function eligibleProviders(providers: ProviderStatus[]): ProviderStatus[] {
  return providers.filter((p) => p.installed && p.loggedIn === true && (p.cooldownUntil === null || p.cooldownUntil < Date.now()))
}

// ActivityFeed (reused unmodified) types its `events` prop as ChatEvent[],
// whose `kind` union is narrower than CooperativeEvent's (which adds
// worktree-setup/judge-start/etc). Every other field is identical, and
// ActivityFeed only ever compares `kind` against string literals for
// display, never exhaustively - so the extra kinds render fine at runtime
// via its generic row branch. This narrows just the `kind` field's type
// rather than casting the whole event shape.
function asChatEvents(events: CooperativeEvent[]): ChatEvent[] {
  return events as unknown as ChatEvent[]
}

function toDisplayMessage(
  result: CooperativeProviderResult | CooperativeJudgeResult,
  timestamp: string,
  fallbackText?: string,
): Message {
  return {
    role: 'assistant',
    text: result.reply || fallbackText || '(no reply)',
    provider: result.provider,
    timestamp,
    toolCalls: result.toolCalls,
    usage: result.usage,
  }
}

export default function CooperativeView({ providers, cwd, projectId, defaultJudgeProvider }: Props) {
  const coop = useCooperative()
  const eligible = useMemo(() => eligibleProviders(providers), [providers])
  const [deselected, setDeselected] = useState<Set<string>>(new Set())
  const [judgeProvider, setJudgeProvider] = useState(defaultJudgeProvider)
  const [repoEligibility, setRepoEligibility] = useState<RepoEligibility | null>(null)
  const [runningParticipants, setRunningParticipants] = useState<string[]>([])
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    coop.refreshSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!window.aicli) return
    window.aicli.checkCooperativeRepo(cwd).then(setRepoEligibility)
  }, [cwd])

  useEffect(() => {
    const eligibleNames = new Set(eligible.map((p) => p.name))
    // if the currently-chosen judge is no longer eligible, fall back to the
    // first still-eligible provider rather than leaving a stale selection.
    if (!eligibleNames.has(judgeProvider) && eligible.length > 0) setJudgeProvider(eligible[0].name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible])

  useEffect(() => {
    if (!coop.runningTask) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [coop.runningTask])

  const participants = eligible.map((p) => p.name).filter((n) => !deselected.has(n))
  const busy = !!coop.runningTask
  const elapsedSec = coop.runningTask ? Math.round((now - coop.runningTask.startedAt) / 1000) : 0

  function toggleParticipant(name: string) {
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function handleSend(text: string, attachments: string[]) {
    if (participants.length === 0) return
    setRunningParticipants(participants)
    await coop.send(text, attachments, participants, judgeProvider, cwd, projectId)
  }

  const disabledReason =
    repoEligibility === null
      ? null
      : !repoEligibility.isRepo || !repoEligibility.hasCommits
        ? 'Cooperative mode needs a git repository with at least one commit — run `git init && git commit` in this project first.'
        : participants.length === 0
          ? 'No installed & logged-in providers selected - pick at least one below.'
          : null

  const latestTurn = coop.session?.turns.at(-1)

  return (
    <div className="cooperative-view">
      <div className="cooperative-header">
        <h2>Cooperative</h2>
        <button className="link-btn" onClick={() => coop.setSession(null)}>
          + New run
        </button>
      </div>

      <div className="cooperative-body">
        <div className="cooperative-sidebar">
          <CooperativeSessionList
            sessions={coop.sessions}
            activeSessionId={coop.session?.id ?? null}
            busySessionIds={new Set(coop.runningTask && coop.session ? [coop.session.id] : [])}
            onOpenSession={coop.openSession}
            onRename={coop.renameSession}
            onDelete={coop.deleteSession}
          />
        </div>

        <div className="cooperative-main">
          <div className="cooperative-picker">
            <div className="cooperative-chip-row">
              {eligible.length === 0 && <span className="cooperative-hint">No installed & logged-in providers found.</span>}
              {eligible.map((p) => (
                <button
                  key={p.name}
                  className={'cooperative-chip' + (deselected.has(p.name) ? ' off' : '')}
                  onClick={() => toggleParticipant(p.name)}
                  disabled={busy}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <label className="cooperative-judge-select">
              Judge:
              <select value={judgeProvider} onChange={(e) => setJudgeProvider(e.target.value)} disabled={busy || eligible.length === 0}>
                {eligible.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!coop.session && !coop.runningTask && (
            <div className="empty-state">
              <p>One prompt, every provider, best result wins.</p>
              <p className="empty-state-hint">Pick providers above and send a prompt to start a cooperative run.</p>
            </div>
          )}

          <div className="messages">
            {coop.session?.turns.map((turn, i) => (
              <div key={i} className="cooperative-turn">
                <MessageBubble message={{ role: 'user', text: turn.prompt, provider: null, timestamp: turn.timestamp }} />
                {turn.providerResults.map((r) => (
                  <details key={r.provider} className="cooperative-provider-result">
                    <summary>
                      <span className="tool-call-provider">{r.provider}</span>
                      <span className={'cooperative-status cooperative-status-' + r.status.toLowerCase()}>{r.status}</span>
                      {r.diffStat && <span className="cooperative-diffstat">{r.diffStat.trim().split('\n').at(-1)}</span>}
                    </summary>
                    <MessageBubble message={toDisplayMessage(r, turn.timestamp, r.rawStderr.slice(0, 300))} />
                    {r.generatedFiles.length > 0 && (
                      <div className="cooperative-generated-files">
                        {r.generatedFiles.map((f) => (
                          <GeneratedFileChip key={f.path} file={f} />
                        ))}
                      </div>
                    )}
                  </details>
                ))}
                {turn.judge ? (
                  <div className="cooperative-judge-answer">
                    <div className="cooperative-judge-label">🏆 Judge's pick — {turn.judge.provider}</div>
                    <MessageBubble message={toDisplayMessage(turn.judge, turn.timestamp)} />
                    {turn.judge.generatedFiles.length > 0 && (
                      <div className="cooperative-generated-files">
                        {turn.judge.generatedFiles.map((f) => (
                          <GeneratedFileChip key={f.path} file={f} />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="cooperative-judge-failure">{turn.judgeError ?? 'No synthesized answer for this run.'}</div>
                )}
              </div>
            ))}

            {coop.runningTask && (
              <div className="cooperative-grid" style={{ gridTemplateColumns: `repeat(${runningParticipants.length + 1}, 1fr)` }}>
                {runningParticipants.map((name) => {
                  const pending = coop.runningTask!.pendingClarifications.get(name)
                  return (
                    <div key={name} className="cooperative-grid-col">
                      <div className="cooperative-grid-col-label">{name}</div>
                      {pending && (
                        <ClarifyPrompt
                          question={pending.question}
                          round={pending.round}
                          maxRounds={MAX_CLARIFY_ROUNDS}
                          onAnswer={(answer) => coop.answerClarification(name, answer)}
                        />
                      )}
                      <ActivityFeed events={asChatEvents(coop.runningTask!.activity.filter((e) => e.provider === name))} elapsedSec={elapsedSec} />
                    </div>
                  )
                })}
                <div className="cooperative-grid-col">
                  <div className="cooperative-grid-col-label">Judge</div>
                  {coop.runningTask.pendingClarifications.get(judgeProvider) && (
                    <ClarifyPrompt
                      question={coop.runningTask.pendingClarifications.get(judgeProvider)!.question}
                      round={coop.runningTask.pendingClarifications.get(judgeProvider)!.round}
                      maxRounds={MAX_CLARIFY_ROUNDS}
                      onAnswer={(answer) => coop.answerClarification(judgeProvider, answer)}
                    />
                  )}
                  <ActivityFeed
                    events={asChatEvents(coop.runningTask.activity.filter((e) => e.provider === judgeProvider && e.kind !== 'attempt'))}
                    elapsedSec={elapsedSec}
                  />
                </div>
              </div>
            )}
          </div>

          {disabledReason && <div className="cooperative-disabled-hint">{disabledReason}</div>}
          <Composer busy={busy || !!disabledReason} onSend={handleSend} onCancel={coop.cancel} />
          {latestTurn?.judgeError === 'cancelled' && <div className="cooperative-disabled-hint">Last run was cancelled.</div>}
        </div>
      </div>
    </div>
  )
}

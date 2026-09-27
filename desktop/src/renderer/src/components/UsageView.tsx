import { Fragment, useEffect, useState } from 'react'
import type { UsageData, UsageEntry } from '../types'

function emptyTotal(): UsageEntry {
  return { requestCount: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, other: {}, lastUsedAt: '' }
}

function addInto(acc: UsageEntry, e: UsageEntry): void {
  acc.requestCount += e.requestCount
  acc.inputTokens += e.inputTokens
  acc.outputTokens += e.outputTokens
  acc.reasoningTokens += e.reasoningTokens
  acc.costUsd += e.costUsd
  for (const [k, v] of Object.entries(e.other)) acc.other[k] = (acc.other[k] ?? 0) + v
  if (e.lastUsedAt > acc.lastUsedAt) acc.lastUsedAt = e.lastUsedAt
}

function fmtNum(n: number): string {
  return n === 0 ? '—' : n.toLocaleString()
}

function fmtCost(n: number): string {
  return n === 0 ? '—' : `$${n.toFixed(2)}`
}

function fmtWhen(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function otherBadges(other: Record<string, number>): string {
  const entries = Object.entries(other)
  return entries.length ? entries.map(([k, v]) => `${v} ${k}`).join(', ') : ''
}

export default function UsageView() {
  const [usage, setUsage] = useState<UsageData | null>(null)

  function refresh() {
    if (!window.aicli) return
    window.aicli.getUsage().then(setUsage)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleReset() {
    if (!window.aicli) return
    if (!window.confirm('Clear all usage stats? This cannot be undone.')) return
    const cleared = await window.aicli.resetUsage()
    setUsage(cleared)
  }

  const providers = usage ? Object.keys(usage).sort() : []
  const grandTotal = emptyTotal()
  for (const p of providers) for (const e of Object.values(usage![p])) addInto(grandTotal, e)

  return (
    <div className="usage-view">
      <div className="usage-header">
        <h2>Usage</h2>
        <div className="usage-actions">
          <button className="link-btn" onClick={refresh}>
            🔄 Refresh
          </button>
          <button className="link-btn" onClick={handleReset}>
            🗑 Reset
          </button>
        </div>
      </div>

      {usage && providers.length === 0 && (
        <div className="empty-state">
          <p>No usage recorded yet.</p>
          <p className="empty-state-hint">Send a chat or Cooperative run to see per-provider, per-model stats here.</p>
        </div>
      )}

      {usage && providers.length > 0 && (
        <table className="usage-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Model</th>
              <th>Requests</th>
              <th>Input tokens</th>
              <th>Output tokens</th>
              <th>Reasoning tokens</th>
              <th>Cost (USD)</th>
              <th>Last used</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => {
              const models = Object.keys(usage[p]).sort((a, b) => (usage[p][b].lastUsedAt || '').localeCompare(usage[p][a].lastUsedAt || ''))
              const providerTotal = emptyTotal()
              for (const m of models) addInto(providerTotal, usage[p][m])
              return (
                <Fragment key={p}>
                  {models.map((m) => {
                    const e = usage[p][m]
                    const badges = otherBadges(e.other)
                    return (
                      <tr key={`${p}-${m}`}>
                        <td>{p}</td>
                        <td>
                          {m}
                          {badges && <span className="usage-other-badge"> · {badges}</span>}
                        </td>
                        <td>{e.requestCount}</td>
                        <td>{fmtNum(e.inputTokens)}</td>
                        <td>{fmtNum(e.outputTokens)}</td>
                        <td>{fmtNum(e.reasoningTokens)}</td>
                        <td>{fmtCost(e.costUsd)}</td>
                        <td>{fmtWhen(e.lastUsedAt)}</td>
                      </tr>
                    )
                  })}
                  {models.length > 1 && (
                    <tr key={`${p}-subtotal`} className="usage-subtotal-row">
                      <td>{p}</td>
                      <td>subtotal</td>
                      <td>{providerTotal.requestCount}</td>
                      <td>{fmtNum(providerTotal.inputTokens)}</td>
                      <td>{fmtNum(providerTotal.outputTokens)}</td>
                      <td>{fmtNum(providerTotal.reasoningTokens)}</td>
                      <td>{fmtCost(providerTotal.costUsd)}</td>
                      <td>{fmtWhen(providerTotal.lastUsedAt)}</td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            <tr className="usage-grand-total-row">
              <td colSpan={2}>Total</td>
              <td>{grandTotal.requestCount}</td>
              <td>{fmtNum(grandTotal.inputTokens)}</td>
              <td>{fmtNum(grandTotal.outputTokens)}</td>
              <td>{fmtNum(grandTotal.reasoningTokens)}</td>
              <td>{fmtCost(grandTotal.costUsd)}</td>
              <td>{fmtWhen(grandTotal.lastUsedAt)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

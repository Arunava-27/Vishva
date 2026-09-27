import { useEffect, useState } from 'react'
import { anyLimited, limitStatus } from '../lib/providerLimits'
import type { ProviderStatus } from '../types'

interface Props {
  providers: ProviderStatus[]
  onRefreshProviders: () => void
  onInstall: (name: string) => void
  onLogin: (name: string) => void
  onOpenInstallUrl: (name: string) => void
  onCheckConnection: (name: string) => void
  onClearCooldown: (name: string) => void
  checking: Record<string, string>
}

export default function ProviderPanel({
  providers,
  onRefreshProviders,
  onInstall,
  onLogin,
  onOpenInstallUrl,
  onCheckConnection,
  onClearCooldown,
  checking,
}: Props) {
  const [now, setNow] = useState(Date.now())

  // Only ticks while something is actually counting down - a provider with
  // no recorded cooldown at all costs nothing here.
  useEffect(() => {
    if (!anyLimited(providers)) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [providers])

  return (
    <div style={{ marginTop: 'auto' }}>
      <h2>
        Providers{' '}
        <span style={{ cursor: 'pointer', textTransform: 'none' }} onClick={onRefreshProviders}>
          ↻
        </span>
      </h2>
      {providers.map((p) => {
        const limit = limitStatus(p, now)
        return (
          <div key={p.name} className={'provider-row' + (p.installed ? ' installed' : '')} title={p.installHint}>
            <span className="provider-name">
              <span className="dot">{p.installed ? '●' : '○'}</span>
              {p.name}
              {p.installed && !p.verified ? ' (unverified)' : ''}
              {limit && (
                <span className="cooldown-badge" title={limit.label}>
                  {' '}
                  ⏳ {limit.label}
                  <button
                    className="link-btn"
                    title="Dismiss this cooldown - use if you believe it's wrong (e.g. already recovered)"
                    onClick={(e) => {
                      e.stopPropagation()
                      onClearCooldown(p.name)
                    }}
                  >
                    clear
                  </button>
                </span>
              )}
            </span>
            {!p.installed && p.canAutoInstall && (
              <button className="link-btn" onClick={() => onInstall(p.name)}>
                Install
              </button>
            )}
            {!p.installed && !p.canAutoInstall && p.installUrl && (
              <button className="link-btn" onClick={() => onOpenInstallUrl(p.name)}>
                Get it
              </button>
            )}
            {/* Connected status is about whether we've observed a real login/chat
                success - independent of whether there's a button to trigger a
                login (antigravity has no scriptable login command at all, but
                can still show as connected once a chat with it has succeeded). */}
            {p.installed && p.loggedIn === true && p.canLogin && (
              <button className="link-btn connected" onClick={() => onLogin(p.name)} title="Connected - click to re-login">
                ✓ Connected
              </button>
            )}
            {p.installed && p.loggedIn === true && !p.canLogin && (
              <span className="link-btn connected" title="Connected (observed from a successful chat - no login command exists for this provider)">
                ✓ Connected
              </span>
            )}
            {p.installed && p.loggedIn !== true && p.canLogin && (
              <button className="link-btn" onClick={() => onLogin(p.name)}>
                Login
              </button>
            )}
            {p.installed && p.loggedIn !== true && !p.canLogin && (
              <span className="check-connection-group">
                <span
                  className="unknown-status"
                  title="No login command exists for this provider - it can only be confirmed by a real call"
                >
                  {checking[p.name] || 'unknown'}
                </span>
                <button
                  className="link-btn"
                  onClick={() => onCheckConnection(p.name)}
                  disabled={checking[p.name] === 'Checking...'}
                  title="Sends one small real message to verify the connection (uses a little real quota)"
                >
                  Check
                </button>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

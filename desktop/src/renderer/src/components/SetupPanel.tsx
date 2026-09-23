export interface SetupState {
  provider: string
  action: 'install' | 'login'
  log: string
  running: boolean
  code: number | null
}

interface Props {
  state: SetupState
  onCancel: () => void
  onClose: () => void
}

export default function SetupPanel({ state, onCancel, onClose }: Props) {
  const verb = state.action === 'install' ? 'Installing' : 'Logging in to'
  const done = !state.running
  const success = done && state.code === 0

  return (
    <div className="setup-overlay">
      <div className="setup-panel">
        <h3>
          {verb} {state.provider}
          {done && (success ? ' — done' : ' — stopped')}
        </h3>
        <pre className="setup-log">{state.log || '(waiting for output...)'}</pre>
        <div className="setup-actions">
          {state.running ? (
            <button className="cancel" onClick={onCancel}>
              Cancel
            </button>
          ) : (
            <button onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  )
}

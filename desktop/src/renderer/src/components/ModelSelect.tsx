import { useState } from 'react'

interface Props {
  models: string[]
  value: string
  onChange: (model: string) => void
  disabled?: boolean
}

const CUSTOM = '__custom__'
const DEFAULT_OPTION = ''

// Shared by the chat-header model picker, Cooperative mode's per-provider
// chips, and Settings' default-model rows - a dropdown of known models plus
// a "(provider default)" unset option and a "Custom..." free-text escape
// hatch, since the curated model lists are necessarily best-effort and may
// go stale as each CLI's accepted values change (see providers.ts's
// per-provider confidence comments).
export default function ModelSelect({ models, value, onChange, disabled }: Props) {
  // Starts in custom mode if the current value doesn't match any known
  // model (and isn't empty) - handles a stale/removed model gracefully,
  // never crashes, just shows the raw string in a text input.
  const [customMode, setCustomMode] = useState(() => value !== '' && !models.includes(value))

  if (customMode) {
    return (
      <span className="model-select-custom">
        <input
          type="text"
          value={value}
          placeholder="model name"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="link-btn"
          disabled={disabled}
          onClick={() => {
            setCustomMode(false)
            onChange(DEFAULT_OPTION)
          }}
          title="Back to dropdown"
        >
          ×
        </button>
      </span>
    )
  }

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === CUSTOM) {
          setCustomMode(true)
          onChange(DEFAULT_OPTION)
        } else {
          onChange(e.target.value)
        }
      }}
    >
      <option value={DEFAULT_OPTION}>(provider default)</option>
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      <option value={CUSTOM}>Custom…</option>
    </select>
  )
}

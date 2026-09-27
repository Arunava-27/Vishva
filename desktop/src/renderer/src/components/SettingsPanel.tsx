import FallbackOrderEditor from './FallbackOrderEditor'
import ModelSelect from './ModelSelect'
import type { ProviderStatus, Settings } from '../types'

interface Props {
  settings: Settings
  providerNames: string[]
  providers: ProviderStatus[]
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}

export default function SettingsPanel({ settings, providerNames, providers, onChange, onClose }: Props) {
  return (
    <div className="setup-overlay" onClick={onClose}>
      <div className="setup-panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>

        <label className="settings-row">
          Theme
          <span className="theme-radios">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <label key={t}>
                <input type="radio" name="theme" checked={settings.theme === t} onChange={() => onChange({ theme: t })} />
                {t}
              </label>
            ))}
          </span>
        </label>

        <label className="settings-row">
          Default provider
          <select value={settings.defaultProvider} onChange={(e) => onChange({ defaultProvider: e.target.value })}>
            {providerNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-row">
          Default fallback order
          <FallbackOrderEditor
            allProviders={providerNames}
            order={settings.defaultFallbackOrder}
            onChange={(order) => onChange({ defaultFallbackOrder: order })}
          />
        </div>

        <label className="settings-row">
          Default judge (Cooperative mode)
          <select value={settings.defaultJudgeProvider} onChange={(e) => onChange({ defaultJudgeProvider: e.target.value })}>
            {providerNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-row">
          Default model
          <div className="settings-model-rows">
            {providers.map((p) => (
              <div key={p.name} className="settings-model-row">
                <span>{p.name}</span>
                <ModelSelect
                  models={p.models}
                  value={settings.defaultModelByProvider[p.name] ?? ''}
                  onChange={(m) => onChange({ defaultModelByProvider: { ...settings.defaultModelByProvider, [p.name]: m } })}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="setup-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import type { ProjectData } from '../types'

interface Props {
  initial?: ProjectData
  onSave: (fields: { name: string; instructions: string; cwd: string }) => void
  onClose: () => void
}

// Same modal shape for create and edit - initial being present is the only difference.
export default function ProjectFormPanel({ initial, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [cwd, setCwd] = useState(initial?.cwd ?? '.')

  async function pickFolder() {
    const dir = await window.aicli.pickDirectory()
    if (dir) setCwd(dir)
  }

  function save() {
    if (!name.trim()) return
    onSave({ name: name.trim(), instructions, cwd })
  }

  return (
    <div className="setup-overlay" onClick={onClose}>
      <div className="setup-panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? 'Edit project' : 'New project'}</h3>

        <label className="settings-row">
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="My API" />
        </label>

        <label className="settings-row">
          Custom instructions
          <textarea
            className="project-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Context and conventions every chat in this project should know about..."
            rows={5}
          />
        </label>

        <label className="settings-row">
          Working directory
          <span className="project-cwd-row">
            <span className="project-cwd-value" title={cwd}>
              {cwd}
            </span>
            <button className="link-btn" onClick={pickFolder}>
              Choose folder...
            </button>
          </span>
        </label>

        <div className="setup-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

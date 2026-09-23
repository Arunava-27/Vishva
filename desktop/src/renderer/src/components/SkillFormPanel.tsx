import { useState } from 'react'
import type { ProjectData, SkillData } from '../types'

interface Props {
  initial?: SkillData
  projects: ProjectData[]
  onSave: (fields: { name: string; description: string; body: string; scope: 'global' | 'project'; projectId: string | null }) => void
  onClose: () => void
}

// Same modal shape for create and edit - initial being present is the only difference.
export default function SkillFormPanel({ initial, projects, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [projectId, setProjectId] = useState<string>(initial?.scope === 'project' ? (initial.projectId ?? '') : '')

  function save() {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      description,
      body,
      scope: projectId ? 'project' : 'global',
      projectId: projectId || null,
    })
  }

  return (
    <div className="setup-overlay" onClick={onClose}>
      <div className="setup-panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? 'Edit skill' : 'New skill'}</h3>

        <label className="settings-row">
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Write Tests First" />
        </label>

        <label className="settings-row">
          Description (helps the model decide when to use it)
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Use when adding new code that needs test coverage"
          />
        </label>

        <label className="settings-row">
          Instructions
          <textarea
            className="project-instructions"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What should the model do when this skill applies..."
            rows={6}
          />
        </label>

        <label className="settings-row">
          Scope
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Global (all chats)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
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

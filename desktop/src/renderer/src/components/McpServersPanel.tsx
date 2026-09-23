import { useState } from 'react'
import type { McpServerConfig, McpTransport, ProjectData } from '../types'

interface Props {
  servers: McpServerConfig[]
  projects: ProjectData[]
  onAdd: (input: Omit<McpServerConfig, 'id'>) => void
  onUpdate: (id: string, patch: Partial<Omit<McpServerConfig, 'id'>>) => void
  onRemove: (id: string) => void
  onClose: () => void
}

const EMPTY_FORM = {
  name: '',
  transport: 'stdio' as McpTransport,
  command: '',
  argsText: '',
  envText: '',
  url: '',
  projectId: '',
}

export default function McpServersPanel({ servers, projects, onAdd, onUpdate, onRemove, onClose }: Props) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  function startCreate() {
    setForm(EMPTY_FORM)
    setEditingId('new')
  }

  function startEdit(s: McpServerConfig) {
    setForm({
      name: s.name,
      transport: s.transport,
      command: s.command,
      argsText: s.args.join(' '),
      envText: Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n'),
      url: s.url,
      projectId: s.projectId ?? '',
    })
    setEditingId(s.id)
  }

  function save() {
    if (!form.name.trim()) return
    const env: Record<string, string> = {}
    for (const line of form.envText.split('\n')) {
      const [k, ...rest] = line.split('=')
      if (k?.trim() && rest.length) env[k.trim()] = rest.join('=').trim()
    }
    const input: Omit<McpServerConfig, 'id'> = {
      name: form.name.trim(),
      scope: form.projectId ? 'project' : 'global',
      projectId: form.projectId || null,
      transport: form.transport,
      command: form.command.trim(),
      args: form.argsText.trim() ? form.argsText.trim().split(/\s+/) : [],
      env,
      url: form.url.trim(),
    }
    if (editingId === 'new') onAdd(input)
    else if (editingId) onUpdate(editingId, input)
    setEditingId(null)
  }

  return (
    <div className="setup-overlay" onClick={onClose}>
      <div className="setup-panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <h3>MCP Servers</h3>

        {editingId === null ? (
          <>
            {servers.length === 0 && <div className="provider-row">No MCP servers configured yet</div>}
            {servers.map((s) => (
              <div key={s.id} className="skill-row">
                <span className="skill-info">
                  <span className="skill-name">
                    {s.name} <span className="mcp-transport-badge">{s.transport}</span>
                  </span>
                  <span className="skill-scope">{s.scope === 'global' ? 'All chats' : 'This project only'}</span>
                </span>
                <span className="project-header-actions">
                  <button className="link-btn" onClick={() => startEdit(s)} title="Edit">
                    ✎
                  </button>
                  <button className="link-btn" onClick={() => onRemove(s.id)} title="Remove">
                    ×
                  </button>
                </span>
              </div>
            ))}
            <p className="mcp-note">Not yet applied to Antigravity sessions.</p>
            <div className="setup-actions">
              <button className="secondary" onClick={onClose}>
                Close
              </button>
              <button onClick={startCreate}>+ Add server</button>
            </div>
          </>
        ) : (
          <>
            <label className="settings-row">
              Name
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
                placeholder="filesystem"
              />
            </label>

            <label className="settings-row">
              Transport
              <span className="theme-radios">
                {(['stdio', 'http'] as const).map((t) => (
                  <label key={t}>
                    <input
                      type="radio"
                      name="transport"
                      checked={form.transport === t}
                      onChange={() => setForm((f) => ({ ...f, transport: t }))}
                    />
                    {t}
                  </label>
                ))}
              </span>
            </label>

            {form.transport === 'stdio' ? (
              <>
                <label className="settings-row">
                  Command
                  <input
                    type="text"
                    value={form.command}
                    onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                    placeholder="npx"
                  />
                </label>
                <label className="settings-row">
                  Args (space-separated)
                  <input
                    type="text"
                    value={form.argsText}
                    onChange={(e) => setForm((f) => ({ ...f, argsText: e.target.value }))}
                    placeholder="-y @modelcontextprotocol/server-filesystem"
                  />
                </label>
                <label className="settings-row">
                  Environment variables (one KEY=value per line)
                  <textarea
                    className="project-instructions"
                    value={form.envText}
                    onChange={(e) => setForm((f) => ({ ...f, envText: e.target.value }))}
                    rows={3}
                  />
                </label>
              </>
            ) : (
              <label className="settings-row">
                URL
                <input
                  type="text"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://example.com/mcp"
                />
              </label>
            )}

            <label className="settings-row">
              Scope
              <select value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}>
                <option value="">All chats</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="setup-actions">
              <button className="secondary" onClick={() => setEditingId(null)}>
                Cancel
              </button>
              <button onClick={save} disabled={!form.name.trim()}>
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

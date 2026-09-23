interface Props {
  allProviders: string[]
  order: string[]
  onChange: (order: string[]) => void
}

// Up/down buttons over checkboxes - simplest thing that isn't a raw comma-
// separated text field. No drag-and-drop library for a handful of rows.
export default function FallbackOrderEditor({ allProviders, order, onChange }: Props) {
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  function toggle(name: string) {
    onChange(order.includes(name) ? order.filter((n) => n !== name) : [...order, name])
  }

  const unused = allProviders.filter((p) => !order.includes(p))

  return (
    <details className="fallback-editor">
      <summary>Fallback order ({order.length})</summary>
      <div className="fallback-list">
        {order.map((name, i) => (
          <div key={name} className="fallback-row">
            <span>
              {i + 1}. {name}
            </span>
            <span className="fallback-row-actions">
              <button className="link-btn" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button className="link-btn" onClick={() => move(i, 1)} disabled={i === order.length - 1}>
                ↓
              </button>
              <button className="link-btn" onClick={() => toggle(name)}>
                Remove
              </button>
            </span>
          </div>
        ))}
        {unused.map((name) => (
          <div key={name} className="fallback-row dim">
            <span>{name}</span>
            <button className="link-btn" onClick={() => toggle(name)}>
              Add
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

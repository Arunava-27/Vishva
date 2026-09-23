interface Props {
  provider?: string | null
  name: string
  input?: unknown
  result?: unknown
  diff?: { added: number; removed: number }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// Collapsed by default via native <details>/<summary> - no JS accordion
// state, no dependency, free keyboard/a11y behavior. Shared by ActivityFeed
// (live, fed from a ChatEvent) and MessageBubble (persisted, fed from a
// saved Message.toolCalls entry) so the row looks identical either way.
export default function ToolCallRow({ provider, name, input, result, diff }: Props) {
  return (
    <details className="tool-call-row">
      <summary>
        {provider && <span className="tool-call-provider">{provider}</span>}
        <span className="tool-call-name">{name}</span>
        {diff && (diff.added > 0 || diff.removed > 0) && (
          <span className="tool-call-diff">
            {diff.added > 0 && <span className="tool-call-diff-added">+{diff.added}</span>}
            {diff.removed > 0 && <span className="tool-call-diff-removed">-{diff.removed}</span>}
          </span>
        )}
      </summary>
      {input !== undefined && <pre className="tool-call-body">{stringify(input)}</pre>}
      {result !== undefined && <pre className="tool-call-body tool-call-result">{stringify(result).slice(0, 2000)}</pre>}
    </details>
  )
}

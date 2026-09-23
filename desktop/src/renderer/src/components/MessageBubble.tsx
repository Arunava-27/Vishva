import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { formatUsage } from '../formatUsage'
import type { Message } from '../types'
import ToolCallRow from './ToolCallRow'

// A named, module-level component (not an inline function redefined every
// render) so React keeps its identity - and therefore its `copied` state -
// stable across re-renders of the parent MessageBubble, instead of
// remounting (and silently dropping any local state) every time.
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="code-block">
      <button
        className={`copy-code-btn${copied ? ' copied' : ''}`}
        onClick={() => {
          navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <SyntaxHighlighter style={oneDark} language={language} PreTag="div">
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

// Deliberately no rehype-raw here: message text comes from a provider CLI's
// output, which we treat as untrusted-ish content, not markup to execute -
// react-markdown skips raw HTML by default and that's the behavior we want.
export default function MessageBubble({ message }: { message: Message }) {
  const who = message.role === 'user' ? 'You' : message.role === 'assistant' ? message.provider ?? 'assistant' : 'System'

  return (
    <div className={`turn turn-${message.role}`}>
      <div className={`turn-role turn-role-${message.role}`}>{who}</div>
      <div className="turn-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code(props) {
              const { className, children } = props
              const match = /language-(\w+)/.exec(className || '')
              if (!match) {
                return <code className={className}>{children}</code>
              }
              return <CodeBlock language={match[1]} code={String(children).replace(/\n$/, '')} />
            },
          }}
        >
          {message.text}
        </ReactMarkdown>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="turn-tools">
            {message.toolCalls.map((t, i) => (
              <ToolCallRow key={i} name={t.name} input={t.input} result={t.result} diff={t.diff} />
            ))}
          </div>
        )}
        {formatUsage(message.usage) && <div className="turn-usage">{formatUsage(message.usage)}</div>}
      </div>
    </div>
  )
}


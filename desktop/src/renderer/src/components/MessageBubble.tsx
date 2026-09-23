import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Message } from '../types'

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
              const code = String(children).replace(/\n$/, '')
              return (
                <div className="code-block">
                  <button className="copy-code-btn" onClick={() => navigator.clipboard.writeText(code)}>
                    Copy
                  </button>
                  <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">
                    {code}
                  </SyntaxHighlighter>
                </div>
              )
            },
          }}
        >
          {message.text}
        </ReactMarkdown>
      </div>
    </div>
  )
}


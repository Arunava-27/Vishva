import { useRef, useState } from 'react'

interface Props {
  busy: boolean
  onSend: (text: string, attachments: string[]) => void
  onCancel: () => void
}

export default function Composer({ busy, onSend, onCancel }: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function send() {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    onSend(trimmed, attachments)
    setText('')
    setAttachments([])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => window.aicli.getPathForFile(f))
    setAttachments((prev) => [...prev, ...paths])
  }

  async function onAttachClick() {
    const paths = await window.aicli.attachDialog()
    if (paths.length) setAttachments((prev) => [...prev, ...paths])
  }

  return (
    <div
      className={'composer' + (dragging ? ' dropzone-active' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="attachments-hint" onClick={() => setAttachments([])}>
        {attachments.length > 0
          ? `Attached (${attachments.length}): ${attachments.map((p) => p.split(/[\\/]/).pop()).join(', ')}  [Clear]`
          : 'Drag files here, or click Attach...'}
      </div>
      <div className="composer-row">
        <button className="secondary" onClick={onAttachClick} disabled={busy}>
          Attach...
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="Message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        {busy ? (
          <button className="cancel" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button onClick={send}>Send</button>
        )}
      </div>
    </div>
  )
}

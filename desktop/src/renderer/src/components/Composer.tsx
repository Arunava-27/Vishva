import { useRef, useState } from 'react'
import type { Attachment } from '../types'
import AttachmentChip from './AttachmentChip'

interface Props {
  busy: boolean
  onSend: (text: string, attachments: string[]) => void
  onCancel: () => void
}

export default function Composer({ busy, onSend, onCancel }: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function send() {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    onSend(trimmed, attachments.map((a) => a.path))
    setText('')
    setAttachments([])
  }

  function removeAttachment(path: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.path === path)
      if (target?.origin === 'pasted') window.aicli.deleteTempAttachment(path)
      return prev.filter((a) => a.path !== path)
    })
  }

  function clearAttachments() {
    for (const a of attachments) {
      if (a.origin === 'pasted') window.aicli.deleteTempAttachment(a.path)
    }
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
    setAttachments((prev) => [...prev, ...paths.map((path) => ({ path, origin: 'picked' as const }))])
  }

  async function onAttachClick() {
    const paths = await window.aicli.attachDialog()
    if (paths.length) setAttachments((prev) => [...prev, ...paths.map((path) => ({ path, origin: 'picked' as const }))])
  }

  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    const file = item.getAsFile()
    if (!file) return
    const buf = await file.arrayBuffer()
    const ext = item.type.split('/')[1] || 'png'
    const savedPath = await window.aicli.saveClipboardImage(buf, ext)
    setAttachments((prev) => [...prev, { path: savedPath, origin: 'pasted' }])
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
      {attachments.length > 0 ? (
        <div className="attachment-chips">
          {attachments.map((a) => (
            <AttachmentChip key={a.path} attachment={a} onRemove={() => removeAttachment(a.path)} />
          ))}
          <button className="attachment-clear-all" onClick={clearAttachments}>
            Clear all
          </button>
        </div>
      ) : (
        <div className="attachments-hint">Drag files here, paste an image, or click Attach...</div>
      )}
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
          onPaste={onPaste}
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

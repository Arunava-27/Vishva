import { useEffect, useState } from 'react'
import type { Attachment } from '../types'

interface Props {
  attachment: Attachment
  onRemove: () => void
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

export default function AttachmentChip({ attachment, onRemove }: Props) {
  const name = attachment.path.split(/[\\/]/).pop() ?? attachment.path
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const isImage = IMAGE_EXT.has(ext)
  const [thumbnail, setThumbnail] = useState<string | null>(null)

  useEffect(() => {
    if (!isImage) return
    let cancelled = false
    window.aicli.getAttachmentThumbnail(attachment.path).then((dataUrl) => {
      if (!cancelled) setThumbnail(dataUrl)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.path])

  return (
    <div className="attachment-chip" title={attachment.path}>
      {isImage && thumbnail ? (
        <img className="attachment-thumb" src={thumbnail} alt={name} />
      ) : (
        <span className="attachment-icon">{isImage ? '🖼' : '📄'}</span>
      )}
      <span className="attachment-name">{name}</span>
      <button className="attachment-remove" onClick={onRemove} title="Remove">
        ×
      </button>
    </div>
  )
}

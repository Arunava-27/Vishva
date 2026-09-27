import { useEffect, useState } from 'react'
import type { GeneratedFile } from '../types'

interface Props {
  file: GeneratedFile
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg'])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i).toLowerCase()
}

// Reuses the existing, generic attachments:thumbnail IPC handler (already in
// this codebase for chat attachments - takes any file path, returns a base64
// data URI if it's a recognized image extension under a size cap) rather
// than adding a cooperative-specific preview mechanism.
export default function GeneratedFileChip({ file }: Props) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)

  useEffect(() => {
    if (!window.aicli || !IMAGE_EXT.has(extOf(file.name))) return
    window.aicli.getAttachmentThumbnail(file.path).then(setThumbnail)
  }, [file.path, file.name])

  function open() {
    window.aicli?.openGeneratedFile(file.path)
  }

  function reveal(e: React.MouseEvent) {
    e.stopPropagation()
    window.aicli?.revealGeneratedFile(file.path)
  }

  if (thumbnail) {
    return (
      <div className="cooperative-generated-file cooperative-generated-file-image" onClick={open} title={file.name}>
        <img src={thumbnail} alt={file.name} />
        <span className="cooperative-generated-file-name">{file.name}</span>
        <button className="link-btn cooperative-reveal-btn" onClick={reveal} title="Reveal in folder">
          📁
        </button>
      </div>
    )
  }

  return (
    <div className="cooperative-generated-file" onClick={open} title={file.path}>
      <span className="cooperative-generated-file-icon">📎</span>
      <span className="cooperative-generated-file-name">{file.name}</span>
      <button className="link-btn cooperative-reveal-btn" onClick={reveal} title="Reveal in folder">
        📁
      </button>
    </div>
  )
}

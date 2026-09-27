import { useState } from 'react'

interface Props {
  question: string
  round: number
  maxRounds: number
  onAnswer: (answer: string) => void
}

export default function ClarifyPrompt({ question, round, maxRounds, onAnswer }: Props) {
  const [text, setText] = useState('')

  function submit() {
    if (!text.trim()) return
    onAnswer(text.trim())
  }

  return (
    <div className="cooperative-clarify-prompt">
      <div className="cooperative-clarify-question">
        ❓ needs clarification (round {round} of {maxRounds}): {question}
      </div>
      <div className="cooperative-clarify-row">
        <input
          autoFocus
          value={text}
          placeholder="Your answer..."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button disabled={!text.trim()} onClick={submit}>
          Send
        </button>
      </div>
    </div>
  )
}

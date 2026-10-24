'use client'
import { useState } from 'react'

type Question = {
  message: string
  input: boolean
  resolve: (value: string | null) => void
}
export function useWorkspaceDialog() {
  const [question, setQuestion] = useState<Question | null>(null),
    [value, setValue] = useState('')
  function ask(message: string, initial?: string): Promise<string | null> {
    setValue(initial || '')
    return new Promise((resolve) =>
      setQuestion({ message, input: initial !== undefined, resolve }),
    )
  }
  function close(answer: string | null) {
    question?.resolve(answer)
    setQuestion(null)
  }
  const dialog = question && (
    <div className="modal-backdrop" onClick={() => close(null)}>
      <section
        className="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close(null)
          if (e.key === 'Tab') {
            const nodes =
              e.currentTarget.querySelectorAll<HTMLElement>('input,button')
            const first = nodes[0],
              last = nodes[nodes.length - 1]
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first.focus()
            }
          }
        }}
      >
        <h2 id="workspace-dialog-title">
          {question.input ? '文件路径' : '确认操作'}
        </h2>
        <p>{question.message}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            close(question.input ? value.trim() : 'yes')
          }}
        >
          {question.input && (
            <input
              autoFocus
              aria-label="文件路径"
              value={value}
              maxLength={160}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          <div>
            <button
              type="button"
              autoFocus={!question.input}
              onClick={() => close(null)}
            >
              取消
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={question.input && !value.trim()}
            >
              确认
            </button>
          </div>
        </form>
      </section>
    </div>
  )
  return { ask, dialog }
}

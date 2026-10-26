'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'

const focusableControls = 'input:not(:disabled),button:not(:disabled)'

export function WorkspaceDialogFrame({
  titleId,
  onClose,
  dismissible = true,
  children,
}: {
  titleId: string
  onClose: () => void
  dismissible?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.querySelector<HTMLElement>(focusableControls)?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  return (
    <div className="modal-backdrop" onClick={() => dismissible && onClose()}>
      <section
        ref={ref}
        className="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && dismissible) {
            e.preventDefault()
            onClose()
          }
          if (e.key === 'Tab') {
            const nodes =
              e.currentTarget.querySelectorAll<HTMLElement>(focusableControls)
            const first = nodes[0],
              last = nodes[nodes.length - 1]
            if (!first) {
              e.preventDefault()
              e.currentTarget.focus()
            } else if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first.focus()
            }
          }
        }}
      >
        {children}
      </section>
    </div>
  )
}

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
    <WorkspaceDialogFrame
      titleId="workspace-dialog-title"
      onClose={() => close(null)}
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
            aria-label="文件路径"
            value={value}
            maxLength={160}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <div className="workspace-dialog-actions">
          <button type="button" onClick={() => close(null)}>
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
    </WorkspaceDialogFrame>
  )
  return { ask, dialog }
}

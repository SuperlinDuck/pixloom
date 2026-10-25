'use client'
import { useEffect, useRef, useState } from 'react'
import { installPreviewAuthBridge } from '@/lib/cloud/preview-bridge'

export function TrustedPreview({
  artifactId,
  projectId,
  title,
  className,
}: {
  artifactId: string
  projectId: string
  title: string
  className?: string
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let dispose: (() => void) | undefined
    let token: string | undefined
    let renewing = false
    const controller = new AbortController()
    const refresh = async () => {
      if (!active || renewing) return
      renewing = true
      try {
        const response = await fetch(
          `/api/projects/${projectId}/preview-access`,
          {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artifactId, ...(token ? { token } : {}) }),
          },
        )
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '预览加载失败')
        if (!active || !frame.current) return
        setError('')
        if (!dispose)
          dispose = installPreviewAuthBridge(
            frame.current,
            artifactId,
            data.base,
          )
        token = data.token || undefined
      } catch (error) {
        if (active) setError((error as Error).message)
      } finally {
        renewing = false
      }
    }
    setError('')
    void refresh()
    // Renew the same capability without reloading the app or extending a container lifetime.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 5 * 60000)
    const focus = () => {
      void refresh()
    }
    window.addEventListener('focus', focus)
    return () => {
      active = false
      controller.abort()
      dispose?.()
      window.clearInterval(timer)
      window.removeEventListener('focus', focus)
    }
  }, [artifactId, projectId, attempt])
  return (
    <>
      <iframe
        ref={frame}
        title={title}
        className={className}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
      {error && (
        <div className="preview-access-error" role="alert">
          <p>{error}</p>
          <button onClick={() => setAttempt((n) => n + 1)}>重新加载预览</button>
        </div>
      )}
    </>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { startWorkspacePolling } from '@/lib/workspace-polling'

export function useWorkspacePolling(
  key: string | null,
  run: (signal: AbortSignal) => Promise<void>,
  interval: number,
  onError: (error: Error) => void,
) {
  const latest = useRef({ run, interval, onError })
  latest.current = { run, interval, onError }
  const polling = useRef<ReturnType<typeof startWorkspacePolling> | null>(null)
  useEffect(() => {
    if (key === null) return
    const instance = startWorkspacePolling({
      run: (signal) => latest.current.run(signal),
      interval: () => latest.current.interval,
      onError: (error) => latest.current.onError(error),
    })
    polling.current = instance
    return () => {
      instance.stop()
      polling.current = null
    }
  }, [key])
  useEffect(() => {
    polling.current?.reschedule()
  }, [interval])
}

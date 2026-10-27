// Poll only after the previous request settles. Slow/offline servers must never
// accumulate requests, including when visibility changes during an abort.
export function startWorkspacePolling(options: {
  run: (signal: AbortSignal) => Promise<void>
  interval: () => number
  onError: (error: Error) => void
  timeout?: number
}) {
  let stopped = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  const available = () =>
    document.visibilityState !== 'hidden' && navigator.onLine !== false
  const clear = () => clearTimeout(timer)
  const schedule = (delay: number) => {
    clear()
    if (!stopped && available()) timer = setTimeout(() => void run(), delay)
  }
  const delay = () =>
    Math.max(
      options.interval(),
      failures ? Math.min(60000, 5000 * 2 ** (failures - 1)) : 0,
    )
  const run = async () => {
    if (stopped || controller || !available()) return
    const request = new AbortController()
    controller = request
    const timeout = setTimeout(
      () => request.abort(new Error('请求超时，请检查网络或服务状态。')),
      options.timeout ?? 15000,
    )
    try {
      await options.run(request.signal)
      if (!request.signal.aborted) failures = 0
    } catch (error) {
      if (
        !stopped &&
        available() &&
        request.signal.reason?.name !== 'AbortError'
      ) {
        failures++
        options.onError(error as Error)
      }
    } finally {
      const paused = request.signal.reason?.name === 'AbortError'
      clearTimeout(timeout)
      // Cancel siblings if a parallel request failed early.
      request.abort()
      controller = undefined
      schedule(paused ? 0 : delay())
    }
  }
  const resume = () => {
    clear()
    if (!available()) controller?.abort()
    else if (!controller) void run()
  }
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('online', resume)
  window.addEventListener('offline', resume)
  void run()
  return {
    reschedule: () => {
      if (!controller) schedule(delay())
    },
    stop: () => {
      stopped = true
      clear()
      controller?.abort()
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', resume)
    },
  }
}

export async function readWorkspaceJson<T>(url: string, signal?: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(
    () => controller.abort(new Error('请求超时，请检查网络或服务状态。')),
    15000,
  )
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    })
    const data = await response.json()
    controller.signal.throwIfAborted()
    if (!response.ok) {
      if (response.status === 401)
        window.dispatchEvent(new Event('pixloom:unauthorized'))
      throw new Error(data.error || '请求失败')
    }
    return data as T
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

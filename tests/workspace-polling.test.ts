import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readWorkspaceJson,
  startWorkspacePolling,
} from '../src/lib/workspace-polling'

let page: EventTarget & { visibilityState: string }
let browser: EventTarget
let network: { onLine: boolean }
const stops: (() => void)[] = []
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const poll = (options: Parameters<typeof startWorkspacePolling>[0]) => {
  const polling = startWorkspacePolling(options)
  stops.push(polling.stop)
  return polling
}
beforeEach(() => {
  vi.useFakeTimers()
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  browser = new EventTarget()
  network = { onLine: true }
  vi.stubGlobal('document', page)
  vi.stubGlobal('window', browser)
  vi.stubGlobal('navigator', network)
})
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('workspace polling', () => {
  it('waits for slow requests before scheduling another round', async () => {
    let finish!: () => void
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    poll({ run, interval: () => 5000, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(12000)
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await flush()
    await vi.advanceTimersByTimeAsync(4999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('uses a slower idle interval and can switch back to active polling', async () => {
    let interval = 30000
    const run = vi.fn(async () => {})
    const polling = poll({ run, interval: () => interval, onError: vi.fn() })
    await flush()
    await vi.advanceTimersByTimeAsync(29999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
    interval = 5000
    polling.reschedule()
    await vi.advanceTimersByTimeAsync(5000)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('aborts timed out reads, backs off repeated failures and resets after recovery', async () => {
    const errors = vi.fn()
    let healthy = false
    const run = vi.fn((signal: AbortSignal) => {
      if (healthy) return Promise.resolve()
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    })
    poll({ run, interval: () => 5000, timeout: 1000, onError: errors })
    await vi.advanceTimersByTimeAsync(1000)
    expect(errors.mock.calls[0][0].message).toContain('超时')
    await vi.advanceTimersByTimeAsync(5000)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(9999)
    expect(run).toHaveBeenCalledTimes(2)
    healthy = true
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(5000)
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('pauses hidden and offline pages, resumes once, and cancels on navigation', async () => {
    const signals: AbortSignal[] = []
    const errors = vi.fn()
    const run = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      })
    })
    const polling = poll({ run, interval: () => 5000, onError: errors })
    page.visibilityState = 'hidden'
    page.dispatchEvent(new Event('visibilitychange'))
    expect(signals[0].aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(60000)
    expect(run).toHaveBeenCalledTimes(1)
    page.visibilityState = 'visible'
    page.dispatchEvent(new Event('visibilitychange'))
    browser.dispatchEvent(new Event('online'))
    expect(run).toHaveBeenCalledTimes(2)
    network.onLine = false
    browser.dispatchEvent(new Event('offline'))
    await vi.advanceTimersByTimeAsync(60000)
    expect(run).toHaveBeenCalledTimes(2)
    network.onLine = true
    browser.dispatchEvent(new Event('online'))
    expect(run).toHaveBeenCalledTimes(3)
    polling.stop()
    expect(signals[2].aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(60000)
    page.dispatchEvent(new Event('visibilitychange'))
    expect(run).toHaveBeenCalledTimes(3)
    expect(errors).not.toHaveBeenCalled()
  })

  it('does not start while hidden or overlap a request still settling after abort', async () => {
    page.visibilityState = 'hidden'
    let finish!: () => void
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    poll({ run, interval: () => 5000, onError: vi.fn() })
    expect(run).not.toHaveBeenCalled()
    page.visibilityState = 'visible'
    page.dispatchEvent(new Event('visibilitychange'))
    page.visibilityState = 'hidden'
    page.dispatchEvent(new Event('visibilitychange'))
    page.visibilityState = 'visible'
    page.dispatchEvent(new Event('visibilitychange'))
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancels unfinished parallel requests when one fails', async () => {
    let sibling!: AbortSignal
    poll({
      interval: () => 30000,
      onError: vi.fn(),
      run: async (signal) => {
        sibling = signal
        await Promise.all([
          Promise.reject(new Error('unavailable')),
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason))
          }),
        ])
      },
    })
    await flush()
    expect(sibling.aborted).toBe(true)
  })
})

describe('workspace reads', () => {
  it('times out stalled reads and propagates cancellation', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options: RequestInit) => {
        const signal = options.signal!
        signals.push(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason))
        })
      }),
    )
    const timedOut = expect(readWorkspaceJson('/api/status')).rejects.toThrow(
      '超时',
    )
    await vi.advanceTimersByTimeAsync(15000)
    await timedOut
    expect(signals[0].aborted).toBe(true)
    const controller = new AbortController()
    const cancelled = expect(
      readWorkspaceJson('/api/projects/old', controller.signal),
    ).rejects.toThrow()
    controller.abort()
    await cancelled
    expect(signals[1].aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps unauthorized handling and clears timeout after successful reads', async () => {
    const unauthorized = vi.fn()
    browser.addEventListener('pixloom:unauthorized', unauthorized)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: '登录过期' }, { status: 401 })),
    )
    await expect(readWorkspaceJson('/api/projects')).rejects.toThrow('登录过期')
    expect(unauthorized).toHaveBeenCalledOnce()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ workerOnline: true })),
    )
    expect(await readWorkspaceJson('/api/status')).toEqual({
      workerOnline: true,
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})

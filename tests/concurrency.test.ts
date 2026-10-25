import { afterEach, describe, expect, it, vi } from 'vitest'
import { Semaphore } from '../src/lib/concurrency'
import { ModelRequestLimiter } from '../src/lib/ai/request-limiter'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('shared resource slots', () => {
  it('bounds execution, preserves FIFO order and removes cancelled waiters', async () => {
    const slots = new Semaphore(() => 1)
    const first = deferred()
    const started: number[] = []
    const running = slots.run(undefined, async () => {
      started.push(1)
      await first.promise
    })
    const controller = new AbortController()
    const cancelled = slots.run(controller.signal, async () => {
      started.push(2)
    })
    const assertion = expect(cancelled).rejects.toThrow('cancelled')
    const next = slots.run(undefined, async () => {
      started.push(3)
      throw new Error('failed')
    })
    const failure = expect(next).rejects.toThrow('failed')
    const last = slots.run(undefined, async () => {
      started.push(4)
    })
    controller.abort(new Error('cancelled'))
    await assertion
    expect(started).toEqual([1])
    first.resolve()
    await Promise.all([running, failure, last])
    expect(started).toEqual([1, 3, 4])
    expect(slots.busy).toBe(false)
  })

  it('limits model calls and shares an extended cooldown only with the same origin', async () => {
    vi.useFakeTimers()
    vi.stubEnv('PIXLOOM_MODEL_CONCURRENCY', '2')
    const limiter = new ModelRequestLimiter()
    const controller = new AbortController()
    const origin = 'https://model.example'
    limiter.defer(origin, 5000)
    const started: string[] = []
    const delayed = limiter.run(origin + '/v1', controller.signal, async () => {
      started.push('delayed')
    })
    await limiter.run(
      'https://other.example/v1',
      controller.signal,
      async () => {
        started.push('other')
      },
    )
    expect(started).toEqual(['other'])
    await vi.advanceTimersByTimeAsync(3000)
    limiter.defer(origin, 5000)
    await vi.advanceTimersByTimeAsync(4999)
    expect(started).toEqual(['other'])
    await vi.advanceTimersByTimeAsync(1)
    await delayed
    expect(started).toEqual(['other', 'delayed'])
  })

  it('does not start queued model work after cancellation or leak slots during cooldown', async () => {
    vi.useFakeTimers()
    vi.stubEnv('PIXLOOM_MODEL_CONCURRENCY', '1')
    const limiter = new ModelRequestLimiter()
    limiter.defer('https://model.example', 5000)
    const controller = new AbortController()
    const operation = vi.fn(async () => {})
    const waiting = limiter.run(
      'https://model.example/v1',
      controller.signal,
      operation,
    )
    const assertion = expect(waiting).rejects.toThrow('cancelled')
    await vi.advanceTimersByTimeAsync(0)
    const queuedController = new AbortController()
    const queued = limiter.run(
      'https://other.example/v1',
      queuedController.signal,
      operation,
    )
    const queuedAssertion = expect(queued).rejects.toThrow('cancelled')
    queuedController.abort(new Error('cancelled'))
    controller.abort(new Error('cancelled'))
    await Promise.all([assertion, queuedAssertion])
    expect(operation).not.toHaveBeenCalled()
    await limiter.run(
      'https://other.example/v1',
      new AbortController().signal,
      operation,
    )
    expect(operation).toHaveBeenCalledTimes(1)
  })
})

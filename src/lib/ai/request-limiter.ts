import { Semaphore } from '../concurrency'
import { limit } from '../platform-config'

// Model calls (including titles and compaction) share slots. Cooldowns are
// scoped to the API origin; never retain URLs containing API key parameters.
export class ModelRequestLimiter {
  private readonly slots = new Semaphore(() =>
    limit('PIXLOOM_MODEL_CONCURRENCY', 3, 1, 32),
  )
  readonly cooldowns = new Map<string, number>()

  defer(origin: string, delay: number) {
    this.cooldowns.set(
      origin,
      Math.max(this.cooldowns.get(origin) || 0, Date.now() + delay),
    )
  }

  async run<T>(url: string, signal: AbortSignal, operation: () => Promise<T>) {
    return this.slots.run(signal, async () => {
      await this.wait(url, signal)
      return operation()
    })
  }

  async wait(url: string, signal: AbortSignal) {
    const origin = new URL(url).origin
    while ((this.cooldowns.get(origin) || 0) > Date.now()) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
          reject(signal.reason)
        }
        const timer = setTimeout(
          () => {
            signal.removeEventListener('abort', abort)
            resolve()
          },
          Math.min(2147483647, this.cooldowns.get(origin)! - Date.now()),
        )
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
    signal.throwIfAborted()
  }
}

export const modelRequests = new ModelRequestLimiter()

// FIFO slots shared by the single Worker. Waiting never starts the operation and
// cancellation removes the waiter immediately, without consuming a slot.
export class Semaphore {
  private used = 0
  private waiters: (() => void)[] = []

  constructor(private readonly maximum: () => number) {}

  get busy() {
    return this.used >= this.maximum() || this.waiters.length > 0
  }

  async run<T>(signal: AbortSignal | undefined, operation: () => Promise<T>) {
    const release = await this.acquire(signal)
    try {
      signal?.throwIfAborted()
      return await operation()
    } finally {
      release()
    }
  }

  private acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.waiters = this.waiters.filter((waiter) => waiter !== enter)
        reject(signal!.reason)
      }
      const enter = () => {
        signal?.removeEventListener('abort', abort)
        this.used++
        resolve(() => {
          this.used--
          this.wake()
        })
      }
      if (this.used < this.maximum() && this.waiters.length === 0) enter()
      else {
        this.waiters.push(enter)
        signal?.addEventListener('abort', abort, { once: true })
      }
    })
  }

  private wake() {
    while (this.used < this.maximum() && this.waiters.length)
      this.waiters.shift()!()
  }
}

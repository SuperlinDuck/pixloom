import { Semaphore } from './concurrency'
import { limit } from './platform-config'

export const buildSlots = new Semaphore(() =>
  limit('PIXLOOM_BUILD_CONCURRENCY', 1, 1, 32),
)
export const browserSlots = new Semaphore(() =>
  limit('PIXLOOM_BROWSER_CONCURRENCY', 1, 1, 32),
)

import { limit } from './platform-config'

export const workerConcurrency = () =>
  Math.min(
    limit('PIXLOOM_WORKER_CONCURRENCY', 3, 1, 32),
    limit('PIXLOOM_MAX_RUNTIME_CONTAINERS', 3),
  )

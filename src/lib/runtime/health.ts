import { DockerRuntime } from './docker'
import type { DockerHealth } from './types'
let cache: { until: number; result: Promise<DockerHealth> } | undefined
export function runtimeHealth(refresh = false) {
  if (!cache || refresh || cache.until < Date.now())
    cache = { until: Date.now() + 5000, result: new DockerRuntime().health() }
  return cache.result
}

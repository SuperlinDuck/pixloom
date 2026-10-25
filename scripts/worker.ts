import { maintenanceMode } from '../src/lib/maintenance'
import { reapEnvironments } from '../src/lib/runtime/lifecycle'
import { DockerRuntime } from '../src/lib/runtime/docker'
import { assertProductionConfig } from '../src/lib/platform-config'
import { cleanupOrphanedTestAccounts } from '../src/lib/cloud/test-account'
import { loadEnvConfig } from '@next/env'
import { randomUUID } from 'node:crypto'
import { acquireWorker, heartbeat, releaseWorker } from '../src/lib/store'
import { runTask } from '../src/lib/runner'
import { WorkerScheduler } from '../src/lib/worker-scheduler'
import { workerConcurrency } from '../src/lib/worker-config'

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')
assertProductionConfig()
const owner = randomUUID()
const shutdown = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => shutdown.abort())
async function main() {
  if (!acquireWorker(owner))
    throw new Error('已有 Worker 正在运行。退出后请等待 15 秒再重启。')
  console.log(`Pixloom Worker 已启动，任务并发 ${workerConcurrency()}。`)
  const pulse = setInterval(() => {
    if (!heartbeat(owner)) shutdown.abort()
  }, 3000)
  const runtime = new DockerRuntime()
  const scheduler = new WorkerScheduler(
    owner,
    (task) => runTask(task, runtime, shutdown.signal, owner),
    () => {
      console.error('任务执行异常，停止领取任务；重启后从检查点恢复。')
      process.exitCode = 1
      shutdown.abort()
    },
  )
  try {
    let cleaned = false
    let lastReap = 0
    while (!shutdown.signal.aborted) {
      // Keep the heartbeat alive, but never resume tasks or upstream cleanup during cutover.
      if (maintenanceMode()) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        continue
      }
      if (!cleaned) {
        await cleanupOrphanedTestAccounts()
        cleaned = true
      }
      if (Date.now() - lastReap > 30000) {
        lastReap = Date.now()
        try {
          await reapEnvironments(runtime, owner)
        } catch {
          console.error('环境回收失败，请检查 Docker；下轮重试。')
        }
      }
      if (!shutdown.signal.aborted && !maintenanceMode()) scheduler.dispatch()
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  } finally {
    shutdown.abort()
    await scheduler.drain()
    clearInterval(pulse)
    releaseWorker(owner)
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

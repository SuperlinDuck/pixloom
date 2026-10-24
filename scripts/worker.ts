import { loadEnvConfig } from '@next/env'
import { randomUUID } from 'node:crypto'
import {
  acquireWorker,
  claimTask,
  heartbeat,
  releaseWorker,
} from '../src/lib/store'
import { runTask } from '../src/lib/runner'
import { claimRuntimeJob } from '../src/lib/runtime/store'
import { runRuntimeJob } from '../src/lib/runtime/runner'

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')
const owner = randomUUID()
const shutdown = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => shutdown.abort())
async function main() {
  if (!acquireWorker(owner))
    throw new Error('已有 Worker 正在运行。退出后请等待 15 秒再重启。')
  console.log('Pixloom Worker 已启动，等待生成任务。')
  const pulse = setInterval(() => {
    if (!heartbeat(owner)) shutdown.abort()
  }, 3000)
  try {
    while (!shutdown.signal.aborted) {
      const task = claimTask()
      if (task) await runTask(task, undefined, shutdown.signal)
      else {
        const runtimeJob = claimRuntimeJob()
        if (runtimeJob)
          await runRuntimeJob(runtimeJob, undefined, shutdown.signal)
        else await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  } finally {
    clearInterval(pulse)
    releaseWorker(owner)
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

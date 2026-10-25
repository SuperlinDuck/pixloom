import { freemem, totalmem } from 'node:os'
import { readFileSync } from 'node:fs'
import { loadEnvConfig } from '@next/env'
import { statfsSync } from 'node:fs'
import { db, workerOnline } from '../src/lib/store'
import { DockerRuntime } from '../src/lib/runtime/docker'
import { dailyUsage } from '../src/lib/tenancy'
import { assertProductionConfig } from '../src/lib/platform-config'
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')
async function main() {
  const checks: { name: string; ok: boolean; detail: unknown }[] = []
  try {
    assertProductionConfig()
    checks.push({ name: 'configuration', ok: true, detail: 'ok' })
  } catch (error) {
    checks.push({
      name: 'configuration',
      ok: false,
      detail: (error as Error).message,
    })
  }
  const integrity = db().prepare('PRAGMA quick_check').get() as {
    quick_check: string
  }
  checks.push({
    name: 'sqlite',
    ok: integrity.quick_check === 'ok',
    detail: integrity.quick_check,
  })
  checks.push({
    name: 'worker',
    ok: workerOnline(),
    detail: workerOnline() ? 'online' : 'offline',
  })
  const fs = statfsSync(process.env.PIXLOOM_DATA_DIR || '.pixloom')
  const free = fs.bavail * fs.bsize,
    total = fs.blocks * fs.bsize
  checks.push({
    name: 'disk',
    ok: free > 1024 ** 3 && free / total > 0.15,
    detail: { free, total },
  })
  let available = freemem()
  if (process.platform === 'linux') {
    const kb = readFileSync('/proc/meminfo', 'utf8').match(
      /^MemAvailable:\s+(\d+) kB/m,
    )?.[1]
    if (kb) available = Number(kb) * 1024
  }
  checks.push({
    name: 'memory',
    ok: available / totalmem() > 0.1,
    detail: { available, total: totalmem() },
  })
  for (const [name, url] of [
    ['web', 'http://127.0.0.1:3000/api/health'],
    ['gateway', 'http://127.0.0.1:4180/_pixloom/health'],
  ]) {
    try {
      const result = await fetch(
        url.replace(':4180', `:${process.env.PIXLOOM_GATEWAY_PORT || 4180}`),
        { signal: AbortSignal.timeout(3000) },
      )
      checks.push({ name, ok: result.ok, detail: result.status })
      await result.body?.cancel()
    } catch {
      checks.push({ name, ok: false, detail: 'unreachable' })
    }
  }
  const runtime = await new DockerRuntime().health()
  checks.push({
    name: 'docker',
    ok: runtime.available && runtime.imageReady,
    detail: runtime.reason || 'ok',
  })
  const queue = db()
    .prepare(
      "SELECT count(*) AS count, min(createdAt) AS oldest FROM tasks WHERE status IN ('queued','running')",
    )
    .get() as { count: number; oldest: string | null }
  checks.push({
    name: 'queue',
    ok: !queue.oldest || Date.now() - Date.parse(queue.oldest) < 15 * 60000,
    detail: queue,
  })
  const daily = dailyUsage()
  checks.push({
    name: 'ai-budget',
    ok: daily.used < daily.limit * 0.9,
    detail: daily,
  })
  const pending = db()
    .prepare(
      "SELECT count(*) AS count FROM usage_ledger WHERE status='reserved' AND createdAt<?",
    )
    .get(Date.now() - 15 * 60000)
  checks.push({
    name: 'unconfirmed-usage',
    ok: (pending as { count: number }).count === 0,
    detail: pending,
  })
  console.log(JSON.stringify(checks, null, 2))
  if (checks.some((check) => !check.ok)) process.exitCode = 1
}
main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => db().close())

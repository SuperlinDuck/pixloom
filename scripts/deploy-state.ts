import { loadEnvConfig } from '@next/env'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { assertProductionConfig } from '../src/lib/platform-config'
import { MAINTENANCE_FILE, maintenanceMode } from '../src/lib/maintenance'
import { DockerRuntime, dockerCommand } from '../src/lib/runtime/docker'

loadEnvConfig(process.cwd(), false)
assertProductionConfig()
async function main() {
  if (process.getuid?.() === 0)
    throw new Error('部署准备步骤必须以 pixloom 用户运行')
  if (process.versions.node.split('.')[0] !== '24')
    throw new Error('VPS 部署要求 Node.js 24')
  if (
    process.env.PIXLOOM_DATA_DIR !== '/srv/pixloom/data' ||
    process.env.PIXLOOM_PUBLISH_DIR !== '/srv/pixloom/published'
  )
    throw new Error(
      '自动部署要求 /srv/pixloom/data 和 /srv/pixloom/published，请先迁移配置',
    )
  if (
    (process.env.PIXLOOM_GATEWAY_PORT || '4180') !== '4180' ||
    (process.env.PORT || '3000') !== '3000' ||
    (process.env.PIXLOOM_NEXT_DIST_DIR &&
      process.env.PIXLOOM_NEXT_DIST_DIR !== '.next')
  )
    throw new Error('自动部署要求 Web 3000、Gateway 4180 和默认 .next 目录')
  if (new URL(process.env.PIXLOOM_AUTH_URL!).port)
    throw new Error('自动部署的 HTTPS 工作台使用标准 443 端口')
  if (existsSync('.env.local'))
    throw new Error('生产 release 中不能存在 .env.local')
  switch (process.argv[2]) {
    case 'preflight': {
      if (
        process.env.DOCKER_HOST ||
        (process.env.DOCKER_CONTEXT && process.env.DOCKER_CONTEXT !== 'default')
      )
        throw new Error('自动部署要求本机 Docker Engine 默认 context')
      const context = await dockerCommand(['context', 'show'])
      if (context.code || context.stdout.trim() !== 'default')
        throw new Error('pixloom 用户必须使用本机 Docker 默认 context')
      if (!(await new DockerRuntime().health()).available)
        throw new Error('pixloom 用户无法连接 Docker Engine')
      const browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
        timeout: 10000,
        env: Object.fromEntries(
          ['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap((key) =>
            process.env[key] ? [[key, process.env[key]!]] : [],
          ),
        ),
      })
      await browser.close()
      console.log(JSON.stringify({ origin: process.env.PIXLOOM_AUTH_URL }))
      return
    }
    case 'drain': {
      if (!maintenanceMode()) throw new Error('排空任务前必须启用维护模式')
      const file = path.join(process.env.PIXLOOM_DATA_DIR!, 'pixloom-v3.db')
      if (!existsSync(file)) return
      const connection = new DatabaseSync(file, { readOnly: true })
      try {
        if (
          !connection
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'",
            )
            .get()
        )
          return
        const started = Date.now()
        let quiet = 0
        while (Date.now() - started < 330000) {
          const running = (
            connection
              .prepare("SELECT count(*) AS n FROM tasks WHERE status='running'")
              .get() as { n: number }
          ).n
          if (!running) {
            if (++quiet >= 2) return
          } else quiet = 0
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        throw new Error('任务未能排空，保留旧版；请确认 Worker 状态后重试')
      } finally {
        connection.close()
      }
      break
    }
    case 'verify': {
      const connection = new DatabaseSync(
        path.join(process.env.PIXLOOM_DATA_DIR!, 'pixloom-v3.db'),
        { readOnly: true },
      )
      try {
        const result = connection.prepare('PRAGMA quick_check').get() as {
          quick_check: string
        }
        if (result.quick_check !== 'ok')
          throw new Error('SQLite integrity check failed')
      } finally {
        connection.close()
      }
      const health = await new DockerRuntime().health()
      if (!health.available || !health.imageReady)
        throw new Error('Docker runtime not ready')
      return
    }
    case 'reset': {
      if (!maintenanceMode())
        throw new Error(`移除旧运行环境前必须启用 ${MAINTENANCE_FILE}`)
      // The controller has stopped all three writers and taken a cold snapshot.
      const { db, setRuntime } = await import('../src/lib/store')
      const runtime = new DockerRuntime()
      try {
        db().prepare('DELETE FROM worker').run()
        const ids = new Set([
          ...(await runtime.managedProjects()),
          ...(
            db()
              .prepare(
                "SELECT projectId FROM runtime_workspaces WHERE state!='absent'",
              )
              .all() as { projectId: string }[]
          ).map((row) => row.projectId),
        ])
        for (const id of Array.from(ids)) {
          await runtime.remove(id)
          if (db().prepare('SELECT 1 FROM projects WHERE id=?').get(id))
            setRuntime(id, 'absent')
        }
      } finally {
        db().close()
      }
      return
    }
    default:
      throw new Error('支持 preflight / drain / reset / verify')
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

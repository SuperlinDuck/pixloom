import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { chromium } from 'playwright'
import { DockerRuntime } from '../src/lib/runtime/docker'
import { templateFiles } from '../src/lib/runtime/template'
import {
  acquireWorker,
  claimTask,
  createProject,
  db,
  enqueueTask,
  getDraft,
  getProject,
  getTask,
  heartbeat,
  updateDraft,
} from '../src/lib/store'
import { liveRelease, getRelease } from '../src/lib/publication/store'
import {
  publicationConfig,
  caddyConfig,
  publicationTarget,
} from '../src/lib/publication/config'
import { createPublicationGateway } from '../src/lib/publication/gateway'
import { runTask } from '../src/lib/runner'
import { POST } from '../src/app/api/projects/[id]/releases/route'

async function freePort() {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}
async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pixloom-publication-'))
  process.env.PIXLOOM_DATA_DIR = directory
  process.env.PIXLOOM_PUBLISH_DIR = path.join(directory, 'published')
  process.env.PIXLOOM_PUBLISH_ENABLED = '1'
  process.env.PIXLOOM_PUBLISH_DOMAIN = 'apps.localhost'
  process.env.PIXLOOM_GATEWAY_PORT = String(await freePort())
  const publicPort = await freePort()
  process.env.PIXLOOM_PUBLISH_PORT = String(publicPort)
  const config = publicationConfig()
  let gateway = createPublicationGateway(config)
  const runtime = new DockerRuntime()
  const files = await templateFiles()
  const app = files.find((file) => file.path === 'src/App.jsx')!
  app.content = app.content
    .replace(
      "import React, { useState } from 'react'",
      "import React, { useState, lazy, Suspense } from 'react'\nconst Lazy = lazy(() => import('./Lazy.jsx'))",
    )
    .replace(
      '<footer>',
      '<Suspense fallback={null}><Lazy /></Suspense><footer>',
    )
  files.push({
    path: 'src/Lazy.jsx',
    content:
      'import React from "react"; export default () => <p>发布动态模块</p>',
  })
  const project = createProject('Publication integration', files)
  const owner = 'publication-verifier'
  let caddy: ReturnType<typeof spawn> | undefined,
    browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let pulse: ReturnType<typeof setInterval> | undefined
  try {
    const build = async (initialize = false) => {
      const state = getProject(project.id)
      enqueueTask(
        project.id,
        initialize ? 'initialize' : 'commit',
        state.draft.revision,
        state.project.currentVersionId,
      )
      const task = claimTask()!
      await runTask(task, runtime)
      assert.equal(
        getTask(task.id).status,
        'completed',
        getTask(task.id).error || '构建失败',
      )
      return getProject(project.id).project.currentVersionId!
    }
    const v1 = await build(true)
    await runtime.remove(project.id)
    acquireWorker(owner)
    pulse = setInterval(() => heartbeat(owner), 3000)
    await new Promise<void>((resolve, reject) => {
      gateway.once('error', reject)
      gateway.listen(config.port, '127.0.0.1', resolve)
    })
    const env = {
      NODE_ENV: 'production' as const,
      ...Object.fromEntries(
        ['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap((key) =>
          process.env[key] ? [[key, process.env[key]!]] : [],
        ),
      ),
      XDG_DATA_HOME: path.join(directory, 'caddy-data'),
      XDG_CONFIG_HOME: path.join(directory, 'caddy-config'),
    }
    const binary = process.env.PIXLOOM_CADDY_BIN || 'caddy'
    const production = path.join(directory, 'Caddyfile.production'),
      local = path.join(directory, 'Caddyfile.local')
    await writeFile(production, caddyConfig(config))
    await writeFile(local, caddyConfig(config, publicPort))
    try {
      await promisify(execFile)(
        binary,
        ['validate', '--config', production, '--adapter', 'caddyfile'],
        { env, timeout: 15000 },
      )
    } catch {
      throw new Error(
        'Caddy 配置验证失败：请安装 Caddy 或设置 PIXLOOM_CADDY_BIN 到可信可执行文件',
      )
    }
    caddy = spawn(
      binary,
      ['run', '--config', local, '--adapter', 'caddyfile'],
      { env, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let exited = false,
      log = ''
    caddy.once('exit', () => {
      exited = true
    })
    caddy.once('error', () => {
      exited = true
    })
    caddy.stderr!.on('data', (chunk) => {
      log = (log + chunk.toString()).slice(-3000)
    })
    const target = publicationTarget(project.id, config)
    const request = (pathname = '/') =>
      new Promise<{ status: number }>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: publicPort,
            path: pathname,
            headers: { Host: target.domain },
            timeout: 3000,
          },
          (response) => {
            response.resume()
            resolve({ status: response.statusCode! })
          },
        )
        req.on('error', reject)
        req.on('timeout', () => req.destroy(new Error('Caddy request timeout')))
        req.end()
      })
    let ready = false
    for (let i = 0; i < 50 && !exited; i++) {
      try {
        ready = (await request()).status === 404
        if (ready) break
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(ready, `Caddy 未启动：${log}`)
    const release = async (input: Record<string, unknown>, ok = true) => {
      const response = await POST(
        new Request('http://localhost/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...input,
            expectedReleaseId: liveRelease(project.id)?.id || null,
          }),
        }),
        { params: { id: project.id } },
      )
      const result = await response.json()
      assert.equal(response.status, 202, JSON.stringify(result))
      const task = claimTask(owner)!
      await runTask(task, undefined, undefined, owner)
      assert.equal(
        getTask(task.id).status,
        ok ? 'completed' : 'failed',
        getTask(task.id).error || '发布失败',
      )
      return getRelease(result.release.id)
    }
    const r1 = await release({ action: 'publish', versionId: v1 })
    assert.equal((await request()).status, 200)
    assert.equal((await request('/_pixloom/health')).status, 404)
    assert.equal((await request('/api/projects')).status, 404)
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      timeout: 10000,
      env,
      channel:
        process.env.PIXLOOM_BROWSER_CHANNEL === 'chrome' ||
        !existsSync(chromium.executablePath())
          ? 'chrome'
          : undefined,
    })
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === target.url
        ? route.continue()
        : route.abort(),
    )
    await context.routeWebSocket('**/*', (socket) => socket.close())
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(target.url, { waitUntil: 'networkidle', timeout: 15000 })
    await page.getByText('发布动态模块', { exact: true }).waitFor()
    assert.equal(await page.locator('output').innerText(), '0')
    await page.getByRole('button', { name: '加一', exact: true }).click()
    await page.waitForFunction(
      () => document.querySelector('output')?.textContent === '1',
    )
    updateDraft(project.id, getDraft(project.id).revision, [
      {
        type: 'write',
        path: 'src/App.jsx',
        content: app.content.replace('useState(0)', 'useState(7)'),
      },
    ])
    const v2 = await build()
    await release({ action: 'publish', versionId: v2 })
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('output').innerText(), '7')
    assert.equal(
      (await request(`/api/previews/${r1.artifactId}/index.html`)).status,
      200,
    )
    updateDraft(project.id, getDraft(project.id).revision, [
      {
        type: 'write',
        path: 'src/App.jsx',
        content:
          app.content + '\nthrow new Error("publication-runtime-error")\n',
      },
    ])
    const broken = await build()
    await release({ action: 'publish', versionId: broken }, false)
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('output').innerText(), '7')
    await release({ action: 'rollback', releaseId: r1.id })
    assert.equal(getProject(project.id).project.currentVersionId, broken)
    await new Promise<void>((resolve) => gateway.close(() => resolve()))
    gateway = createPublicationGateway(config)
    await new Promise<void>((resolve) =>
      gateway.listen(config.port, '127.0.0.1', resolve),
    )
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('output').innerText(), '0')
    assert.deepEqual(errors, [])
    await release({ action: 'unpublish' })
    assert.equal((await request()).status, 404)
    assert.equal(
      (await request(`/api/previews/${r1.artifactId}/index.html`)).status,
      404,
    )
    const ask = await fetch(
      `http://127.0.0.1:${config.port}/_pixloom/allow-domain?domain=${target.domain}`,
    )
    assert.equal(ask.status, 403)
    console.log(
      'PASS Docker 版本 → 发布 API/Worker → 磁盘产物 → 真实 Caddy → 浏览器交互/动态模块 → 更新/旧资源 → 失败保留 → 回滚 → 网关重启 → 下线。未申请公网证书。',
    )
  } finally {
    if (pulse) clearInterval(pulse)
    await browser?.close()
    if (caddy && caddy.exitCode === null && caddy.pid) {
      const stopped = new Promise((resolve) => caddy!.once('exit', resolve))
      caddy.kill('SIGTERM')
      await stopped
    }
    await new Promise<void>((resolve) => gateway.close(() => resolve()))
    try {
      await runtime.remove(project.id)
    } finally {
      db().close()
      delete (globalThis as { pixloomDb?: unknown }).pixloomDb
      await rm(directory, { recursive: true, force: true })
    }
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

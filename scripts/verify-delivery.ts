import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { DockerRuntime } from '../src/lib/runtime/docker'
import { templateFiles } from '../src/lib/runtime/template'
import {
  claimTask,
  createProject,
  db,
  enqueueTask,
  getProject,
  getTask,
} from '../src/lib/store'
import { runTask } from '../src/lib/runner'
import { GET } from '../src/app/api/projects/[id]/versions/[versionId]/export/route'

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pixloom-delivery-'))
  process.env.PIXLOOM_DATA_DIR = directory
  const runtime = new DockerRuntime()
  const files = await templateFiles()
  const app = files.find((file) => file.path === 'src/App.jsx')!
  app.content = app.content
    .replace(
      "import React, { useState } from 'react'",
      "import React, { useState, lazy, Suspense } from 'react'\nimport icon from './delivery.svg'\nconst Lazy = lazy(() => import('./Delivery.jsx'))",
    )
    .replace(
      '<footer>',
      '<img alt="交付资源" src={icon} /><Suspense fallback={null}><Lazy /></Suspense><footer>',
    )
  files.push(
    {
      path: 'src/Delivery.jsx',
      content:
        'import React from "react"; export default () => <p>动态模块已加载</p>',
    },
    {
      path: 'src/delivery.svg',
      content: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/>${'<!-- asset -->'.repeat(400)}</svg>`,
    },
  )
  const project = createProject('Delivery integration', files)
  const env = {
    NODE_ENV: 'production' as const,
    ...Object.fromEntries(
      ['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap((key) =>
        process.env[key] ? [[key, process.env[key]!]] : [],
      ),
    ),
  }
  let server: ReturnType<typeof createServer> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    enqueueTask(project.id, 'initialize', 0, null)
    const task = claimTask()!
    await runTask(task, runtime)
    assert.equal(
      getTask(task.id).status,
      'completed',
      getTask(task.id).error || '构建失败',
    )
    const versionId = getProject(project.id).project.currentVersionId!
    await runtime.remove(project.id)
    const response = await GET(new Request('http://127.0.0.1/export'), {
      params: { id: project.id, versionId },
    })
    assert.equal(response.status, 200)
    const archive = path.join(directory, 'delivery.zip')
    const unpacked = path.join(directory, 'unpacked')
    await writeFile(archive, Buffer.from(await response.arrayBuffer()))
    // An independent standard ZIP reader checks CRC, file hashes, and extraction.
    await promisify(execFile)(
      'python3',
      [
        '-c',
        `
import hashlib, json, pathlib, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None
    manifest = json.loads(z.read('manifest.json'))
    assert len(manifest['files']) == len(z.namelist()) - 1
    for f in manifest['files']:
        data = z.read(f['path'])
        assert len(data) == f['bytes']
        assert hashlib.sha256(data).hexdigest() == f['sha256']
    for name in z.namelist():
        assert not name.startswith('/') and '..' not in pathlib.PurePosixPath(name).parts
    z.extractall(sys.argv[2])
`,
        archive,
        unpacked,
      ],
      { env, timeout: 15000 },
    )

    const root = path.join(unpacked, 'site')
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
    }
    server = createServer(async (req, res) => {
      try {
        const pathname = decodeURIComponent(
          new URL(req.url!, 'http://localhost').pathname,
        )
        const target = path.resolve(
          root,
          '.' + (pathname === '/' ? '/index.html' : pathname),
        )
        if (!target.startsWith(root + path.sep)) {
          res.writeHead(403).end()
          return
        }
        if (pathname === '/favicon.ico') {
          res.writeHead(204).end()
          return
        }
        res.setHeader(
          'Content-Type',
          types[path.extname(target)] || 'application/octet-stream',
        )
        res.end(await readFile(target))
      } catch {
        res.writeHead(404).end()
      }
    })
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject)
      server!.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as { port: number }
    const origin = `http://127.0.0.1:${address.port}`
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
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    )
    await context.routeWebSocket('**/*', (socket) => socket.close())
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('response', (result) => {
      if (!result.ok()) errors.push(`HTTP ${result.status()}`)
    })
    await page.goto(origin, { waitUntil: 'networkidle', timeout: 15000 })
    await page.getByText('动态模块已加载', { exact: true }).waitFor()
    await page.waitForFunction(
      () =>
        (document.querySelector('img[alt="交付资源"]') as HTMLImageElement)
          ?.naturalWidth > 0,
    )
    assert.equal(await page.locator('output').innerText(), '0')
    await page.getByRole('button', { name: '加一', exact: true }).click()
    await page.waitForFunction(
      () => document.querySelector('output')?.textContent === '1',
    )
    await page.getByRole('button', { name: '减一', exact: true }).click()
    await page.waitForFunction(
      () => document.querySelector('output')?.textContent === '0',
    )
    assert.deepEqual(errors, [])
    assert.equal(getProject(project.id).project.currentVersionId, versionId)
    console.log(
      'PASS Docker 构建 → 移除容器 → 版本 ZIP → 标准解包与 SHA-256 → 独立静态站点 → 浏览器加减交互。',
    )
  } finally {
    await browser?.close()
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()))
    try {
      await runtime.remove(project.id)
    } finally {
      db().close()
      delete (globalThis as { pixloomDb?: unknown }).pixloomDb
      delete process.env.PIXLOOM_DATA_DIR
      await rm(directory, { recursive: true, force: true })
    }
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

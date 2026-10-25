import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { createServer as createProbe } from 'node:net'
import { spawn } from 'node:child_process'
import { caddyConfig, publicationConfig } from '../src/lib/publication/config'
async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pixloom-maintenance-'))
  let requests = 0
  const backend = createServer((_req, res) => {
    requests++
    res.end('ready')
  })
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve))
  const backendPort = (backend.address() as { port: number }).port
  const probe = createProbe()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const flag = path.join(directory, 'maintenance')
  const config = path.join(directory, 'Caddyfile')
  const values = { ...publicationConfig(), port: backendPort }
  await writeFile(config, caddyConfig(values, port, flag))
  const server = spawn(
    process.env.PIXLOOM_CADDY_BIN || 'caddy',
    ['run', '--config', config, '--adapter', 'caddyfile'],
    {
      env: {
        ...process.env,
        XDG_DATA_HOME: path.join(directory, 'data'),
        XDG_CONFIG_HOME: path.join(directory, 'config'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  let output = '',
    startupError: Error | undefined
  server.stderr.on('data', (chunk) => {
    output = (output + chunk).slice(-3000)
  })
  server.on('error', (error) => {
    startupError = error
  })
  const url = `http://127.0.0.1:${port}`
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(url)
        await response.body?.cancel()
        if (response.ok) break
      } catch {}
      if (startupError) throw startupError
      assert.ok(
        attempt < 100 && server.exitCode === null,
        `Caddy startup failed: ${output}`,
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const before = requests
    await writeFile(flag, 'maintenance')
    for (const route of [
      '/api/projects',
      '/api/auth/callback/google',
      '/cloud/v2/apps/test',
      '/api/previews/test',
    ]) {
      const response = await fetch(url + route, { method: 'POST', body: '{}' })
      assert.equal(response.status, 503)
      await response.body?.cancel()
    }
    assert.equal(
      requests,
      before,
      'maintenance requests must not reach upstream',
    )
    const internal = await fetch(`http://127.0.0.1:${backendPort}/api/health`)
    assert.equal(internal.status, 200)
    await internal.body?.cancel()
    await unlink(flag)
    const resumed = await fetch(url)
    assert.equal(resumed.status, 200)
    await resumed.body?.cancel()
    console.log(
      'PASS 真实 Caddy：维护标记阻止管理/认证/Cloud/预览请求到达 upstream，内部探活仍可用，移除标记后恢复。',
    )
  } finally {
    server.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null || startupError) resolve()
      else server.once('exit', () => resolve())
    })
    await new Promise<void>((resolve) => backend.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

const fs = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { createFileTools, validateFiles } = require('./file-tools.cjs')
const tools = createFileTools('/workspace')
const MAX_OUTPUT = 128 * 1024
async function input() {
  let text = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    text += chunk
    if (Buffer.byteLength(text) > 8 * 1024 * 1024)
      throw new Error('操作输入过大')
  }
  return JSON.parse(text)
}
async function build() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '/opt/pixloom/template/node_modules/vite/bin/vite.js',
        'build',
        '--config',
        '/opt/pixloom/template/vite.config.mjs',
        '--configLoader',
        'native',
      ],
      { cwd: '/workspace', detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let output = '',
      timedOut = false
    const append = (chunk) => {
      output = (output + chunk.toString()).slice(-MAX_OUTPUT)
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {}
    }, 90000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: timedOut ? 124 : (code ?? 1), output, timedOut })
    })
  })
}
async function main() {
  const request = await input()
  if (request.op === 'init') {
    const files = validateFiles(request.files)
    try {
      await fs.symlink(
        '/opt/pixloom/template/node_modules',
        '/workspace/node_modules',
      )
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    for (const file of files) await tools.write(file.path, file.content)
    return { ok: true }
  }
  if (request.op === 'list' || request.op === 'search') {
    const files = await tools.snapshot()
    if (request.op === 'list')
      return files.map((file) => ({
        path: file.path,
        size: Buffer.byteLength(file.content),
      }))
    if (
      typeof request.query !== 'string' ||
      !request.query ||
      request.query.length > 120
    )
      throw new Error('搜索词长度必须在 1 到 120 字之间')
    return files
      .flatMap((file) =>
        file.content
          .split('\n')
          .flatMap((text, index) =>
            text.includes(request.query)
              ? [{ path: file.path, line: index + 1, text: text.slice(0, 300) }]
              : [],
          ),
      )
      .slice(0, 50)
  }
  if (request.op === 'read') return { content: await tools.read(request.path) }
  if (request.op === 'write') {
    const files = await tools.snapshot()
    validateFiles(
      files
        .filter((file) => file.path !== request.path)
        .concat({ path: request.path, content: request.content }),
    )
    await tools.write(request.path, request.content)
    return { ok: true }
  }
  if (request.op === 'build') return build()
  if (request.op === 'preview') {
    if (
      typeof request.path !== 'string' ||
      !/^[a-zA-Z0-9_./-]*$/.test(request.path) ||
      request.path
        .split('/')
        .some((part) => part === '..' || part.startsWith('.'))
    )
      throw new Error('预览路径无效')
    const response = await fetch('http://127.0.0.1:4173/' + request.path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    })
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > 2 * 1024 * 1024) throw new Error('预览资源超过 2 MiB')
    return {
      status: response.status,
      contentType:
        response.headers.get('content-type') || 'application/octet-stream',
      body: Buffer.from(bytes).toString('base64'),
    }
  }
  throw new Error('不支持的操作')
}
main()
  .then((result) => process.stdout.write(JSON.stringify({ ok: true, result })))
  .catch((error) => {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }))
    process.exitCode = 1
  })

const http = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}
const root = '/workspace/dist'
http
  .createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') {
        res.writeHead(405).end()
        return
      }
      const requested = decodeURIComponent(
        new URL(req.url, 'http://localhost').pathname,
      )
      if (
        requested.includes('\\') ||
        requested.includes('\0') ||
        requested
          .split('/')
          .some((part) => part === '..' || part.startsWith('.'))
      ) {
        res.writeHead(400).end()
        return
      }
      const target = path.join(
        root,
        requested === '/' ? 'index.html' : requested,
      )
      const real = await fs.realpath(target)
      if (!real.startsWith(root + '/')) {
        res.writeHead(403).end()
        return
      }
      const stat = await fs.stat(real)
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
        res.writeHead(413).end()
        return
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(real)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      res.end(await fs.readFile(real))
    } catch {
      res
        .writeHead(404, { 'Content-Type': 'text/plain' })
        .end('请先完成构建，或检查资源路径。')
    }
  })
  .listen(4173, '127.0.0.1', () =>
    console.log('Pixloom isolated preview ready on container loopback :4173'),
  )

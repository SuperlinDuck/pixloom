import { artifactManifest } from '../cloud/manifest'
import { validCloudEndpoint } from '../runtime/preview'
import { sharedRuntimeHandler } from '../cloud/shared-runtime'
import { runtimeOrigin } from '../cloud/shared-config'
import { Readable } from 'node:stream'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { publicationConfig, type PublicationConfig } from './config'
import { PublicationFiles } from './files'
import { installationId, siteForDomain, wasPublished } from './store'

export function publishedHeaders(
  contentType: string,
  immutable = false,
  backendOrigin?: string,
) {
  if (backendOrigin && !validCloudEndpoint(backendOrigin))
    throw new Error('发布后端配置无效')
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${backendOrigin ? 'blob: ' + backendOrigin : ''}; font-src 'self' data:; connect-src 'self' ${backendOrigin || ''}; form-action 'self'; base-uri 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'`,
    'Cache-Control': immutable
      ? 'public, max-age=31536000, immutable'
      : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
}
export function gatewayHandler(
  config: PublicationConfig = publicationConfig(),
) {
  const files = new PublicationFiles(config)
  return async (req: IncomingMessage, res: ServerResponse) => {
    const fail = (status: number) => {
      res.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : `HTTP ${status}`)
    }
    try {
      if ((req.url || '').startsWith('/cloud/v2/')) {
        const origin = runtimeOrigin()
        if (req.headers.host !== new URL(origin).host) {
          fail(404)
          return
        }
        const request = new Request(new URL(req.url!, origin), {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(!['GET', 'HEAD'].includes(req.method || 'GET')
            ? { body: Readable.toWeb(req), duplex: 'half' }
            : {}),
        } as RequestInit)
        const result = await sharedRuntimeHandler(
          request,
          req.socket.remoteAddress || 'unknown',
        )
        res.writeHead(result.status, Object.fromEntries(result.headers))
        res.end(Buffer.from(await result.arrayBuffer()))
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD')
        fail(405)
        return
      }
      const host = req.headers.host || ''
      if (host.length > 255 || !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host)) {
        fail(400)
        return
      }
      const domain = host.split(':')[0]
      const url = new URL(req.url || '/', 'http://gateway')
      if (url.pathname.startsWith('/_pixloom')) {
        const local =
          ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
            req.socket.remoteAddress || '',
          ) && ['localhost', '127.0.0.1'].includes(domain)
        if (!local) {
          fail(404)
          return
        }
        if (url.pathname === '/_pixloom/health') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          })
          res.end(
            JSON.stringify({
              enabled: config.enabled,
              installationId: installationId(),
              rootHash: config.rootHash,
              domain: config.domain,
              publicPort: config.publicPort,
            }),
          )
          return
        }
        if (url.pathname === '/_pixloom/allow-domain') {
          const candidate = url.searchParams.get('domain') || ''
          const runtimeHost = (() => {
            try {
              return new URL(runtimeOrigin()).hostname
            } catch {
              return ''
            }
          })()
          const allowedRuntime =
            candidate === runtimeHost &&
            !['localhost', '127.0.0.1'].includes(runtimeHost)
          const site =
            config.enabled &&
            candidate.length < 254 &&
            candidate.endsWith('.' + config.domain)
              ? siteForDomain(candidate)
              : null
          res
            .writeHead(allowedRuntime || site ? 200 : 403, {
              'Cache-Control': 'no-store',
            })
            .end()
          return
        }
        fail(404)
        return
      }
      if (!config.enabled || !domain.endsWith('.' + config.domain)) {
        fail(404)
        return
      }
      const site = siteForDomain(domain)
      if (!site) {
        fail(404)
        return
      }
      const raw = (req.url || '/').split('?')[0]
      if (
        !raw.startsWith('/') ||
        raw.startsWith('//') ||
        raw.length > 1024 ||
        !/^[a-zA-Z0-9_./-]+$/.test(raw) ||
        raw.split('/').some((part) => part.startsWith('.'))
      ) {
        fail(400)
        return
      }
      let artifactId = site.artifactId,
        file = 'index.html',
        immutable = false
      if (raw !== '/' && raw !== '/index.html') {
        const match = raw.match(/^\/api\/previews\/([a-f0-9-]{36})\/(.+)$/)
        if (!match || !wasPublished(site.projectId, match[1])) {
          fail(404)
          return
        }
        artifactId = match[1]
        file = match[2]
        immutable = true
      }
      const asset = await files.readAsset(site.projectId, artifactId, file)
      res.writeHead(200, {
        ...publishedHeaders(
          asset.contentType,
          immutable,
          (() => {
            const manifest = artifactManifest(artifactId)
            return manifest?.format === 'pixloom-cloud-v1'
              ? manifest.production.url
              : manifest?.format === 'pixloom-cloud-v2'
                ? `${runtimeOrigin()}/cloud/v2/apps/${manifest.projectId}/environments/production/${manifest.generation}/`
                : undefined
          })(),
        ),
        'Content-Length': asset.body.length,
      })
      res.end(req.method === 'HEAD' ? undefined : asset.body)
    } catch (error) {
      fail((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 503)
    }
  }
}
export function createPublicationGateway(config = publicationConfig()) {
  const server = createServer(gatewayHandler(config))
  server.requestTimeout = 10000
  server.headersTimeout = 5000
  return server
}

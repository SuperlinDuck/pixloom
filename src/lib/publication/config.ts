import { MAINTENANCE_FILE } from '../maintenance'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { projectPublicId } from '../store'
import { workspaceOrigin } from '../workspace-origin'
import { normalizePublicationPrefix, publicationPrefixError } from './prefix'

export function publicationConfig() {
  const domain = process.env.PIXLOOM_PUBLISH_DOMAIN || 'apps.localhost'
  if (
    domain.length > 190 ||
    !domain.includes('.') ||
    !domain
      .split('.')
      .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  )
    throw new Error(
      'PIXLOOM_PUBLISH_DOMAIN 必须是小写 DNS 域名，不含协议、端口或通配符',
    )
  const port = Number(process.env.PIXLOOM_GATEWAY_PORT || 4180)
  const local = domain.endsWith('.localhost')
  const publicPort = Number(
    process.env.PIXLOOM_PUBLISH_PORT || (local ? port : 443),
  )
  if (
    ![port, publicPort].every(
      (value) => Number.isInteger(value) && value > 0 && value <= 65535,
    )
  )
    throw new Error('发布端口必须是 1–65535 的整数')
  const root = path.resolve(
    process.env.PIXLOOM_PUBLISH_DIR ||
      path.join(process.env.PIXLOOM_DATA_DIR || '.pixloom', 'published'),
  )
  return {
    enabled: process.env.PIXLOOM_PUBLISH_ENABLED === '1',
    domain,
    port,
    publicPort,
    local,
    root,
    rootHash: createHash('sha256').update(root).digest('hex'),
  }
}
export type PublicationConfig = ReturnType<typeof publicationConfig>
export function publicationTarget(
  projectId: string,
  config = publicationConfig(),
  prefix = projectPublicId(projectId),
) {
  if (!/^[a-f0-9-]{36}$/.test(projectId)) throw new Error('项目 ID 无效')
  prefix = normalizePublicationPrefix(prefix)
  const error = publicationPrefixError(prefix)
  if (error) throw new Error(error)
  const domain = `${prefix}.${config.domain}`
  const scheme = config.local ? 'http' : 'https'
  const port =
    config.publicPort === (config.local ? 80 : 443)
      ? ''
      : `:${config.publicPort}`
  return { domain, url: `${scheme}://${domain}${port}` }
}
export function caddyConfig(
  config = publicationConfig(),
  localPort?: number,
  maintenanceFile = MAINTENANCE_FILE,
) {
  if (
    localPort !== undefined &&
    (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535)
  )
    throw new Error('Caddy 测试端口无效')
  const upstream = `127.0.0.1:${config.port}`
  const maintenance = `    @maintenance file {\n        root ${path.dirname(maintenanceFile)}\n        try_files ${path.basename(maintenanceFile)}\n    }\n    respond @maintenance "Pixloom is upgrading. Please retry shortly." 503\n`
  const routes = `${maintenance}    @internal path /_pixloom /_pixloom/*\n    respond @internal 404\n    reverse_proxy ${upstream}\n`
  if (localPort !== undefined)
    return `{\n    admin off\n    auto_https off\n}\nhttp://:${localPort} {\n    bind 127.0.0.1\n${routes}}\n`
  const workspace = workspaceOrigin()
  const workspaceHost = new URL(workspace).host
  const workbench = workspace.startsWith('https:')
    ? `https://${workspaceHost} {\n    request_body {\n        max_size 8MB\n    }\n${maintenance}    reverse_proxy 127.0.0.1:3000\n}\n`
    : ''
  const cloud = process.env.PIXLOOM_CLOUD_RUNTIME_URL
  const cloudHost = cloud?.startsWith('https:')
    ? new URL(cloud).host
    : undefined
  const cloudRedirect = cloudHost
    ? `    @cloud host ${cloudHost}\n    redir @cloud https://{host}{uri} 308\n`
    : ''
  return `{
    admin 127.0.0.1:2019
    on_demand_tls {
        ask http://${upstream}/_pixloom/allow-domain
    }
}
${workbench}https:// {
    tls {
        on_demand
    }
${routes}}
http:// {
${cloudRedirect}    @apps host *.${config.domain}
    redir @apps https://{host}{uri} 308
    respond 404
}
`
}

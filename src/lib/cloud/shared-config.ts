import { StoreError } from '../store'
import { encryptionKey, projectOrigin, projectRef } from './config'
import type { CloudEnvironment } from './types'

export function positiveLimit(
  name: string,
  fallback: number,
  max = 1000000000,
) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new StoreError(`${name} 配置无效`, 503)
  return value
}
export function runtimeOrigin() {
  const value = process.env.PIXLOOM_CLOUD_RUNTIME_URL || 'http://127.0.0.1:4180'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new StoreError('PIXLOOM_CLOUD_RUNTIME_URL 配置无效', 503)
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      ))
  )
    throw new StoreError(
      'PIXLOOM_CLOUD_RUNTIME_URL 必须为 HTTPS 来源，本机允许 HTTP',
      503,
    )
  return url.origin
}
export function sharedPoolConfig(environment: CloudEnvironment) {
  encryptionKey()
  runtimeOrigin()
  const prefix = `PIXLOOM_CLOUD_${environment === 'development' ? 'DEV' : 'PROD'}_`
  const ref = projectRef(process.env[prefix + 'PROJECT_REF'] || '')
  const databaseUrl = process.env[prefix + 'DATABASE_URL'] || ''
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new StoreError(`${prefix}DATABASE_URL 配置无效`, 503)
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    url.hash
  )
    throw new StoreError(
      `${prefix}DATABASE_URL 需要 PostgreSQL 管理连接凭证`,
      503,
    )
  // Session pooling/direct connections are required for per-application login roles.
  if (url.port === '6543')
    throw new StoreError(
      '共享池使用 Direct connection 或 Session pooler（5432），不使用 Transaction pooler',
      503,
    )
  const publicKey = process.env[prefix + 'PUBLISHABLE_KEY'] || ''
  const serviceKey = process.env[prefix + 'SECRET_KEY'] || ''
  if (!publicKey || !serviceKey)
    throw new StoreError(`${prefix}PUBLISHABLE_KEY / SECRET_KEY 尚未配置`, 503)
  const other =
    process.env[
      `PIXLOOM_CLOUD_${environment === 'development' ? 'PROD' : 'DEV'}_PROJECT_REF`
    ]
  if (other === ref)
    throw new StoreError('开发池与生产池必须使用不同的 Supabase 项目', 503)
  return {
    environment,
    ref,
    databaseUrl,
    publicKey,
    serviceKey,
    origin: projectOrigin(ref),
    maxApps: positiveLimit('PIXLOOM_CLOUD_MAX_APPS', 30, 1000),
    maxRows: positiveLimit('PIXLOOM_CLOUD_APP_MAX_ROWS', 10000),
    maxBytes: positiveLimit('PIXLOOM_CLOUD_APP_MAX_BYTES', 10 * 1024 * 1024),
    maxFileBytes: positiveLimit(
      'PIXLOOM_CLOUD_APP_MAX_FILE_BYTES',
      10 * 1024 * 1024,
    ),
    maxPoolBytes: positiveLimit(
      'PIXLOOM_CLOUD_POOL_MAX_BYTES',
      500 * 1024 * 1024,
    ),
    requestsPerMinute: positiveLimit(
      'PIXLOOM_CLOUD_REQUESTS_PER_MINUTE',
      120,
      10000,
    ),
    maxConnections: positiveLimit('PIXLOOM_CLOUD_MAX_CONNECTIONS', 12, 100),
  }
}
export function sharedConfigured(
  environment: CloudEnvironment = 'development',
) {
  try {
    sharedPoolConfig(environment)
    return true
  } catch {
    return false
  }
}

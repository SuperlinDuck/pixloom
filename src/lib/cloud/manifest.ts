import { schemaFromFiles } from './schema'
import { z } from 'zod'
import { db, StoreError } from '../store'
import { appFunctions } from './functions'
import type { SourceFile } from '../types'
import type { BuildAsset } from '../types'
import { projectOrigin } from './config'
import { binding, resource } from './store'
import type {
  CloudManifest,
  CloudPublicConfig,
  SharedCloudManifest,
  CloudEnvironment,
} from './types'
import { sharedApp, sharedEnvironment } from './shared-store'
import { runtimeOrigin } from './shared-config'

export const CLOUD_CONFIG_PATH = 'pixloom-cloud.json'
const publicConfigSchema = z
  .object({
    ref: z.string().regex(/^[a-z]{20}$/),
    url: z.string(),
    publishableKey: z.string().min(1).max(8000),
  })
  .strict()
  .refine(
    (value) =>
      value.url === projectOrigin(value.ref) &&
      /^(sb_publishable_[a-zA-Z0-9_-]+|eyJ[a-zA-Z0-9_.-]+)$/.test(
        value.publishableKey,
      ),
    'Cloud 公开配置无效',
  )
const legacyManifestSchema = z
  .object({
    format: z.literal('pixloom-cloud-v1'),
    projectId: z.string().uuid(),
    mode: z.enum(['managed', 'external']),
    environment: z.enum(['development', 'production']),
    development: publicConfigSchema,
    production: publicConfigSchema,
    buckets: z.record(
      z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
      z.string().regex(/^px-[a-f0-9]{16}-[a-z][a-z0-9_]{0,39}$/),
    ),
    functions: z.record(
      z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
      z.string().regex(/^px-[a-z0-9-]+-[a-f0-9]{12}$/),
    ),
  })
  .strict()
  .refine((value) => value.development.ref !== value.production.ref)
export const sharedManifestSchema = z
  .object({
    format: z.literal('pixloom-cloud-v2'),
    authMode: z.literal('persistent-v1').optional(),
    projectId: z.string().uuid(),
    mode: z.literal('managed'),
    environment: z.enum(['development', 'production']),
    environmentId: z.string().uuid(),
    generation: z.string().uuid(),
    endpoint: z.string().max(1000),
    capabilities: z.array(z.enum(['auth', 'database', 'storage'])).max(3),
  })
  .strict()
  .refine((value) => {
    try {
      const url = new URL(value.endpoint)
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' &&
            ['127.0.0.1', 'localhost'].includes(url.hostname))) &&
        url.pathname ===
          `/cloud/v2/apps/${value.projectId}/environments/${value.environment}/${value.generation}`
      )
    } catch {
      return false
    }
  })
export const manifestSchema = z.union([
  legacyManifestSchema,
  sharedManifestSchema,
])
export function sharedManifest(
  projectId: string,
  environment: CloudEnvironment,
): SharedCloudManifest {
  const app = sharedApp(projectId),
    row = sharedEnvironment(projectId, environment)
  if (!app || !row || row.status !== 'ready')
    throw new StoreError('共享应用环境尚未就绪', 409)
  return sharedManifestSchema.parse({
    format: 'pixloom-cloud-v2',
    authMode: 'persistent-v1',
    projectId,
    mode: 'managed',
    environment,
    environmentId: row.id,
    generation: app.generation,
    endpoint: `${runtimeOrigin()}/cloud/v2/apps/${projectId}/environments/${environment}/${app.generation}`,
    capabilities: ['auth', 'database', 'storage'],
  })
}
export function manifestEndpoint(manifest: CloudManifest | null | undefined) {
  return manifest
    ? manifest.format === 'pixloom-cloud-v2'
      ? manifest.endpoint + '/'
      : manifest[manifest.environment].url
    : undefined
}
export function cloudManifest(
  projectId: string,
  files: SourceFile[] = [],
): CloudManifest {
  if (sharedApp(projectId)) return sharedManifest(projectId, 'development')
  const bound = binding(projectId)
  if (bound?.status !== 'ready')
    throw new StoreError('云后端尚未就绪，请先准备资源', 409)
  const config = (env: 'development' | 'production'): CloudPublicConfig => {
    const row = resource(projectId, env)
    if (row.status !== 'ready' || !row.ref || !row.publishableKey)
      throw new StoreError('云资源未就绪', 409)
    return {
      ref: row.ref,
      url: projectOrigin(row.ref),
      publishableKey: row.publishableKey,
    }
  }
  return manifestSchema.parse({
    format: 'pixloom-cloud-v1',
    projectId,
    mode: bound.mode,
    environment: 'development',
    development: config('development'),
    production: config('production'),
    buckets: Object.fromEntries(
      (schemaFromFiles(files)?.buckets || []).map((bucket) => [
        bucket,
        `px-${projectId.replaceAll('-', '').slice(0, 16)}-${bucket}`,
      ]),
    ),
    functions: Object.fromEntries(
      appFunctions(files).map((fn) => [fn.name, fn.slug]),
    ),
  })
}
export function readManifest(
  assets: { path: string; body: Buffer | Uint8Array }[],
): CloudManifest | null {
  const config = assets.find((asset) => asset.path === CLOUD_CONFIG_PATH)
  if (!config) return null
  if (config.body.length > 24000)
    throw new StoreError('Cloud 产物配置过大', 409)
  try {
    return manifestSchema.parse(JSON.parse(Buffer.from(config.body).toString()))
  } catch {
    throw new StoreError('Cloud 产物配置无效', 409)
  }
}
export function artifactManifest(artifactId: string) {
  const row = db()
    .prepare('SELECT body FROM preview_assets WHERE artifactId=? AND path=?')
    .get(artifactId, CLOUD_CONFIG_PATH) as { body: Uint8Array } | undefined
  return row
    ? readManifest([{ path: CLOUD_CONFIG_PATH, body: row.body }])
    : null
}
export function withCloudConfig(
  assets: BuildAsset[],
  projectId: string,
  files: SourceFile[],
) {
  if (assets.some((asset) => asset.path === CLOUD_CONFIG_PATH))
    throw new StoreError('构建产物不能覆盖平台 Cloud 配置')
  const manifest = cloudManifest(projectId, files)
  return [
    ...assets,
    {
      path: CLOUD_CONFIG_PATH,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(manifest)).toString('base64'),
    },
  ]
}
export function productionAssets<
  T extends { path: string; body: Buffer; contentType: string },
>(assets: T[]) {
  const manifest = readManifest(assets)
  if (!manifest) return assets
  const production =
    manifest.format === 'pixloom-cloud-v2'
      ? sharedManifest(manifest.projectId, 'production')
      : { ...manifest, environment: 'production' }
  if (
    manifest.format === 'pixloom-cloud-v2' &&
    (production.format !== 'pixloom-cloud-v2' ||
      manifest.generation !== production.generation ||
      sharedEnvironment(manifest.projectId, manifest.environment)?.id !==
        manifest.environmentId)
  )
    throw new StoreError('版本绑定的共享环境已变化', 409)
  return assets.map((asset) =>
    asset.path === CLOUD_CONFIG_PATH
      ? {
          ...asset,
          body: Buffer.from(JSON.stringify(production)),
        }
      : asset,
  )
}
export function cloudNetworkAllowed(url: URL, origin: string) {
  const endpoint = new URL(origin)
  if (endpoint.pathname.startsWith('/cloud/v2/'))
    return (
      url.origin === endpoint.origin &&
      url.pathname.startsWith(
        endpoint.pathname.endsWith('/')
          ? endpoint.pathname
          : endpoint.pathname + '/',
      ) &&
      !url.username &&
      !url.password
    )
  return (
    url.origin === origin &&
    /^\/(rest|auth|storage|functions)\/v1\//.test(url.pathname)
  )
}

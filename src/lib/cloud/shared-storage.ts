import { z } from 'zod'
import { StoreError } from '../store'
import type { sharedPoolConfig } from './shared-config'

type Config = Pick<
  ReturnType<typeof sharedPoolConfig>,
  'environment' | 'origin' | 'serviceKey'
>
const operations = {
  'bucket.lookup': '私有文件存储查询',
  'bucket.create': '私有文件存储初始化',
  'bucket.private': '私有文件存储校验',
  'file.upload': '文件上传',
  'file.download': '文件下载',
  'file.delete': '文件删除',
} as const
type Operation = keyof typeof operations
const codes = [
  'NoSuchBucket',
  'NoSuchKey',
  'BucketAlreadyExists',
  'ResourceAlreadyExists',
  'AccessDenied',
  'InvalidJWT',
  'InvalidMimeType',
  'EntityTooLarge',
  'InternalError',
  'DatabaseError',
  'TIMEOUT',
  'DNS_LOOKUP_FAILED',
  'CONNECTION_REFUSED',
  'TRANSPORT_ERROR',
  'INVALID_RESPONSE',
  'PUBLIC_BUCKET',
  'UPSTREAM_ERROR',
] as const
const diagnosticSchema = z.object({
  operation: z.enum(Object.keys(operations) as [Operation, ...Operation[]]),
  status: z.number().int().min(100).max(599).nullable(),
  code: z.enum(codes),
  requestId: z.string().uuid().nullable(),
})
type Diagnostic = z.infer<typeof diagnosticSchema>

export class StorageError extends StoreError {
  constructor(
    config: Config,
    readonly diagnostic: Diagnostic,
    status = 502,
  ) {
    super(
      diagnostic.code === 'PUBLIC_BUCKET'
        ? '共享池存储桶必须为私有'
        : `${operations[diagnostic.operation]}失败（${diagnostic.status ? `上游 HTTP ${diagnostic.status}；` : ''}${diagnostic.code}）；请重试同一路径，勿将未确认的文件标记为保存成功`,
      status,
    )
    // Only controlled codes and upstream UUIDs; never URLs, credentials or body text.
    console.error('Pixloom Cloud Storage', {
      environment: config.environment,
      ...diagnostic,
    })
  }
}

export function storageFailureSummary(value: unknown) {
  const parsed = z.object({ storage: diagnosticSchema }).safeParse(value)
  if (!parsed.success) return ''
  const { operation, status, code, requestId } = parsed.data.storage
  return `（${operations[operation]}；${status ? `上游 HTTP ${status}；` : ''}${code}${requestId ? `；请求 ${requestId}` : ''}）`
}

async function metadata(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader()
  if (!reader) return {}
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      if (size > 64000) throw new Error('metadata limit')
      chunks.push(part.value)
    }
    const value = JSON.parse(Buffer.concat(chunks).toString())
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {}
  } catch {
    await reader.cancel().catch(() => {})
    return {}
  } finally {
    reader.releaseLock()
  }
}
function requestId(response: Response) {
  const value = response.headers.get('sb-request-id')
  return z.string().uuid().safeParse(value).success ? value : null
}
const missingBucket = (status: number, value: Record<string, unknown>) =>
  status === 404 ||
  (status === 400 &&
    (value.code === 'NoSuchBucket' ||
      value.error === 'Bucket not found' ||
      value.message === 'Bucket not found'))
const existingBucket = (status: number, value: Record<string, unknown>) =>
  status === 409 ||
  (status === 400 &&
    (['BucketAlreadyExists', 'ResourceAlreadyExists'].includes(
      String(value.code),
    ) ||
      (String(value.statusCode) === '409' && value.error === 'Duplicate')))

export async function storageFetch(
  config: Config,
  operation: Operation,
  path: string,
  init: RequestInit = {},
  acceptError?: (status: number, value: Record<string, unknown>) => boolean,
) {
  let response: Response
  try {
    response = await fetch(config.origin + '/storage/v1/' + path, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(
        operation === 'file.download'
          ? 10000
          : operation.startsWith('file.')
            ? 4000
            : 5000,
      ),
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
      },
    })
  } catch (error) {
    const value = error as { name?: string; cause?: { code?: string } }
    const code =
      value.name === 'TimeoutError' || value.name === 'AbortError'
        ? 'TIMEOUT'
        : ['ENOTFOUND', 'EAI_AGAIN'].includes(value.cause?.code || '')
          ? 'DNS_LOOKUP_FAILED'
          : value.cause?.code === 'ECONNREFUSED'
            ? 'CONNECTION_REFUSED'
            : 'TRANSPORT_ERROR'
    throw new StorageError(config, {
      operation,
      status: null,
      code,
      requestId: null,
    })
  }
  if (response.ok) return response
  const value = await metadata(response)
  if (acceptError?.(response.status, value)) return response
  const parsed = z.enum(codes).safeParse(value.code)
  throw new StorageError(config, {
    operation,
    status: response.status,
    code: parsed.success ? parsed.data : 'UPSTREAM_ERROR',
    requestId: requestId(response),
  })
}

export async function ensurePrivateStorageBucket(config: Config) {
  let bucket = await storageFetch(
    config,
    'bucket.lookup',
    'bucket/pixloom-cloud-v2',
    {},
    missingBucket,
  )
  if (!bucket.ok) {
    const created = await storageFetch(
      config,
      'bucket.create',
      'bucket',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'pixloom-cloud-v2',
          name: 'pixloom-cloud-v2',
          public: false,
          file_size_limit: 2097152,
        }),
      },
      existingBucket,
    )
    await created.body?.cancel()
    // Re-read after success AND a concurrent creator's conflict. Never trust
    // an existing bucket (or a creation response) to be private without checking.
    bucket = await storageFetch(
      config,
      'bucket.lookup',
      'bucket/pixloom-cloud-v2',
    )
  }
  const value = await metadata(bucket)
  if (value.public !== false)
    throw new StorageError(
      config,
      {
        operation: 'bucket.private',
        status: bucket.status,
        code: value.public === true ? 'PUBLIC_BUCKET' : 'INVALID_RESPONSE',
        requestId: requestId(bucket),
      },
      503,
    )
}

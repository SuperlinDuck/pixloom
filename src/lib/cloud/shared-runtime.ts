import { z } from 'zod'
import { db, StoreError, transaction } from '../store'
import { sharedPoolConfig, runtimeOrigin } from './shared-config'
import {
  sharedApp,
  sharedEnvironment,
  environmentConfig,
  type SharedEnvironment,
} from './shared-store'
import { sharedTransaction, quoteIdentifier, poolCapacity } from './shared-db'
import {
  authenticateShared,
  establishSession,
  poolRequest,
  revokeSharedSession,
  parseSharedCredentials,
  digestToken,
} from './shared-auth'
import { cloudSchema, type AppSchema } from './schema'
import { emailConfirmationUrl } from './email-confirmation'
import {
  ensurePrivateStorageBucket,
  storageFetch,
  StorageError,
} from './shared-storage'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Max-Age': '300',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}
function response(value: unknown, status = 200) {
  const body = JSON.stringify(value)
  if (Buffer.byteLength(body) > 2 * 1024 * 1024)
    throw new StoreError('响应过大，请缩小分页或查询字段', 413)
  return new Response(body, {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
export async function boundedBody(request: Request, limit = 1024 * 1024) {
  const reader = request.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.length
      if (bytes > limit) throw new StoreError('请求过大', 413)
      chunks.push(part.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
  return Buffer.concat(chunks)
}
async function jsonBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new StoreError('需要 JSON 请求', 415)
  try {
    return JSON.parse((await boundedBody(request)).toString())
  } catch (error) {
    if (error instanceof StoreError) throw error
    throw new StoreError('JSON 无效')
  }
}
function rateLimit(key: string, limit: number) {
  const window = Math.floor(Date.now() / 60000)
  transaction(() => {
    db()
      .prepare('DELETE FROM cloud_rates_v2 WHERE window<?')
      .run(window - 1)
    const row = db()
      .prepare('SELECT count,window FROM cloud_rates_v2 WHERE key=?')
      .get(key) as { count: number; window: number } | undefined
    if (row?.window === window && row.count >= limit)
      throw new StoreError('请求过于频繁，请稍后重试', 429)
    db()
      .prepare(
        'INSERT INTO cloud_rates_v2 VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN cloud_rates_v2.window=excluded.window THEN cloud_rates_v2.count+1 ELSE 1 END',
      )
      .run(key, window)
  })
}
const running = new Map<string, number>()
function definition(row: SharedEnvironment) {
  return cloudSchema.parse(JSON.parse(row.definition))
}
function valueColumns(input: unknown, table: AppSchema['tables'][number]) {
  const record = z.record(z.unknown()).parse(input)
  if (Buffer.byteLength(JSON.stringify(record)) > 64000)
    throw new StoreError('单条记录最多 64 KiB', 413)
  if (
    !Object.keys(record).length ||
    Object.keys(record).some(
      (key) => !table.columns.some((column) => column.name === key),
    )
  )
    throw new StoreError('只能写入定义过的业务字段')
  for (const [name, value] of Object.entries(record)) {
    if (value === null) continue
    const type = table.columns.find((column) => column.name === name)!.type
    const valid =
      type === 'jsonb' ||
      (type === 'boolean' && typeof value === 'boolean') ||
      (['integer', 'numeric'].includes(type) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (type !== 'integer' || Number.isSafeInteger(value))) ||
      (['text', 'timestamptz'].includes(type) &&
        typeof value === 'string' &&
        (type !== 'timestamptz' || Number.isFinite(Date.parse(value))))
    if (!valid || Buffer.byteLength(JSON.stringify(value)) > 64000)
      throw new StoreError('字段值格式无效')
  }
  return record
}
export async function sharedCrud(
  row: SharedEnvironment,
  userId: string,
  tableName: string,
  method: string,
  params: URLSearchParams,
  input?: unknown,
) {
  const table = definition(row).tables.find((table) => table.name === tableName)
  if (!table) throw new StoreError('数据表未定义', 404)
  if (
    method !== 'DELETE' &&
    method !== 'GET' &&
    (await poolCapacity(row.environment)).blocked
  )
    throw new StoreError('共享池容量已达到保护阈值，暂停写入', 409)
  const columns = [
    'id',
    'owner_id',
    'created_at',
    ...table.columns.map((column) => column.name),
  ]
  const name =
    quoteIdentifier(row.namespace) + '.' + quoteIdentifier(table.name)
  return sharedTransaction(
    row.environment,
    async (client) => {
      if (method === 'GET') {
        const args: unknown[] = []
        const filters: string[] = []
        let select = '*',
          order = 'created_at DESC',
          limit = 100,
          offset = 0
        for (const [key, value] of Array.from(params)) {
          if (key === 'select') {
            const names = value.split(',')
            if (value !== '*' && names.some((name) => !columns.includes(name)))
              throw new StoreError('查询字段无效')
            select = value === '*' ? '*' : names.map(quoteIdentifier).join(',')
            continue
          }
          if (key === 'limit' || key === 'offset') {
            if (!/^\d{1,5}$/.test(value)) throw new StoreError('分页无效')
            if (key === 'limit') limit = Math.min(Number(value), 200)
            else offset = Number(value)
            continue
          }
          if (key === 'order') {
            const parts = value.split('.')
            if (
              !columns.includes(parts[0]) ||
              !['asc', 'desc'].includes(parts[1]) ||
              parts.length !== 2
            )
              throw new StoreError('排序无效')
            order = quoteIdentifier(parts[0]) + ' ' + parts[1].toUpperCase()
            continue
          }
          if (!columns.includes(key) || filters.length >= 12)
            throw new StoreError('查询条件无效')
          const split = value.indexOf('.'),
            operator = value.slice(0, split),
            literal = value.slice(split + 1)
          if (split < 0) throw new StoreError('查询条件无效')
          const operators: Record<string, string> = {
            eq: '=',
            neq: '<>',
            gt: '>',
            gte: '>=',
            lt: '<',
            lte: '<=',
          }
          if (operator === 'is' && literal === 'null')
            filters.push(quoteIdentifier(key) + ' IS NULL')
          else if (operators[operator]) {
            args.push(literal)
            filters.push(
              quoteIdentifier(key) + operators[operator] + '$' + args.length,
            )
          } else
            throw new StoreError(
              '共享池仅支持 eq/neq/gt/gte/lt/lte/is.null 过滤',
            )
        }
        args.push(limit, offset)
        return (
          await client.query(
            `SELECT ${select} FROM ${name}${filters.length ? ' WHERE ' + filters.join(' AND ') : ''} ORDER BY ${order} LIMIT $${args.length - 1} OFFSET $${args.length}`,
            args,
          )
        ).rows
      }
      if (method === 'POST') {
        if (Array.from(params).length) throw new StoreError('写入参数无效')
        const values = valueColumns(input, table),
          keys = Object.keys(values)
        return (
          await client.query(
            `INSERT INTO ${name} (${keys.map(quoteIdentifier).join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
            keys.map((key) =>
              table.columns.find((col) => col.name === key)?.type === 'jsonb'
                ? JSON.stringify(values[key])
                : values[key],
            ),
          )
        ).rows
      }
      if (
        !['PATCH', 'DELETE'].includes(method) ||
        Array.from(params).length !== 1 ||
        !/^eq\.[a-f0-9-]{36}$/.test(params.get('id') || '')
      )
        throw new StoreError('需要有效的记录 ID')
      const id = z.string().uuid().parse(params.get('id')!.slice(3))
      if (method === 'DELETE')
        return (
          await client.query(`DELETE FROM ${name} WHERE id=$1 RETURNING id`, [
            id,
          ])
        ).rows
      const values = valueColumns(input, table),
        keys = Object.keys(values)
      return (
        await client.query(
          `UPDATE ${name} SET ${keys.map((key, i) => quoteIdentifier(key) + '=$' + (i + 2)).join(',')} WHERE id=$1 RETURNING *`,
          [
            id,
            ...keys.map((key) =>
              table.columns.find((col) => col.name === key)?.type === 'jsonb'
                ? JSON.stringify(values[key])
                : values[key],
            ),
          ],
        )
      ).rows
    },
    { row, userId },
  )
}
export function storagePath(
  row: SharedEnvironment,
  userId: string,
  bucket: string,
  path: string,
) {
  if (
    !definition(row).buckets.includes(bucket) ||
    !z.string().uuid().safeParse(userId).success ||
    path.length > 400 ||
    !path
      .split('/')
      .every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          new RegExp('^[\\p{L}\\p{N}_. -]+$', 'u').test(part),
      )
  )
    throw new StoreError('文件路径或存储桶无效')
  return `${row.id}/${userId}/${bucket}/${path}`
}
async function sharedFile(
  row: SharedEnvironment,
  userId: string,
  bucket: string,
  path: string,
  request: Request,
) {
  const object = storagePath(row, userId, bucket, path),
    config = environmentConfig(row)
  const objectPath =
    'object/' +
    'pixloom-cloud-v2/' +
    object.split('/').map(encodeURIComponent).join('/')
  if (request.method === 'GET') {
    const known = await sharedTransaction(
      row.environment,
      async (client) =>
        (
          await client.query(
            "SELECT size FROM pixloom_pool_v2.files WHERE environment_id=$1 AND user_id=$2 AND bucket=$3 AND path=$4 AND state='ready'",
            [row.id, userId, bucket, path],
          )
        ).rows[0],
    )
    if (!known) throw new StoreError('文件不存在', 404)
    const upstream = await storageFetch(config, 'file.download', objectPath)
    const bytes = await boundedBody(
      new Request('http://file', {
        method: 'POST',
        body: upstream.body,
        duplex: 'half',
      } as RequestInit),
      2 * 1024 * 1024,
    )
    return new Response(bytes, {
      headers: {
        ...cors,
        'Content-Type':
          upstream.headers.get('content-type') || 'application/octet-stream',
        'Content-Disposition': 'attachment',
      },
    })
  }
  if (!['POST', 'DELETE'].includes(request.method))
    throw new StoreError('操作不支持', 405)
  const bytes =
    request.method === 'POST'
      ? await boundedBody(request, 2 * 1024 * 1024)
      : Buffer.alloc(0)
  if (
    request.method === 'POST' &&
    (await poolCapacity(row.environment)).blocked
  )
    throw new StoreError('共享池容量不足', 409)
  if (request.method === 'POST') await ensurePrivateStorageBucket(config)
  let failure: unknown = null
  await sharedTransaction(row.environment, async (client) => {
    const usage = (
      await client.query(
        'SELECT file_bytes,max_file_bytes FROM pixloom_pool_v2.environments WHERE id=$1 FOR UPDATE',
        [row.id],
      )
    ).rows[0]
    const old = (
      await client.query(
        'SELECT size FROM pixloom_pool_v2.files WHERE environment_id=$1 AND user_id=$2 AND bucket=$3 AND path=$4',
        [row.id, userId, bucket, path],
      )
    ).rows[0]
    const size =
        request.method === 'POST'
          ? Math.max(bytes.length, Number(old?.size || 0))
          : 0,
      delta = size - Number(old?.size || 0)
    if (
      !old &&
      request.method === 'POST' &&
      Number(
        (
          await client.query(
            'SELECT count(*) AS n FROM pixloom_pool_v2.files WHERE environment_id=$1',
            [row.id],
          )
        ).rows[0].n,
      ) >= 500
    )
      throw new StoreError('应用文件数量额度不足', 409)
    if (Number(usage.file_bytes) + delta > Number(usage.max_file_bytes))
      throw new StoreError('应用文件额度不足', 409)
    if (request.method === 'POST') {
      // Reserve before the external request; uncertain writes stay accounted until retry/cleanup.
      await client.query(
        "INSERT INTO pixloom_pool_v2.files VALUES ($1,$2,$3,$4,$5,'pending') ON CONFLICT(environment_id,user_id,bucket,path) DO UPDATE SET size=excluded.size,state='pending'",
        [row.id, userId, bucket, path, size],
      )
      await client.query(
        'UPDATE pixloom_pool_v2.environments SET file_bytes=file_bytes+$2 WHERE id=$1',
        [row.id, delta],
      )
    }
    try {
      const upstream = await storageFetch(
        config,
        request.method === 'POST' ? 'file.upload' : 'file.delete',
        request.method === 'POST' ? objectPath : 'object/pixloom-cloud-v2',
        {
          method: request.method,
          headers: {
            'Content-Type':
              request.method === 'POST'
                ? request.headers.get('content-type') ||
                  'application/octet-stream'
                : 'application/json',
            'x-upsert': 'true',
          },
          body:
            request.method === 'POST'
              ? bytes
              : JSON.stringify({ prefixes: [object] }),
        },
      )
      await upstream.body?.cancel()
      if (request.method === 'POST') {
        await client.query(
          "UPDATE pixloom_pool_v2.files SET state='ready',size=$5 WHERE environment_id=$1 AND user_id=$2 AND bucket=$3 AND path=$4",
          [row.id, userId, bucket, path, bytes.length],
        )
        await client.query(
          'UPDATE pixloom_pool_v2.environments SET file_bytes=file_bytes+$2 WHERE id=$1',
          [row.id, bytes.length - size],
        )
      } else {
        await client.query(
          'DELETE FROM pixloom_pool_v2.files WHERE environment_id=$1 AND user_id=$2 AND bucket=$3 AND path=$4',
          [row.id, userId, bucket, path],
        )
        await client.query(
          'UPDATE pixloom_pool_v2.environments SET file_bytes=file_bytes+$2 WHERE id=$1',
          [row.id, delta],
        )
      }
    } catch (error) {
      failure = error
    }
  })
  if (failure instanceof StorageError) throw failure
  if (failure)
    throw new StoreError('文件操作未确认；额度预留已保留，可重试同一路径', 502)
  return response({ ok: true, path })
}
export async function sharedRuntimeHandler(
  request: Request,
  remoteAddress = 'unknown',
  options: { persistentLogin?: boolean } = {},
) {
  try {
    const url = new URL(request.url)
    if (url.origin !== runtimeOrigin())
      throw new StoreError('Cloud 地址无效', 404)
    const match = url.pathname.match(
      /^\/cloud\/v2\/apps\/([a-f0-9-]{36})\/environments\/(development|production)\/([a-f0-9-]{36})\/(.+)$/,
    )
    if (!match) throw new StoreError('接口不存在', 404)
    const [, projectId, environment, generation, path] = match
    const app = sharedApp(projectId),
      row = sharedEnvironment(
        projectId,
        environment as 'development' | 'production',
      )
    if (!app || app.generation !== generation || !row || row.status !== 'ready')
      throw new StoreError('应用环境不可用', 404)
    const config = environmentConfig(row)
    rateLimit('all:' + row.id, config.requestsPerMinute)
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: cors })
    if ((running.get(row.id) || 0) >= 4)
      throw new StoreError('应用请求繁忙', 429)
    running.set(row.id, (running.get(row.id) || 0) + 1)
    try {
      if (path.startsWith('auth/'))
        rateLimit('auth:' + row.id + ':' + digestToken(remoteAddress), 10)
      if (
        ['auth/signin', 'auth/signup', 'auth/verify'].includes(path) &&
        request.method === 'POST'
      ) {
        if (Array.from(url.searchParams).length)
          throw new StoreError('认证参数无效')
        const body = await jsonBody(request)
        if (path === 'auth/signup') {
          const input =
            body && typeof body === 'object' && !Array.isArray(body)
              ? { ...body }
              : body
          const previewArtifactId = input?.previewArtifactId
          if (input && typeof input === 'object') delete input.previewArtifactId
          if (
            previewArtifactId !== undefined &&
            typeof previewArtifactId !== 'string'
          )
            throw new StoreError('预览产物无效', 400)
          const credentials = parseSharedCredentials(input, true)
          const redirectTo = emailConfirmationUrl(
            projectId,
            row.environment,
            app.generation,
            previewArtifactId,
          )
          // Never register membership based only on an email or an unverified sign-up response.
          try {
            await poolRequest(
              row,
              '/auth/v1/signup?redirect_to=' + encodeURIComponent(redirectTo),
              {
                method: 'POST',
                body: credentials,
              },
            )
          } catch (error) {
            if (
              (error as StoreError).status === 429 ||
              (error as StoreError).status >= 500
            )
              throw error
          }
          return response({
            message:
              '若邮箱可用，将收到验证邮件。完成验证后请返回此应用登录；已有账号可直接登录。',
          })
        }
        const upstream =
          path === 'auth/verify'
            ? await poolRequest(row, '/auth/v1/verify', {
                method: 'POST',
                body: z
                  .object({
                    email: z.string().email(),
                    token: z.string().regex(/^\d{6,10}$/),
                    type: z.literal('email'),
                  })
                  .strict()
                  .parse(body),
              })
            : await poolRequest(row, '/auth/v1/token?grant_type=password', {
                method: 'POST',
                body: parseSharedCredentials(body),
              })
        return response(
          await establishSession(row, upstream, options.persistentLogin),
        )
      }
      const session = await authenticateShared(
        row,
        request.headers.get('authorization'),
      )
      if (path === 'auth/user' && request.method === 'GET')
        return response({ id: session.userId, email: session.email })
      if (path === 'auth/signout' && request.method === 'POST') {
        revokeSharedSession(session.tokenHash)
        return response({ ok: true })
      }
      const table = path.match(/^tables\/([a-z][a-z0-9_]{0,39})$/)
      if (table)
        return response(
          await sharedCrud(
            row,
            session.userId,
            table[1],
            request.method,
            url.searchParams,
            ['POST', 'PATCH'].includes(request.method)
              ? await jsonBody(request)
              : undefined,
          ),
        )
      const file = path.match(/^files\/([a-z][a-z0-9_]{0,39})\/(.+)$/)
      if (file) {
        if (Array.from(url.searchParams).length)
          throw new StoreError('文件参数无效')
        return await sharedFile(
          row,
          session.userId,
          file[1],
          decodeURIComponent(file[2]),
          request,
        )
      }
      throw new StoreError('共享池暂不支持此能力', 404)
    } finally {
      running.set(row.id, Math.max(0, (running.get(row.id) || 1) - 1))
    }
  } catch (error) {
    if (error instanceof StoreError)
      return response(
        {
          message: error.message,
          ...(error instanceof StorageError
            ? { storage: error.diagnostic }
            : {}),
        },
        error.status,
      )
    if (error instanceof z.ZodError)
      return response({ message: '请求字段无效' }, 400)
    return response({ message: '共享后端暂不可用' }, 503)
  }
}

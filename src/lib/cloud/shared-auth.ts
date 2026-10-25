import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { db, StoreError, transaction } from '../store'
import { seal, unseal } from './crypto'
import { sharedTransaction } from './shared-db'
import {
  sharedApp,
  environmentConfig,
  type SharedEnvironment,
} from './shared-store'

export const digestToken = (value: string) =>
  createHash('sha256').update(value).digest('hex')
const userSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email().optional(),
    email_confirmed_at: z.string().nullable().optional(),
  })
  .passthrough()
export async function poolRequest(
  row: SharedEnvironment,
  path: string,
  options: {
    method?: string
    body?: unknown
    admin?: boolean
    signal?: AbortSignal
    headers?: Record<string, string>
  } = {},
) {
  const config = environmentConfig(row)
  const key = options.admin ? config.serviceKey : config.publicKey
  let response: Response
  try {
    response = await fetch(config.origin + path, {
      method: options.method || 'GET',
      redirect: 'error',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
      headers: {
        apikey: key,
        ...(options.admin ? { Authorization: `Bearer ${key}` } : {}),
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new StoreError('云服务请求未确认，请稍后重试', 502)
  }
  const reader = response.body?.getReader(),
    chunks: Uint8Array[] = []
  let bytes = 0
  if (reader) {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.length
      if (bytes > 64000) {
        await reader.cancel()
        throw new StoreError('云服务响应过大', 502)
      }
      chunks.push(part.value)
    }
  }
  const text = Buffer.concat(chunks).toString()
  let result
  try {
    result = text ? JSON.parse(text) : null
  } catch {
    if (response.ok) throw new StoreError('云服务响应无效', 502)
  }
  if (!response.ok) {
    const code =
      result && typeof result === 'object' && 'code' in result
        ? result.code
        : undefined
    throw new StoreError(
      options.admin
        ? '云资源管理请求失败'
        : code === 'email_not_confirmed'
          ? '请先完成邮箱验证，再返回此应用登录'
          : '认证失败，请检查凭证、邮件确认状态或稍后重试',
      response.status === 429
        ? 429
        : options.admin || response.status >= 500
          ? 502
          : 401,
    )
  }
  return result
}
type Tokens = {
  access_token: string
  refresh_token: string
  expires_at: number
}
export type SessionRow = {
  tokenHash: string
  environmentId: string
  generation: string
  userId: string
  email: string
  tokens: string
  expiresAt: number
}
export const PERSISTENT_SESSION_MS = 7 * 24 * 60 * 60 * 1000
export const ACCESS_SESSION_MS = 5 * 60 * 1000
export async function establishSession(
  row: SharedEnvironment,
  upstream: unknown,
  persistent = false,
) {
  const value = z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().min(1),
      expires_in: z.number().positive().max(86400).optional(),
      expires_at: z.number().positive().optional(),
      user: userSchema,
    })
    .parse(upstream)
  if (!value.user.email_confirmed_at)
    throw new StoreError('请先完成邮箱验证', 401)
  const metadata = value.user.app_metadata as
    { pixloom_test_environment?: string } | undefined
  if (
    metadata?.pixloom_test_environment &&
    metadata.pixloom_test_environment !== row.id
  )
    throw new StoreError('测试账号仅限所属开发应用', 403)
  const bound = sharedApp(row.projectId)!
  await sharedTransaction(row.environment, async (client) => {
    await client.query(
      'SELECT id FROM pixloom_pool_v2.environments WHERE id=$1 FOR UPDATE',
      [row.id],
    )
    const count = await client.query(
      'SELECT count(*) AS n FROM pixloom_pool_v2.members WHERE environment_id=$1 AND user_id<>$2',
      [row.id, value.user.id],
    )
    if (Number(count.rows[0].n) >= 1000)
      throw new StoreError('应用成员名额已满', 409)
    await client.query(
      'INSERT INTO pixloom_pool_v2.members VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [row.id, value.user.id],
    )
  })
  const token = randomBytes(32).toString('base64url'),
    hash = digestToken(token)
  const tokens: Tokens = {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_at:
      value.expires_at ||
      Math.floor(Date.now() / 1000) + (value.expires_in || 3600),
  }
  db()
    .prepare('DELETE FROM cloud_sessions_v2 WHERE expiresAt<?')
    .run(Date.now())
  const expiresAt =
    Date.now() + (persistent ? PERSISTENT_SESSION_MS : 60 * 60 * 1000)
  db()
    .prepare('INSERT INTO cloud_sessions_v2 VALUES (?,?,?,?,?,?,?)')
    .run(
      hash,
      row.id,
      bound.generation,
      value.user.id,
      value.user.email || '',
      seal(JSON.stringify(tokens), `shared-session:${hash}`),
      expiresAt,
    )
  return {
    access_token: token,
    expires_at: Math.floor(expiresAt / 1000),
    user: { id: value.user.id, email: value.user.email || '' },
  }
}
export async function authenticateShared(
  row: SharedEnvironment,
  authorization: string | null,
) {
  if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))
    throw new StoreError('请先登录', 401)
  const hash = digestToken(authorization.slice(7))
  const access = db()
    .prepare(
      'SELECT sessionHash,expiresAt FROM cloud_access_tokens_v3 WHERE tokenHash=?',
    )
    .get(hash) as { sessionHash: string; expiresAt: number } | undefined
  if (access && access.expiresAt <= Date.now())
    throw new StoreError('会话已过期，请重新登录', 401)
  return authenticateSharedSession(row, access?.sessionHash || hash)
}

export async function authenticateSharedSession(
  row: SharedEnvironment,
  hash: string,
) {
  let session = sessionByHash(row, hash)
  const tokens = await freshTokens(row, session)
  // Keep member and upstream revocation checks for persistent and legacy sessions alike.
  const member = await sharedTransaction(
    row.environment,
    async (client) =>
      (
        await client.query(
          'SELECT 1 FROM pixloom_pool_v2.members WHERE environment_id=$1 AND user_id=$2',
          [row.id, session.userId],
        )
      ).rowCount,
  )
  if (!member) throw new StoreError('没有此应用的访问权限', 403)
  try {
    const user = userSchema.parse(
      await poolRequest(row, '/auth/v1/user', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }),
    )
    if (user.id !== session.userId) throw new StoreError('会话身份不匹配', 401)
  } catch (error) {
    if ((error as StoreError).status === 401) revokeSharedSession(hash)
    throw error
  }
  // A concurrent logout must not allow a pending resume to resurrect the session.
  session = sessionByHash(row, hash)
  return session
}

export function sessionByHash(row: SharedEnvironment, hash: string) {
  const session = db()
    .prepare('SELECT * FROM cloud_sessions_v2 WHERE tokenHash=?')
    .get(hash) as SessionRow | undefined
  if (
    !session ||
    session.environmentId !== row.id ||
    session.generation !== sharedApp(row.projectId)?.generation ||
    session.expiresAt <= Date.now()
  )
    throw new StoreError('会话已过期，请重新登录', 401)
  return session
}

async function freshTokens(
  row: SharedEnvironment,
  initial: SessionRow,
): Promise<Tokens> {
  const owner = randomBytes(16).toString('hex')
  const deadline = Date.now() + 12000
  while (true) {
    const session = sessionByHash(row, initial.tokenHash)
    const tokens = JSON.parse(
      unseal(session.tokens, `shared-session:${session.tokenHash}`),
    ) as Tokens
    if (tokens.expires_at * 1000 > Date.now() + 30000) return tokens
    const acquired = db()
      .prepare(
        `INSERT INTO cloud_refresh_leases_v3 VALUES (?,?,?)
      ON CONFLICT(sessionHash) DO UPDATE SET owner=excluded.owner,until=excluded.until WHERE until<?`,
      )
      .run(session.tokenHash, owner, Date.now() + 30000, Date.now()).changes
    if (!acquired) {
      if (Date.now() >= deadline)
        throw new StoreError('会话正在续期，请稍后重试', 503)
      await new Promise((resolve) => setTimeout(resolve, 50))
      continue
    }
    try {
      // Another process may have completed rotation between our read and lease acquisition.
      const current = JSON.parse(
        unseal(
          sessionByHash(row, session.tokenHash).tokens,
          `shared-session:${session.tokenHash}`,
        ),
      ) as Tokens
      if (current.expires_at * 1000 > Date.now() + 30000) return current
      const next = z
        .object({
          access_token: z.string().min(1),
          refresh_token: z.string().min(1),
          expires_in: z.number().positive().optional(),
          expires_at: z.number().positive().optional(),
          user: userSchema,
        })
        .parse(
          await poolRequest(row, '/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            body: { refresh_token: current.refresh_token },
          }),
        )
      if (next.user.id !== session.userId || !next.user.email_confirmed_at)
        throw new StoreError('会话身份已失效', 401)
      const value: Tokens = {
        access_token: next.access_token,
        refresh_token: next.refresh_token,
        expires_at:
          next.expires_at ||
          Math.floor(Date.now() / 1000) + (next.expires_in || 3600),
      }
      const changed = db()
        .prepare(
          'UPDATE cloud_sessions_v2 SET tokens=? WHERE tokenHash=? AND expiresAt>?',
        )
        .run(
          seal(JSON.stringify(value), `shared-session:${session.tokenHash}`),
          session.tokenHash,
          Date.now(),
        ).changes
      if (!changed) throw new StoreError('会话已退出，请重新登录', 401)
      return value
    } catch (error) {
      if ((error as StoreError).status === 401)
        revokeSharedSession(session.tokenHash)
      throw error
    } finally {
      db()
        .prepare(
          'DELETE FROM cloud_refresh_leases_v3 WHERE sessionHash=? AND owner=?',
        )
        .run(session.tokenHash, owner)
    }
  }
}

export function issueAccessSession(
  row: SharedEnvironment,
  hash: string,
  inTransaction = false,
) {
  const issue = () => {
    const session = sessionByHash(row, hash)
    db()
      .prepare('DELETE FROM cloud_access_tokens_v3 WHERE expiresAt<=?')
      .run(Date.now())
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Math.min(
      session.expiresAt,
      Date.now() + ACCESS_SESSION_MS,
    )
    db()
      .prepare('INSERT INTO cloud_access_tokens_v3 VALUES (?,?,?)')
      .run(digestToken(token), hash, expiresAt)
    return {
      access_token: token,
      expires_at: Math.floor(expiresAt / 1000),
      session_expires_at: Math.floor(session.expiresAt / 1000),
      user: { id: session.userId, email: session.email },
    }
  }
  return inTransaction ? issue() : transaction(issue)
}
export function revokeSharedSession(tokenHash: string) {
  // App logout revokes only this app session, not the shared upstream identity.
  db().prepare('DELETE FROM cloud_sessions_v2 WHERE tokenHash=?').run(tokenHash)
}
export const sharedCredentials = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase().trim()),
    password: z.string().min(8).max(256),
  })
  .strict()
export const sharedLoginCredentials = sharedCredentials.extend({
  password: z.string().min(1).max(256),
})

export function parseSharedCredentials(input: unknown, signup = false) {
  const result = (
    signup ? sharedCredentials : sharedLoginCredentials
  ).safeParse(input)
  if (result.success) return result.data
  // Return fixed messages without reflecting submitted values or unknown fields.
  if (result.error.issues.some((issue) => issue.path[0] === 'email'))
    throw new StoreError('请输入有效的邮箱地址（最多 254 个字符）', 400)
  if (result.error.issues.some((issue) => issue.path[0] === 'password'))
    throw new StoreError(
      signup
        ? '注册密码长度须为 8–256 个字符'
        : '请输入密码（最多 256 个字符）',
      400,
    )
  throw new StoreError('认证字段无效，仅支持邮箱和密码', 400)
}

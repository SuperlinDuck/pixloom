import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  authRequired,
  readCookie,
  requireWorkspaceUser,
  sessionCookie,
} from '../auth'
import { db, projectById, StoreError, transaction } from '../store'
import { workspaceOrigin, workspaceRequestOrigin } from '../workspace-origin'
import { oauthConfig, SUPABASE_API } from './config'
import { seal, unseal } from './crypto'

export const cloudFlowCookie = 'pixloom_supabase_flow'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
function sessionHash(request: Request) {
  return sha(
    authRequired()
      ? readCookie(request, sessionCookie) || 'missing'
      : 'local-visitor',
  )
}
function cookie(response: NextResponse, value: string, maxAge: number) {
  response.cookies.set(cloudFlowCookie, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: workspaceOrigin().startsWith('https:'),
    path: '/api/cloud/supabase',
    maxAge,
  })
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
export function startSupabaseOAuth(request: Request, projectId: string) {
  requireWorkspaceUser(request)
  projectById(projectId)
  if (workspaceRequestOrigin(request) !== workspaceOrigin())
    throw new StoreError('Supabase 授权必须从配置的工作台地址发起', 400)
  const config = oauthConfig()
  const browser = randomBytes(32).toString('base64url'),
    state = randomBytes(32).toString('base64url'),
    verifier = randomBytes(32).toString('base64url')
  db()
    .prepare('DELETE FROM cloud_oauth_flows WHERE expiresAt<=?')
    .run(Date.now())
  db()
    .prepare('INSERT INTO cloud_oauth_flows VALUES (?,?,?,?,?,?)')
    .run(
      sha(browser),
      state,
      seal(verifier, `oauth-flow:${state}`),
      sessionHash(request),
      projectId,
      Date.now() + 600000,
    )
  const url = new URL(`${SUPABASE_API}/v1/oauth/authorize`)
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString()
  return cookie(NextResponse.redirect(url), browser, 600)
}
type Token = { access_token: string; refresh_token: string; expires_in: number }
async function tokenRequest(
  values: Record<string, string>,
  signal?: AbortSignal,
): Promise<Token> {
  const config = oauthConfig()
  let response: Response
  try {
    response = await fetch(`${SUPABASE_API}/v1/oauth/token`, {
      method: 'POST',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(values),
    })
  } catch {
    signal?.throwIfAborted()
    throw new StoreError('Supabase 授权服务暂时不可用，请重新授权', 502)
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new StoreError('Supabase 授权失效或令牌交换失败，请重新连接', 409)
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > 64000)
    throw new StoreError('Supabase 授权响应过大', 502)
  let value: Token
  try {
    value = JSON.parse(text)
  } catch {
    throw new StoreError('Supabase 授权响应无效', 502)
  }
  if (
    typeof value.access_token !== 'string' ||
    !value.access_token ||
    value.access_token.length > 16000 ||
    typeof value.refresh_token !== 'string' ||
    !value.refresh_token ||
    value.refresh_token.length > 16000 ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in < 1
  )
    throw new StoreError('Supabase 授权响应无效', 502)
  return value
}
export async function finishSupabaseOAuth(request: Request) {
  requireWorkspaceUser(request)
  if (workspaceRequestOrigin(request) !== workspaceOrigin())
    throw new StoreError('Supabase 回调地址不匹配', 400)
  const params = new URL(request.url).searchParams
  const browser = readCookie(request, cloudFlowCookie) || ''
  const flow = db()
    .prepare('DELETE FROM cloud_oauth_flows WHERE tokenHash=? RETURNING *')
    .get(sha(browser)) as
    | {
        state: string
        verifier: string
        expiresAt: number
        sessionHash: string
        projectId: string
      }
    | undefined
  const state = params.get('state') || ''
  if (
    !flow ||
    flow.expiresAt <= Date.now() ||
    flow.sessionHash !== sessionHash(request) ||
    Buffer.byteLength(state) !== Buffer.byteLength(flow.state) ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))
  )
    throw new StoreError('Supabase 授权已过期，请重新连接', 400)
  if (params.has('error')) throw new StoreError('已取消 Supabase 授权', 400)
  const code = params.get('code')
  if (!code || code.length > 4000)
    throw new StoreError('Supabase 授权码无效', 400)
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthConfig().redirectUri,
    code_verifier: unseal(flow.verifier, `oauth-flow:${state}`),
  })
  // Recheck session before persisting an asynchronously returned credential.
  requireWorkspaceUser(request)
  saveConnection(tokens)
  return cookie(
    NextResponse.redirect(
      `${workspaceOrigin()}/?cloudProject=${flow.projectId}`,
    ),
    '',
    0,
  )
}
export function saveConnection(tokens: Token) {
  const id = 'workspace-supabase'
  db()
    .prepare(
      `INSERT INTO cloud_connections (id,accessToken,refreshToken,expiresAt) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET accessToken=excluded.accessToken,refreshToken=excluded.refreshToken,expiresAt=excluded.expiresAt,refreshLease=NULL,refreshUntil=0`,
    )
    .run(
      id,
      seal(tokens.access_token, `access:${id}`),
      seal(tokens.refresh_token, `refresh:${id}`),
      Date.now() + tokens.expires_in * 1000,
    )
  return id
}
export async function externalToken(id: string, signal?: AbortSignal) {
  const read = () =>
    db().prepare('SELECT * FROM cloud_connections WHERE id=?').get(id) as
      | {
          accessToken: string
          refreshToken: string
          expiresAt: number
          refreshLease: string | null
          refreshUntil: number
        }
      | undefined
  let row = read()
  if (!row) throw new StoreError('请先授权连接 Supabase', 409)
  if (row.expiresAt > Date.now() + 60000)
    return unseal(row.accessToken, `access:${id}`)
  const lease = randomUUID()
  const acquired = transaction(
    () =>
      Number(
        db()
          .prepare(
            'UPDATE cloud_connections SET refreshLease=?,refreshUntil=? WHERE id=? AND refreshUntil<=?',
          )
          .run(lease, Date.now() + 30000, id, Date.now()).changes,
      ) === 1,
  )
  if (!acquired) throw new StoreError('Supabase 授权正在刷新，请稍后重试', 409)
  try {
    row = read()!
    const tokens = await tokenRequest(
      {
        grant_type: 'refresh_token',
        refresh_token: unseal(row.refreshToken, `refresh:${id}`),
      },
      signal,
    )
    const changed = db()
      .prepare(
        'UPDATE cloud_connections SET accessToken=?,refreshToken=?,expiresAt=?,refreshLease=NULL,refreshUntil=0 WHERE id=? AND refreshLease=?',
      )
      .run(
        seal(tokens.access_token, `access:${id}`),
        seal(tokens.refresh_token, `refresh:${id}`),
        Date.now() + tokens.expires_in * 1000,
        id,
        lease,
      ).changes
    if (!changed) throw new StoreError('Supabase 授权已更新，请重试', 409)
    return tokens.access_token
  } finally {
    db()
      .prepare(
        'UPDATE cloud_connections SET refreshLease=NULL,refreshUntil=0 WHERE id=? AND refreshLease=?',
      )
      .run(id, lease)
  }
}

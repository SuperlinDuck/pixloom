import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { db, StoreError, transaction } from '../store'
import { sharedApp, sharedEnvironment } from './shared-store'
import { runtimeOrigin } from './shared-config'
import { sharedRuntimeHandler, boundedBody } from './shared-runtime'
import { authenticateSharedSession, digestToken, issueAccessSession, PERSISTENT_SESSION_MS, revokeSharedSession, sessionByHash } from './shared-auth'
import type { SharedCloudManifest } from './types'

export function browserCookieName(origin: string) {
  return new URL(origin).protocol === 'https:' ? '__Host-pixloom_cloud' : 'pixloom_cloud'
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'},
})

// Only trusted, same-origin platform hosts call this handler. No CORS credentials are exposed to opaque frames.
export async function browserAuth(request: Request, manifest: SharedCloudManifest, origin: string, remoteAddress = 'unknown', mutationAllowed = request.headers.get('origin') === origin) {
  let rootHash: string | undefined
  try {
    if (request.method !== 'POST') throw new StoreError('需要 POST 请求', 405)
    if (!mutationAllowed || request.headers.get('origin') === 'null') throw new StoreError('不允许跨站认证请求', 403)
    const url = new URL(request.url)
    if (url.search) throw new StoreError('认证地址无效', 400)
    const action = url.pathname.split('/').at(-1)
    if (!['signin', 'resume', 'signout'].includes(action || '')) throw new StoreError('认证操作不存在', 404)
    const app = sharedApp(manifest.projectId), row = sharedEnvironment(manifest.projectId, manifest.environment)
    if (!row || row.id !== manifest.environmentId || row.status !== 'ready' || app?.generation !== manifest.generation || app.status !== 'ready') throw new StoreError('应用环境不可用', 404)
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new StoreError('需要 JSON 请求', 415)
    const raw = await boundedBody(request, 8000)
    const body = JSON.parse(raw.toString())
    const cookieName = browserCookieName(origin)
    const cookie = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
    let browserToken = cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie) ? cookie : undefined
    let browserHash = browserToken ? digestToken(browserToken) : undefined
    if (browserHash && !db().prepare('SELECT 1 FROM cloud_browsers_v3 WHERE tokenHash=? AND expiresAt>?').get(browserHash, Date.now())) {
      browserToken = undefined
      browserHash = undefined
    }
    // Bound both authenticated and anonymous resume traffic without relying on forwarded client IPs.
    const rateKey = `browser-auth:${row.id}:${digestToken(browserHash || remoteAddress)}`
    const window = Math.floor(Date.now()/60000)
    transaction(() => {
      db().prepare('DELETE FROM cloud_rates_v2 WHERE window<?').run(window - 1)
      const rate = db().prepare('SELECT count,window FROM cloud_rates_v2 WHERE key=?').get(rateKey) as {count:number;window:number}|undefined
      if (rate?.window === window && rate.count >= 120) throw new StoreError('认证请求过于频繁，请稍后重试',429)
      db().prepare('INSERT INTO cloud_rates_v2 VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END').run(rateKey, window)
    })
    const grant = () => browserHash ? db().prepare('SELECT sessionHash FROM cloud_browser_sessions_v3 WHERE browserHash=? AND environmentId=?').get(browserHash, row.id) as {sessionHash:string}|undefined : undefined
    if (action === 'signout') {
      z.object({}).strict().parse(body)
      transaction(() => {
        const current = grant()
        if (current) revokeSharedSession(current.sessionHash)
      })
      return json({ok: true})
    }
    if (action === 'resume') {
      z.object({}).strict().parse(body)
      const current = grant()
      if (!current) return json(null)
      try {
        await authenticateSharedSession(row, current.sessionHash)
        return json(issueAccessSession(row, current.sessionHash))
      } catch (error) {
        if ((error as StoreError).status === 401 || (error as StoreError).status === 403) {
          revokeSharedSession(current.sessionHash)
          return json(null)
        }
        throw error
      }
    }
    // Reuse the platform's real signin and rate limits; this internal flag cannot be supplied by app JS.
    const login = await sharedRuntimeHandler(new Request(`${runtimeOrigin()}/cloud/v2/apps/${row.projectId}/environments/${row.environment}/${manifest.generation}/auth/signin`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
    }), remoteAddress, {persistentLogin: true})
    const result = await login.json()
    if (!login.ok) return json(result, login.status)
    rootHash = digestToken(result.access_token)
    sessionByHash(row, rootHash)
    browserToken ||= randomBytes(32).toString('base64url')
    browserHash = digestToken(browserToken)
    const expiresAt = Date.now() + PERSISTENT_SESSION_MS
    const response = transaction(() => {
      db().prepare('DELETE FROM cloud_browsers_v3 WHERE expiresAt<=?').run(Date.now())
      db().prepare('INSERT INTO cloud_browsers_v3 VALUES (?,?) ON CONFLICT(tokenHash) DO UPDATE SET expiresAt=excluded.expiresAt').run(browserHash!, expiresAt)
      const old = grant()
      if (old) revokeSharedSession(old.sessionHash)
      db().prepare('INSERT INTO cloud_browser_sessions_v3 VALUES (?,?,?)').run(browserHash!, row.id, rootHash!)
      return json(issueAccessSession(row, rootHash!))
    })
    response.headers.set('Set-Cookie', `${cookieName}=${browserToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PERSISTENT_SESSION_MS/1000}${new URL(origin).protocol === 'https:' ? '; Secure' : ''}`)
    rootHash = undefined
    return response
  } catch (error) {
    if (rootHash) revokeSharedSession(rootHash)
    if (error instanceof StoreError) return json({message: error.message}, error.status)
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({message:'认证字段无效'},400)
    return json({message:'登录服务暂不可用，请稍后重试'},503)
  }
}

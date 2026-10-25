import { maintenanceMode } from './maintenance'
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library'
import { NextResponse } from 'next/server'
import { db, StoreError, transaction } from './store'
import type { AccountUser } from './auth-types'
import { adminEmails } from './platform-config'
import { assertActive, ownerOf, takeRate, type PlatformUser } from './tenancy'
import { workspaceOrigin, workspaceRequestOrigin } from './workspace-origin'

export const sessionCookie = 'pixloom_session'
export const flowCookie = 'pixloom_google_flow'
const sessionSeconds = 7 * 24 * 60 * 60
const flowSeconds = 10 * 60
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')

export function authRequired() {
  return !!(
    process.env.NODE_ENV === 'production' ||
    process.env.PIXLOOM_GOOGLE_CLIENT_ID ||
    process.env.PIXLOOM_GOOGLE_CLIENT_SECRET
  )
}

export function googleConfig() {
  const clientId = process.env.PIXLOOM_GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.PIXLOOM_GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret)
    throw new StoreError('Google 登录尚未配置', 503)
  let origin: string
  try {
    origin = workspaceOrigin()
  } catch {
    throw new StoreError('Google 登录地址配置无效', 503)
  }
  return {
    clientId,
    clientSecret,
    origin,
    redirectUri: `${origin}/api/auth/callback/google`,
  }
}

export function googleConfigured() {
  try {
    googleConfig()
    return true
  } catch {
    return false
  }
}

function client() {
  const config = googleConfig()
  return new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    transporterOptions: { timeout: 10000, retry: false },
  })
}

export function authCookieName(name: string) {
  return (name === sessionCookie || name === flowCookie) &&
    workspaceOrigin().startsWith('https:')
    ? `__Host-${name}`
    : name
}

export function readCookie(request: Request, name: string) {
  name = authCookieName(name)
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

export function setAuthCookie(
  response: NextResponse,
  name: string,
  value: string,
  maxAge: number,
) {
  response.cookies.set(authCookieName(name), value, {
    httpOnly: true,
    secure: googleConfigured() && googleConfig().origin.startsWith('https:'),
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
}

export function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export function assertAuthOrigin(request: Request) {
  if (workspaceRequestOrigin(request) !== googleConfig().origin)
    throw new StoreError(
      '代理未保留工作台域名，请保留 Host 或 X-Forwarded-Host 为配置的工作台域名',
      400,
    )
}

export async function startGoogleLogin() {
  if (maintenanceMode()) throw new StoreError('平台正在升级，请稍后重试', 503)
  transaction(() => takeRate('google:global', 60))
  const oauth = client()
  const { codeVerifier, codeChallenge } =
    await oauth.generateCodeVerifierAsync()
  const browserToken = token(),
    state = token(),
    nonce = token()
  db().prepare('DELETE FROM auth_flows WHERE expiresAt<=?').run(Date.now())
  db()
    .prepare('INSERT INTO auth_flows VALUES (?,?,?,?,?)')
    .run(
      hash(browserToken),
      state,
      nonce,
      codeVerifier,
      Date.now() + flowSeconds * 1000,
    )
  const url = oauth.generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    nonce,
    prompt: 'select_account',
    access_type: 'online',
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  })
  const response = noStore(NextResponse.redirect(url))
  setAuthCookie(response, flowCookie, browserToken, flowSeconds)
  return response
}

type Flow = {
  state: string
  nonce: string
  verifier: string
  expiresAt: number
}

export function consumeGoogleFlow(request: Request): Flow {
  const browserToken = readCookie(request, flowCookie)
  const state = new URL(request.url).searchParams.get('state') || ''
  const flow =
    browserToken &&
    (db()
      .prepare(
        'DELETE FROM auth_flows WHERE tokenHash=? RETURNING state,nonce,verifier,expiresAt',
      )
      .get(hash(browserToken)) as Flow | undefined)
  if (
    !flow ||
    flow.expiresAt <= Date.now() ||
    Buffer.byteLength(state) !== Buffer.byteLength(flow.state) ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))
  )
    throw new StoreError('登录已过期，请重新登录', 400)
  return flow
}

export async function googleIdentity(code: string, flow: Flow) {
  const oauth = client()
  const { tokens } = await oauth.getToken({ code, codeVerifier: flow.verifier })
  if (!tokens.id_token) throw new StoreError('Google 未返回登录信息', 400)
  const ticket = await oauth.verifyIdToken({
    idToken: tokens.id_token,
    audience: googleConfig().clientId,
  })
  const profile = ticket.getPayload()
  if (
    !profile?.sub ||
    profile.nonce !== flow.nonce ||
    !profile.email ||
    profile.email_verified !== true ||
    !profile.exp ||
    profile.exp * 1000 <= Date.now()
  )
    throw new StoreError('Google 登录信息无效', 400)
  let picture: string | null = null
  if (profile.picture) {
    const image = new URL(profile.picture)
    if (
      image.protocol === 'https:' &&
      image.hostname.endsWith('.googleusercontent.com')
    )
      picture = image.href
  }
  return {
    subject: profile.sub,
    name: (profile.name || profile.email).slice(0, 200),
    email: profile.email.slice(0, 320),
    picture,
  }
}

export function signInAccount(profile: {
  subject: string
  name: string
  email: string
  picture: string | null
}) {
  if (maintenanceMode()) throw new StoreError('平台正在升级，请稍后重试', 503)
  return transaction(() => {
    const existing = db()
      .prepare('SELECT * FROM users WHERE subject=?')
      .get(profile.subject) as PlatformUser | undefined
    if (existing?.status === 'disabled') throw new StoreError('账号已停用', 403)
    const first = !db().prepare('SELECT 1 FROM users LIMIT 1').get()
    const admin =
      adminEmails().includes(profile.email.toLowerCase()) ||
      (process.env.NODE_ENV !== 'production' && first && !adminEmails().length)
    const id = existing?.id || randomUUID()
    db()
      .prepare(
        `INSERT INTO users (id,subject,name,email,picture,role,status,creditLimit,createdAt)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(subject) DO UPDATE SET name=excluded.name,email=excluded.email,picture=excluded.picture`,
      )
      .run(
        id,
        profile.subject,
        profile.name,
        profile.email,
        profile.picture,
        admin ? 'admin' : 'user',
        admin ? 'active' : 'pending',
        admin ? 1_000_000_000 : 0,
        Date.now(),
      )
    if (admin && existing && existing.role !== 'admin')
      db()
        .prepare(
          "UPDATE users SET role='admin',status='active',creditLimit=MAX(creditLimit,1000000000),accessExpiresAt=NULL WHERE id=?",
        )
        .run(id)
    // Local data is claimed only by the designated administrator, never by an invitee.
    if (admin) {
      db()
        .prepare('UPDATE projects SET ownerId=? WHERE ownerId IS NULL')
        .run(id)
      db()
        .prepare('UPDATE cloud_connections SET ownerId=? WHERE ownerId IS NULL')
        .run(id)
    }
    db().prepare('DELETE FROM auth_sessions WHERE expiresAt<=?').run(Date.now())
    const session = token()
    db()
      .prepare(
        'INSERT INTO auth_sessions (tokenHash,expiresAt,userId) VALUES (?,?,?)',
      )
      .run(hash(session), Date.now() + sessionSeconds * 1000, id)
    return session
  })
}

export function sessionUser(request: Request): PlatformUser | null {
  if (!googleConfigured()) return null
  const session = readCookie(request, sessionCookie)
  if (!session || !/^[\w-]{43}$/.test(session)) return null
  return (
    (db()
      .prepare(
        `SELECT users.* FROM users JOIN auth_sessions ON auth_sessions.userId=users.id
    WHERE auth_sessions.tokenHash=? AND auth_sessions.expiresAt>?`,
      )
      .get(hash(session), Date.now()) as PlatformUser | undefined) || null
  )
}
export function currentAccount(request: Request): AccountUser | null {
  const user = sessionUser(request)
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    role: user.role,
    status: user.status,
    accessExpiresAt: user.accessExpiresAt,
  }
}
export function requireSignedIn(request: Request) {
  if (!googleConfigured()) throw new StoreError('Google 登录配置不完整', 503)
  const user = sessionUser(request)
  if (!user) throw new StoreError('请先登录 Google 账号', 401)
  if (user.status === 'disabled') throw new StoreError('账号已停用', 403)
  return user
}
export function canManagePlatform(user: PlatformUser | null) {
  return !!(
    user &&
    user.role === 'admin' &&
    user.status === 'active' &&
    (user.accessExpiresAt === null || user.accessExpiresAt > Date.now()) &&
    adminEmails().includes(user.email.trim().toLowerCase())
  )
}
export function requireAdmin(request: Request) {
  const user = requireSignedIn(request)
  if (!canManagePlatform(user)) throw new StoreError('仅管理员可访问', 403)
  return user
}
export function requireWorkspaceUser(request: Request) {
  if (maintenanceMode()) throw new StoreError('平台正在升级，请稍后重试', 503)
  if (!authRequired()) return undefined
  const user = requireSignedIn(request)
  assertActive(user)
  return user
}
export function requireProjectUser(request: Request, projectId: string) {
  const user = requireWorkspaceUser(request)
  if (user && ownerOf(projectId) !== user.id)
    throw new StoreError('项目不存在', 404)
  return user
}
export function requireTaskUser(request: Request, taskId: string) {
  requireWorkspaceUser(request)
  const task = db()
    .prepare('SELECT projectId FROM tasks WHERE id=?')
    .get(taskId) as { projectId: string } | undefined
  if (!task) throw new StoreError('任务不存在', 404)
  return requireProjectUser(request, task.projectId)
}

export function revokeSession(request: Request) {
  const session = readCookie(request, sessionCookie)
  if (session)
    db()
      .prepare('DELETE FROM auth_sessions WHERE tokenHash=?')
      .run(hash(session))
}

export function loginResponse(session: string) {
  const response = noStore(NextResponse.redirect(`${googleConfig().origin}/`))
  setAuthCookie(response, sessionCookie, session, sessionSeconds)
  setAuthCookie(response, flowCookie, '', 0)
  return response
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  LoginTicket,
  OAuth2Client,
  type TokenPayload,
} from 'google-auth-library'
import {
  consumeGoogleFlow,
  currentAccount,
  flowCookie,
  googleConfig,
  googleConfigured,
  googleIdentity,
  requireWorkspaceUser,
  sessionCookie,
  signInAccount,
  startGoogleLogin,
} from '../src/lib/auth'
import { createProject, db } from '../src/lib/store'
import { templateFiles } from '../src/lib/runtime/template'
import { GET as loginGET } from '../src/app/api/auth/google/route'
import { GET as callbackGET } from '../src/app/api/auth/callback/google/route'
import { GET as sessionGET } from '../src/app/api/auth/session/route'
import { POST as logoutPOST } from '../src/app/api/auth/logout/route'
import {
  GET as projectsGET,
  POST as projectsPOST,
} from '../src/app/api/projects/route'
import { GET as projectGET } from '../src/app/api/projects/[id]/route'
import { GET as filesGET } from '../src/app/api/projects/[id]/files/route'
import { GET as taskGET } from '../src/app/api/tasks/[id]/route'
import { GET as exportGET } from '../src/app/api/projects/[id]/versions/[versionId]/export/route'

let directory: string
const origin = 'http://127.0.0.1:3000'
const account = {
  subject: 'google-account-1',
  name: '测试用户',
  email: 'owner@example.com',
  picture: null,
}
function request(pathname = '/', cookie = '', init: RequestInit = {}) {
  return new Request(`${origin}${pathname}`, {
    ...init,
    headers: { host: '127.0.0.1:3000', cookie, ...init.headers },
  })
}
function authenticated(session: string, pathname = '/') {
  return request(pathname, `${sessionCookie}=${session}`)
}
async function loginFlow() {
  const response = await startGoogleLogin()
  const auth = new URL(response.headers.get('location')!)
  const browserToken = response.cookies.get(flowCookie)!.value
  const cookie = `${flowCookie}=${browserToken}`
  const callback = request(
    `/api/auth/callback/google?state=${auth.searchParams.get('state')}&code=authorization-code`,
    cookie,
  )
  return { response, auth, callback, cookie }
}
function mockIdentity(nonce: string, overrides: Partial<TokenPayload> = {}) {
  const payload: TokenPayload = {
    iss: 'https://accounts.google.com',
    aud: 'test-client',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: account.subject,
    nonce,
    email: account.email,
    email_verified: true,
    name: account.name,
    ...overrides,
  }
  const getToken = vi
    .spyOn(OAuth2Client.prototype, 'getToken')
    .mockResolvedValue({
      tokens: { id_token: 'google-signed-id-token' },
    } as never)
  const verify = vi
    .spyOn(OAuth2Client.prototype, 'verifyIdToken')
    .mockResolvedValue(new LoginTicket('header', payload) as never)
  return { getToken, verify }
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-auth-'))
  vi.stubEnv('PIXLOOM_DATA_DIR', directory)
  vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_ID', 'test-client')
  vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_SECRET', 'test-secret')
  vi.stubEnv('PIXLOOM_AUTH_URL', origin)
})
afterEach(async () => {
  db().close()
  delete (globalThis as { pixloomDb?: unknown }).pixloomDb
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('Google server login', () => {
  it('creates a browser-bound, one-use state with nonce and PKCE and a secure cookie policy', async () => {
    const { response, auth, callback } = await loginFlow()
    expect(auth.origin).toBe('https://accounts.google.com')
    expect(auth.searchParams.get('redirect_uri')).toBe(
      `${origin}/api/auth/callback/google`,
    )
    expect(auth.searchParams.get('scope')).toBe('openid email profile')
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    expect(auth.searchParams.get('code_challenge')).toBeTruthy()
    expect(auth.searchParams.get('nonce')).toBeTruthy()
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=lax')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(consumeGoogleFlow(callback).nonce).toBe(
      auth.searchParams.get('nonce'),
    )
    expect(() => consumeGoogleFlow(callback)).toThrow('登录已过期')
  })

  it('rejects missing browser cookies, altered state and expired flows', async () => {
    const missing = await loginFlow()
    expect(() =>
      consumeGoogleFlow(
        request(
          new URL(missing.callback.url).pathname +
            new URL(missing.callback.url).search,
        ),
      ),
    ).toThrow()
    const altered = await loginFlow()
    expect(() =>
      consumeGoogleFlow(request('/?state=wrong', altered.cookie)),
    ).toThrow()
    expect(() => consumeGoogleFlow(altered.callback)).toThrow()
    const expired = await loginFlow()
    db().prepare('UPDATE auth_flows SET expiresAt=0').run()
    expect(() => consumeGoogleFlow(expired.callback)).toThrow()
  })

  it('exchanges the code with PKCE, verifies the Google token, and creates a persistent session', async () => {
    const { auth, callback } = await loginFlow()
    const { getToken, verify } = mockIdentity(auth.searchParams.get('nonce')!)
    const response = await callbackGET(callback)
    expect(response.headers.get('location')).toBe(`${origin}/`)
    expect(getToken).toHaveBeenCalledWith({
      code: 'authorization-code',
      codeVerifier: expect.any(String),
    })
    expect(verify).toHaveBeenCalledWith({
      idToken: 'google-signed-id-token',
      audience: 'test-client',
    })
    const session = response.cookies.get(sessionCookie)!.value
    expect(currentAccount(authenticated(session))).toMatchObject({
      name: account.name,
      email: account.email,
      picture: null,
    })
    const stored = db()
      .prepare('SELECT tokenHash FROM auth_sessions')
      .get() as { tokenHash: string }
    expect(stored.tokenHash).not.toBe(session)
    const publicSession = await sessionGET(authenticated(session))
    expect(await publicSession.json()).toMatchObject({
      configured: true,
      required: true,
      user: { name: account.name, email: account.email, picture: null },
    })
    const replay = await callbackGET(callback)
    expect(replay.headers.get('location')).toContain('auth_error=failed')
    expect(replay.cookies.get(sessionCookie)).toBeUndefined()
  })

  it.each([
    { nonce: 'wrong' },
    { email_verified: false },
    { exp: 1 },
    { sub: '' },
  ])('rejects invalid identity claims: %j', async (overrides) => {
    const { auth, callback } = await loginFlow()
    mockIdentity(auth.searchParams.get('nonce')!, overrides)
    const response = await callbackGET(callback)
    expect(response.headers.get('location')).toContain('auth_error=failed')
    expect(db().prepare('SELECT * FROM auth_account').all()).toHaveLength(0)
  })

  it('does not establish a session for an invalid token signature', async () => {
    const { auth, callback } = await loginFlow()
    const { verify } = mockIdentity(auth.searchParams.get('nonce')!)
    verify.mockRejectedValue(new Error('invalid signature'))
    const response = await callbackGET(callback)
    expect(response.headers.get('location')).toContain('auth_error=failed')
    expect(db().prepare('SELECT * FROM auth_sessions').all()).toHaveLength(0)
  })

  it('handles cancelled consent without a session or upstream token request', async () => {
    const { auth, cookie } = await loginFlow()
    const response = await callbackGET(
      request(
        `/api/auth/callback/google?state=${auth.searchParams.get('state')}&error=access_denied`,
        cookie,
      ),
    )
    expect(response.headers.get('location')).toBe(
      `${origin}/?auth_error=cancelled`,
    )
    expect(response.cookies.get(flowCookie)?.maxAge).toBe(0)
    expect(db().prepare('SELECT * FROM auth_sessions').all()).toHaveLength(0)
  })

  it('allows another identity to sign in but requires invitation activation', () => {
    const session = signInAccount(account)
    const other = signInAccount({ ...account, subject: 'different-account' })
    expect(currentAccount(authenticated(other))?.status).toBe('pending')
    expect(() => requireWorkspaceUser(authenticated(other))).toThrow('邀请码')
    expect(() => requireWorkspaceUser(authenticated(session))).not.toThrow()
    signInAccount({ ...account, name: '更新名称' })
    expect(currentAccount(authenticated(session))?.name).toBe('更新名称')
  })

  it('revokes sessions on logout and rejects cross-origin logout', async () => {
    const session = signInAccount(account)
    const cookie = `${sessionCookie}=${session}`
    const crossOrigin = await logoutPOST(
      request('/api/auth/logout', cookie, {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
    )
    expect(crossOrigin.status).toBe(403)
    expect(currentAccount(authenticated(session))).not.toBeNull()
    const response = await logoutPOST(
      request('/api/auth/logout', cookie, {
        method: 'POST',
        headers: { origin, 'Content-Type': 'application/json' },
        body: '{}',
      }),
    )
    expect(response.status).toBe(200)
    expect(response.cookies.get(sessionCookie)?.maxAge).toBe(0)
    expect(currentAccount(authenticated(session))).toBeNull()
    expect(() => requireWorkspaceUser(authenticated(session))).toThrow(
      '请先登录',
    )
  })

  it('expires sessions and rejects forged cookies', () => {
    const session = signInAccount(account)
    expect(currentAccount(authenticated('x'.repeat(43)))).toBeNull()
    db().prepare('UPDATE auth_sessions SET expiresAt=0').run()
    expect(currentAccount(authenticated(session))).toBeNull()
  })

  it('protects project reads, source, task, export and mutation before accessing data', async () => {
    const project = createProject('Private project', await templateFiles())
    expect((await projectsGET(request('/api/projects'))).status).toBe(401)
    expect(
      (await projectGET(request(), { params: { id: project.id } })).status,
    ).toBe(401)
    expect(
      (await filesGET(request(), { params: { id: project.id } })).status,
    ).toBe(401)
    expect(
      (await taskGET(request(), { params: { id: 'unknown' } })).status,
    ).toBe(401)
    expect(
      (
        await exportGET(request(), {
          params: { id: project.id, versionId: 'unknown' },
        })
      ).status,
    ).toBe(401)
    const mutation = await projectsPOST(
      request('/api/projects', '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Unauthorized' }),
      }),
    )
    expect(mutation.status).toBe(401)
    const session = signInAccount(account)
    expect(
      (await projectsGET(authenticated(session, '/api/projects'))).status,
    ).toBe(200)
    expect(
      (await filesGET(authenticated(session), { params: { id: project.id } }))
        .status,
    ).toBe(200)
  })

  it('requires the configured callback origin and fails closed for partial configuration', async () => {
    expect(
      (await loginGET(new Request('http://localhost:3000/api/auth/google')))
        .status,
    ).toBe(400)
    vi.stubEnv(
      'PIXLOOM_AUTH_URL',
      'https://pixloom.io/api/auth/callback/google',
    )
    expect(() => googleConfig()).toThrow('配置无效')
    vi.stubEnv('PIXLOOM_AUTH_URL', origin)
    vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_SECRET', '')
    expect(googleConfigured()).toBe(false)
    expect((await projectsGET(request())).status).toBe(503)
    const status = await sessionGET(request())
    expect(await status.json()).toEqual({
      configured: false,
      required: true,
      user: null,
    })
    vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_ID', '')
    expect((await projectsGET(request())).status).toBe(200)
  })
})

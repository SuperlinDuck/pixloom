import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createProject, db } from '../src/lib/store'
import {
  reserveSharedEnvironment,
  sharedEnvironment,
} from '../src/lib/cloud/shared-store'
import { sharedManifest } from '../src/lib/cloud/manifest'
import { browserAuth } from '../src/lib/cloud/browser-auth'
import {
  authenticateShared,
  digestToken,
  PERSISTENT_SESSION_MS,
} from '../src/lib/cloud/shared-auth'
import { seal, unseal } from '../src/lib/cloud/crypto'
import type { SharedCloudManifest } from '../src/lib/cloud/types'

vi.mock('../src/lib/cloud/shared-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/cloud/shared-db')>()),
  sharedTransaction: async (
    _env: unknown,
    action: (client: unknown) => unknown,
  ) =>
    action({
      query: async (sql: string) =>
        sql.includes('SELECT count(*)')
          ? { rows: [{ n: 0 }], rowCount: 1 }
          : { rows: [], rowCount: 1 },
    }),
}))
let directory: string
let manifest: SharedCloudManifest
let fetchMock: ReturnType<typeof vi.fn>
let refreshes: number
const user = {
  id: 'b3382354-ce29-48ee-a59b-b57439839766',
  email: 'test@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
}
const origin = 'https://pixloom.test'
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
function upstream(url: string | URL | Request, init?: RequestInit) {
  const value = new URL(String(url))
  if (value.pathname === '/auth/v1/token') {
    if (value.searchParams.get('grant_type') === 'refresh_token') refreshes++
    return Promise.resolve(
      json({
        access_token: 'upstream-access-' + refreshes,
        refresh_token: 'upstream-refresh-' + refreshes,
        expires_in: 3600,
        user,
      }),
    )
  }
  if (value.pathname === '/auth/v1/user') return Promise.resolve(json(user))
  throw new Error('Unexpected upstream request')
}
function environment(env: 'development' | 'production' = 'development') {
  const project = createProject('Persistent auth', [
    { path: 'index.html', content: '<div id="root"></div>' },
    { path: 'src/main.jsx', content: 'console.log(1)' },
  ])
  reserveSharedEnvironment(project.id, env)
  db()
    .prepare(
      "UPDATE cloud_environments_v2 SET status='ready' WHERE projectId=?",
    )
    .run(project.id)
  db()
    .prepare("UPDATE cloud_apps_v2 SET status='ready' WHERE projectId=?")
    .run(project.id)
  return sharedManifest(project.id, env)
}
async function auth(
  action: string,
  cookie?: string,
  value: unknown = {},
  bound = manifest,
  source: string | null = origin,
) {
  return browserAuth(
    new Request(origin + '/api/app-auth/candidate/' + action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(source ? { Origin: source } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(value),
    }),
    bound,
    origin,
  )
}
async function login(bound = manifest, cookie?: string) {
  const response = await auth(
    'signin',
    cookie,
    { email: user.email, password: 'valid-password' },
    bound,
  )
  expect(response.status, await response.clone().text()).toBe(200)
  return {
    cookie: response.headers.get('set-cookie')!.split(';')[0],
    session: await response.json(),
    response,
  }
}
function root(cookie: string, bound = manifest) {
  return db()
    .prepare(
      'SELECT s.* FROM cloud_browser_sessions_v3 b JOIN cloud_sessions_v2 s ON s.tokenHash=b.sessionHash WHERE b.browserHash=? AND b.environmentId=?',
    )
    .get(digestToken(cookie.split('=')[1]), bound.environmentId) as {
    tokenHash: string
    tokens: string
    expiresAt: number
  }
}
function expireUpstream(cookie: string) {
  const session = root(cookie)
  const tokens = JSON.parse(
    unseal(session.tokens, `shared-session:${session.tokenHash}`),
  )
  tokens.expires_at = Math.floor(Date.now() / 1000) - 1
  db()
    .prepare('UPDATE cloud_sessions_v2 SET tokens=? WHERE tokenHash=?')
    .run(
      seal(JSON.stringify(tokens), `shared-session:${session.tokenHash}`),
      session.tokenHash,
    )
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-browser-auth-'))
  vi.stubEnv('PIXLOOM_DATA_DIR', directory)
  vi.stubEnv('PIXLOOM_CLOUD_ENCRYPTION_KEY', '12'.repeat(32))
  vi.stubEnv('PIXLOOM_CLOUD_RUNTIME_URL', 'http://127.0.0.1:4180')
  vi.stubEnv('PIXLOOM_CLOUD_MAX_APPS', '30')
  for (const [env, ref] of [
    ['DEV', 'abcdefghijklmnopqrst'],
    ['PROD', 'bcdefghijklmnopqrstu'],
  ]) {
    vi.stubEnv(`PIXLOOM_CLOUD_${env}_PROJECT_REF`, ref)
    vi.stubEnv(
      `PIXLOOM_CLOUD_${env}_DATABASE_URL`,
      'postgresql://postgres:secret@127.0.0.1:5432/postgres',
    )
    vi.stubEnv(`PIXLOOM_CLOUD_${env}_PUBLISHABLE_KEY`, 'sb_publishable_test')
    vi.stubEnv(`PIXLOOM_CLOUD_${env}_SECRET_KEY`, 'sb_secret_test')
  }
  refreshes = 0
  fetchMock = vi.fn(upstream)
  vi.stubGlobal('fetch', fetchMock)
  manifest = environment()
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  const state = globalThis as unknown as { pixloomDb?: { close(): void } }
  state.pixloomDb?.close()
  delete state.pixloomDb
  await rm(directory, { recursive: true, force: true })
})

describe('seven-day browser auth', () => {
  it('issues a host-only HttpOnly cookie, keeps upstream tokens encrypted and restores using a different short access token', async () => {
    const before = Date.now(),
      signed = await login()
    const cookie = signed.response.headers.get('set-cookie')!
    expect(cookie).toContain('__Host-pixloom_cloud=')
    for (const attribute of [
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Path=/',
      'Max-Age=604800',
    ])
      expect(cookie).toContain(attribute)
    expect(cookie).not.toContain('Domain=')
    expect(signed.session.expires_at * 1000 - before).toBeLessThanOrEqual(
      300000,
    )
    expect(root(signed.cookie).expiresAt - before).toBeGreaterThanOrEqual(
      PERSISTENT_SESSION_MS,
    )
    expect(root(signed.cookie).tokens).not.toContain('upstream-refresh')
    expect(JSON.stringify(signed.session)).not.toContain('upstream-')
    const response = await auth('resume', signed.cookie)
    const restored = await response.json()
    expect(restored.access_token).not.toBe(signed.session.access_token)
    expect(restored.user).toEqual({ id: user.id, email: user.email })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(
      await authenticateShared(
        sharedEnvironment(manifest.projectId, 'development')!,
        'Bearer ' + restored.access_token,
      ),
    ).toMatchObject({ userId: user.id })
  })
  it('rejects cross-origin/opaque/missing origins, unknown credential fields and obsolete environment bindings', async () => {
    for (const source of [null, 'null', 'https://evil.test'])
      expect(
        (
          await auth(
            'signin',
            undefined,
            { email: user.email, password: 'valid-password' },
            manifest,
            source,
          )
        ).status,
      ).toBe(403)
    expect(
      (
        await auth('signin', undefined, {
          email: user.email,
          password: 'valid-password',
          projectId: randomUUID(),
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await auth(
          'resume',
          undefined,
          {},
          { ...manifest, generation: randomUUID() },
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await auth(
          'resume',
          undefined,
          {},
          { ...manifest, environmentId: randomUUID() },
        )
      ).status,
    ).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('revokes every short access token immediately while preserving other applications, environments and browsers', async () => {
    const a = await login(),
      other = environment(),
      production = environment('production')
    const b = await login(other, a.cookie)
    await login(production, b.cookie)
    const secondBrowser = await login()
    const restored = await (await auth('resume', a.cookie)).json()
    expect((await auth('signout', a.cookie)).status).toBe(200)
    const row = sharedEnvironment(manifest.projectId, 'development')!
    for (const token of [a.session.access_token, restored.access_token])
      await expect(
        authenticateShared(row, 'Bearer ' + token),
      ).rejects.toMatchObject({ status: 401 })
    expect(await (await auth('resume', a.cookie)).json()).toBeNull()
    for (const [cookie, bound] of [
      [b.cookie, other],
      [b.cookie, production],
      [secondBrowser.cookie, manifest],
    ] as const)
      expect(
        (await (await auth('resume', cookie, {}, bound)).json()).user.id,
      ).toBe(user.id)
  })
  it('keeps a fixed seven-day deadline across restores and token renewal', async () => {
    const now = Date.now(),
      signed = await login(),
      expiry = root(signed.cookie).expiresAt
    vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 86400000)
    expect((await auth('resume', signed.cookie)).status).toBe(200)
    expect(root(signed.cookie).expiresAt).toBe(expiry)
    expect(refreshes).toBe(1)
    vi.mocked(Date.now).mockReturnValue(expiry)
    expect(await (await auth('resume', signed.cookie)).json()).toBeNull()
  })
  it('allows immediate logout even when the browser auth rate limit is exhausted', async () => {
    const signed = await login()
    db().prepare('UPDATE cloud_rates_v2 SET count=9999').run()
    expect((await auth('signout', signed.cookie)).status).toBe(200)
    expect(root(signed.cookie)).toBeUndefined()
  })
  it('serializes refresh-token rotation for concurrent restores', async () => {
    const signed = await login()
    expireUpstream(signed.cookie)
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes('grant_type=refresh_token'))
        await new Promise((resolve) => setTimeout(resolve, 30))
      return upstream(url, init)
    })
    const responses = await Promise.all([
      auth('resume', signed.cookie),
      auth('resume', signed.cookie),
      auth('resume', signed.cookie),
    ])
    for (const response of responses)
      expect((await response.json()).user.id).toBe(user.id)
    expect(refreshes).toBe(1)
    expect(
      db().prepare('SELECT * FROM cloud_refresh_leases_v3').all(),
    ).toHaveLength(0)
  })
  it('preserves sessions on transient failures, but revokes confirmed upstream rejection', async () => {
    const signed = await login()
    fetchMock.mockResolvedValueOnce(
      json({ message: 'private backend error' }, 503),
    )
    expect((await auth('resume', signed.cookie)).status).toBe(502)
    expect(root(signed.cookie)).toBeDefined()
    expect((await auth('resume', signed.cookie)).status).toBe(200)
    fetchMock.mockResolvedValueOnce(json({ code: 'invalid_credentials' }, 401))
    expect(await (await auth('resume', signed.cookie)).json()).toBeNull()
    expect(root(signed.cookie)).toBeUndefined()
  })
  it('does not resurrect a session when logout races an in-flight restore', async () => {
    const signed = await login()
    let release!: () => void, entered!: () => void
    const ready = new Promise<void>((resolve) => (entered = resolve)),
      blocked = new Promise<void>((resolve) => (release = resolve))
    fetchMock.mockImplementationOnce(async () => {
      entered()
      await blocked
      return json(user)
    })
    const pending = auth('resume', signed.cookie)
    await ready
    await auth('signout', signed.cookie)
    release()
    expect(await (await pending).json()).toBeNull()
    expect(root(signed.cookie)).toBeUndefined()
  })
  it('fences a signin started before a concurrent logout', async () => {
    const signed = await login()
    let release!: () => void, entered!: () => void
    const ready = new Promise<void>((resolve) => (entered = resolve)),
      blocked = new Promise<void>((resolve) => (release = resolve))
    fetchMock.mockImplementationOnce(async (url, init) => {
      entered()
      await blocked
      return upstream(url, init)
    })
    const pending = auth('signin', signed.cookie, {
      email: user.email,
      password: 'valid-password',
    })
    await ready
    await auth('signout', signed.cookie)
    release()
    expect((await pending).status).toBe(409)
    expect(db().prepare('SELECT * FROM cloud_sessions_v2').all()).toHaveLength(
      0,
    )
  })
})

// Real browser checks use a disposable HTTP host, SQLite database and deterministic upstream auth.
describe.skipIf(process.env.PIXLOOM_BROWSER_TESTS !== '1')(
  'persistent auth in Chromium',
  () => {
    it.each(['preview', 'published'] as const)(
      'restores %s after reload and browser restart, synchronizes logout and blocks sibling messages',
      async (mode) => {
        const { createServer } = await import('node:http')
        const { chromium } = await import('playwright')
        const { existsSync } = await import('node:fs')
        const { sharedRuntimeHandler } =
          await import('../src/lib/cloud/shared-runtime')
        const { runtimePreviewHeaders } =
          await import('../src/lib/runtime/preview')
        const { installPreviewAuthBridge } =
          await import('../src/lib/cloud/preview-bridge')
        const { sharedClientSource } =
          await import('../src/lib/cloud/shared-client')
        const { POST } =
          await import('../src/app/api/app-auth/[artifactId]/[action]/route')
        if (mode === 'published') manifest = environment('production')
        const { publishedHeaders, gatewayHandler } =
          await import('../src/lib/publication/gateway')
        let publishedGateway: ReturnType<typeof gatewayHandler> | undefined
        const artifact = randomUUID(),
          prefix = `/api/previews/${artifact}/`
        const app = `import {cloud} from './cloud.js';window.testCloud=cloud;const output=document.querySelector('output');const render=async()=>{try{const user=await cloud.getUser();output.textContent=user?user.email:'请登录'}catch(e){output.textContent=e.message}};document.querySelector('#login').onclick=async()=>{try{await cloud.signIn('test@example.com','valid-password');await render()}catch(e){output.textContent=e.message}};document.querySelector('#logout').onclick=async()=>{try{await cloud.signOut();await render()}catch(e){output.textContent=e.message}};render();`
        let origin = '',
          authCalls = 0,
          offlineLogout = false
        const server = createServer(async (req, res) => {
          if (req.url?.startsWith('/__pixloom/auth/')) {
            authCalls++
            if (offlineLogout && req.url.endsWith('/signout')) {
              res.destroy()
              return
            }
            return publishedGateway!(req, res)
          }
          try {
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.from(chunk))
            const url = new URL(req.url!, 'http://' + req.headers.host)
            const request = new Request(url, {
              method: req.method,
              headers: req.headers as Record<string, string>,
              ...(!['GET', 'HEAD'].includes(req.method!)
                ? { body: Buffer.concat(chunks).toString() }
                : {}),
            })
            let result: Response
            if (url.pathname === '/preview')
              result = new Response(
                mode === 'preview'
                  ? `<iframe sandbox="allow-scripts"></iframe><script>const __name=(value)=>value;(${installPreviewAuthBridge.toString()})(document.querySelector('iframe'),${JSON.stringify(artifact)})</script>`
                  : `<div id="root"><button id="login">登录</button><button id="logout">退出</button><output>加载中</output></div><script type="module" src="${prefix}app.js"></script>`,
                {
                  headers:
                    mode === 'preview'
                      ? { 'Content-Type': 'text/html' }
                      : publishedHeaders(
                          'text/html',
                          false,
                          manifest.endpoint + '/',
                        ),
                },
              )
            else if (url.pathname.startsWith('/api/app-auth/')) {
              authCalls++
              if (offlineLogout && url.pathname.endsWith('/signout')) {
                res.destroy()
                return
              }
              result = await POST(request, {
                params: {
                  artifactId: artifact,
                  action: url.pathname.split('/').at(-1)!,
                },
              })
            } else if (url.pathname.startsWith('/cloud/v2/'))
              result = await sharedRuntimeHandler(request, 'browser-fixture')
            else {
              const file = url.pathname.slice(prefix.length)
              const body =
                file === 'index.html'
                  ? `<div id="root"><button id="login">登录</button><button id="logout">退出</button><output>加载中</output></div><script type="module" src="${prefix}app.js"></script>`
                  : file === 'app.js'
                    ? app
                    : file === 'cloud.js'
                      ? sharedClientSource.replaceAll(
                          'import.meta.env.BASE_URL',
                          JSON.stringify(prefix),
                        )
                      : file === 'pixloom-cloud.json'
                        ? JSON.stringify(manifest)
                        : ''
              result = new Response(body, {
                status: body ? 200 : 404,
                headers:
                  mode === 'published'
                    ? publishedHeaders(
                        file.endsWith('.json')
                          ? 'application/json'
                          : 'text/javascript',
                        false,
                        manifest.endpoint + '/',
                      )
                    : runtimePreviewHeaders(
                        request,
                        file.endsWith('.html')
                          ? 'text/html'
                          : file.endsWith('.json')
                            ? 'application/json'
                            : 'text/javascript',
                        manifest.endpoint + '/',
                      ),
              })
            }
            res.writeHead(result.status, Object.fromEntries(result.headers))
            res.end(Buffer.from(await result.arrayBuffer()))
          } catch {
            res.writeHead(500).end()
          }
        })
        await new Promise<void>((resolve) =>
          server.listen(0, '127.0.0.1', resolve),
        )
        const address = server.address() as { port: number }
        origin = `http://127.0.0.1:${address.port}`
        if (mode === 'preview') vi.stubEnv('PIXLOOM_AUTH_URL', origin)
        vi.stubEnv('PIXLOOM_CLOUD_RUNTIME_URL', origin)
        manifest = {
          ...manifest,
          endpoint: `${origin}/cloud/v2/apps/${manifest.projectId}/environments/${manifest.environment}/${manifest.generation}`,
        }
        db()
          .prepare('INSERT INTO preview_artifacts VALUES (?,?,?,?,?,?)')
          .run(
            artifact,
            manifest.projectId,
            'fixture',
            'fixture',
            100,
            new Date().toISOString(),
          )
        db()
          .prepare('INSERT INTO preview_assets VALUES (?,?,?,?)')
          .run(
            artifact,
            'pixloom-cloud.json',
            'application/json',
            Buffer.from(JSON.stringify(manifest)),
          )
        if (mode === 'published') {
          const store = await import('../src/lib/store')
          const publication = await import('../src/lib/publication/store')
          const { publicationConfig, publicationTarget } =
            await import('../src/lib/publication/config')
          // A real registered release exercises the gateway's app/host/environment binding.
          const draft = store.getDraft(manifest.projectId)
          store.enqueueTask(
            manifest.projectId,
            'initialize',
            draft.revision,
            null,
          )
          const task = store.claimTask()!
          const version = store.completeBuild(task, 'fixture', randomUUID(), [
            {
              path: 'index.html',
              contentType: 'text/html',
              body: Buffer.from('fixture').toString('base64'),
            },
            {
              path: 'pixloom-cloud.json',
              contentType: 'application/json',
              body: Buffer.from(JSON.stringify(manifest)).toString('base64'),
            },
          ])!
          vi.stubEnv('PIXLOOM_PUBLISH_ENABLED', '1')
          vi.stubEnv('PIXLOOM_PUBLISH_DOMAIN', 'apps.localhost')
          vi.stubEnv('PIXLOOM_GATEWAY_PORT', String(address.port))
          vi.stubEnv('PIXLOOM_PUBLISH_PORT', String(address.port))
          const config = publicationConfig(),
            target = publicationTarget(manifest.projectId, config)
          publication.enqueuePublication(
            manifest.projectId,
            {
              action: 'publish',
              versionId: version.id,
              expectedReleaseId: null,
            },
            target,
          )
          const publishTask = store.claimTask()!
          publication.setReleasePhase(publishTask, 'verifying')
          publication.completePublication(publishTask)
          publishedGateway = gatewayHandler(config)
          origin = target.url
        }
        const launch = () =>
          chromium.launch({
            headless: true,
            channel: existsSync(chromium.executablePath())
              ? undefined
              : 'chrome',
            chromiumSandbox: true,
            env: Object.fromEntries(
              ['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].flatMap((key) =>
                process.env[key] ? [[key, process.env[key]!]] : [],
              ),
            ),
          })
        let browser = await launch()
        try {
          let context = await browser.newContext()
          let page = await context.newPage()
          await page.goto(origin + '/preview')
          const ui = (target = page) =>
            mode === 'preview' ? target.frameLocator('iframe') : target
          const text = () => ui().locator('output')
          await text().filter({ hasText: '请登录' }).waitFor()
          await ui().locator('#login').click()
          await text().filter({ hasText: user.email }).waitFor()
          const accessTokens = () =>
            db()
              .prepare('SELECT count(*) AS n FROM cloud_access_tokens_v3')
              .get() as { n: number }
          const beforeCalls = authCalls
          await page.evaluate(() => {
            const c = new MessageChannel()
            window.postMessage(
              { type: 'pixloom-cloud-auth-v1', action: 'resume' },
              location.origin,
              [c.port2],
            )
            c.port1.close()
          })
          await page.waitForTimeout(100)
          expect(authCalls).toBe(beforeCalls)
          await page.reload()
          await text().filter({ hasText: user.email }).waitFor()
          const saved = await context.storageState()
          expect(saved.cookies[0]).toMatchObject({
            httpOnly: true,
            sameSite: 'Lax',
          })
          expect(saved.cookies[0].expires * 1000).toBeGreaterThan(
            Date.now() + 6 * 86400000,
          )
          for (const o of saved.origins)
            for (const item of o.localStorage)
              expect(item.value).not.toMatch(
                /upstream-|access_token|refresh_token/,
              )
          await browser.close()
          browser = await launch()
          context = await browser.newContext({ storageState: saved })
          page = await context.newPage()
          await page.goto(origin + '/preview')
          await text().filter({ hasText: user.email }).waitFor()
          const second = await context.newPage()
          await second.goto(origin + '/preview')
          await ui(second)
            .locator('output')
            .filter({ hasText: user.email })
            .waitFor()
          expect(accessTokens().n).toBeGreaterThan(1)
          await ui().locator('#logout').click()
          await text().filter({ hasText: '请登录' }).waitFor()
          await ui(second)
            .locator('output')
            .filter({ hasText: '请登录' })
            .waitFor()
          await page.reload()
          await text().filter({ hasText: '请登录' }).waitFor()
          expect(accessTokens().n).toBe(0)
          // An offline logout leaves only a non-secret marker; reconnect must revoke before any restore.
          await ui().locator('#login').click()
          await text().filter({ hasText: user.email }).waitFor()
          offlineLogout = true
          await ui().locator('#logout').click()
          await text().filter({ hasText: 'Failed to fetch' }).waitFor()
          const offline = await context.storageState()
          expect(
            offline.origins.some((o) =>
              o.localStorage.some((item) =>
                item.name.startsWith('pixloom:pending-logout:'),
              ),
            ),
          ).toBe(true)
          offlineLogout = false
          await page.reload()
          await text().filter({ hasText: '请登录' }).waitFor()
          expect(
            db().prepare('SELECT * FROM cloud_browser_sessions_v3').all(),
          ).toHaveLength(0)
        } finally {
          await browser.close()
          await new Promise<void>((resolve) => server.close(() => resolve()))
        }
      },
      60000,
    )

    it('uses the same trusted bridge in the worker browser verifier', async () => {
      const { verifyBrowser } = await import('../src/lib/browser')
      const { sharedClientSource } =
        await import('../src/lib/cloud/shared-client')
      const { sharedRuntimeHandler } =
        await import('../src/lib/cloud/shared-runtime')
      const artifact = randomUUID(),
        base = `/api/previews/${artifact}/`
      const asset = (path: string, body: string) => ({
        path,
        contentType: 'ignored',
        body: Buffer.from(body).toString('base64'),
      })
      const assets = [
        asset(
          'index.html',
          `<div id="root"><button>登录</button><output>请登录</output></div><script type="module" src="${base}app.js"></script>`,
        ),
        asset(
          'app.js',
          `import {cloud} from './cloud.js';document.querySelector('button').onclick=async()=>{try{await cloud.signIn('test@example.com','valid-password');document.querySelector('output').textContent=(await cloud.getUser()).email}catch(e){document.querySelector('output').textContent=e.message}}`,
        ),
        asset(
          'cloud.js',
          sharedClientSource.replaceAll(
            'import.meta.env.BASE_URL',
            JSON.stringify(base),
          ),
        ),
        asset('pixloom-cloud.json', JSON.stringify(manifest)),
      ]
      const report = await verifyBrowser(
        artifact,
        assets,
        [
          { action: 'click', selector: 'button', value: '' },
          { action: 'assert_text', selector: 'output', value: user.email },
        ],
        new AbortController().signal,
        async (input) => {
          const response = await sharedRuntimeHandler(
            new Request(input.url, {
              method: input.method,
              headers: input.headers,
              body: input.body ? new Uint8Array(input.body) : null,
            }),
          )
          return {
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
          }
        },
      )
      expect(report, report.output).toMatchObject({
        ok: true,
        completedSteps: 2,
      })
    }, 30000)
  },
)

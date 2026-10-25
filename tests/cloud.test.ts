import {
  cloudTestAccount,
  cleanupTestAccount,
  redactTestCredentials,
  assertNoTestCredentials,
} from '../src/lib/cloud/test-account'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { parse } from 'acorn'
import {
  createProject,
  db,
  getDraft,
  claimTask,
  getTask,
  cancelTask,
  acquireWorker,
  completeBuild,
  updateDraft,
  enqueueTask,
} from '../src/lib/store'
import { templateFiles } from '../src/lib/runtime/template'
import { seal, unseal } from '../src/lib/cloud/crypto'
import {
  cloudStatus,
  reserveBinding,
  resources,
  setCloudPreference,
  enqueueCloudSetup,
} from '../src/lib/cloud/store'
import { prepareCloud } from '../src/lib/cloud/provision'
import {
  saveConnection,
  startSupabaseOAuth,
  finishSupabaseOAuth,
  cloudFlowCookie,
  externalToken,
} from '../src/lib/cloud/oauth'
import {
  cloudManifest,
  withCloudConfig,
  readManifest,
  productionAssets,
  cloudNetworkAllowed,
  artifactManifest,
} from '../src/lib/cloud/manifest'
import {
  compileSchema,
  cloudSchema,
  applySchema,
} from '../src/lib/cloud/schema'
import { cloudClientSource, CLOUD_CLIENT_PATH } from '../src/lib/cloud/client'
import { appFunctions, deployFunctions } from '../src/lib/cloud/functions'
import { enableCloud, syncBackend } from '../src/lib/cloud/backend'
import {
  GET as statusGET,
  POST as setupPOST,
  PATCH as preferencePATCH,
} from '../src/app/api/projects/[id]/cloud/route'
import { runtimePreviewHeaders } from '../src/lib/runtime/preview'
import { publishedHeaders } from '../src/lib/publication/gateway'
import { runTask } from '../src/lib/runner'
import {
  enqueuePublication,
  liveRelease,
  getRelease,
} from '../src/lib/publication/store'
import {
  publicationConfig,
  publicationTarget,
} from '../src/lib/publication/config'
import { PublicationFiles } from '../src/lib/publication/files'
import type { SourceFile } from '../src/lib/types'

let directory: string, files: SourceFile[]
const refs = [
  'abcdefghijklmnopqrst',
  'bcdefghijklmnopqrstu',
  'cdefghijklmnopqrstuv',
  'defghijklmnopqrstuvw',
]
const origin = 'http://127.0.0.1:3000'
const active = () => ({ signal: new AbortController().signal, check() {} })
const project = () => createProject('Cloud test', files)
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
function request(body?: unknown, method = 'POST') {
  return new Request(
    `${origin}/api/cloud`,
    body
      ? {
          method,
          headers: { 'Content-Type': 'application/json', origin },
          body: JSON.stringify(body),
        }
      : {},
  )
}
function fakeSupabase(
  options: { pending?: boolean; loseCreate?: boolean } = {},
) {
  const projects: { id: string; name: string; organization_id: string }[] = []
  const calls: { pathname: string; method: string; body: unknown }[] = []
  const fetch = vi.fn(
    async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const method = init.method || 'GET'
      const body =
        init.body instanceof FormData
          ? init.body
          : init.body
            ? JSON.parse(String(init.body))
            : undefined
      calls.push({ pathname: url.pathname, method, body })
      if (url.pathname === '/v1/projects' && method === 'GET')
        return json(projects)
      if (url.pathname === '/v1/projects' && method === 'POST') {
        const row = {
          id: refs[projects.length],
          name: body.name,
          organization_id: body.organization_slug,
        }
        projects.push(row)
        if (options.loseCreate)
          throw new Error('lost response with secret upstream body')
        return json(row, 201)
      }
      if (url.pathname.endsWith('/health'))
        return json([
          {
            name: 'auth',
            status: options.pending ? 'COMING_UP' : 'ACTIVE_HEALTHY',
          },
        ])
      if (url.pathname.endsWith('/api-keys'))
        return json([
          { type: 'secret', api_key: 'sb_secret_never_expose' },
          {
            type: 'publishable',
            name: 'publishable',
            api_key: 'sb_publishable_testkey',
          },
        ])
      if (url.pathname.endsWith('/config/auth')) return json({})
      if (url.pathname.endsWith('/database/migrations')) return json({})
      if (url.pathname.endsWith('/functions/deploy'))
        return json({ status: 'ACTIVE' }, 201)
      if (url.pathname.endsWith('/database/query'))
        return json([
          { table_name: 'todos', column_name: 'title', data_type: 'text' },
        ])
      throw new Error('Unexpected network request: ' + url.pathname)
    },
  )
  vi.stubGlobal('fetch', fetch)
  return { projects, calls, fetch }
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-cloud-'))
  vi.stubEnv('PIXLOOM_DATA_DIR', directory)
  vi.stubEnv('PIXLOOM_AUTH_URL', origin)
  vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_ID', '')
  vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_SECRET', '')
  vi.stubEnv('PIXLOOM_CLOUD_ENCRYPTION_KEY', '12'.repeat(32))
  vi.stubEnv('PIXLOOM_CLOUD_LEGACY_PROVISIONING', '1')
  vi.stubEnv('PIXLOOM_SUPABASE_ACCESS_TOKEN', 'platform-secret-token')
  vi.stubEnv('PIXLOOM_SUPABASE_ORGANIZATION', 'platform-org')
  vi.stubEnv('PIXLOOM_SUPABASE_REGION', 'apac')
  vi.stubEnv('PIXLOOM_CLOUD_MAX_PROJECTS', '4')
  vi.stubEnv('PIXLOOM_SUPABASE_CLIENT_ID', 'oauth-client')
  vi.stubEnv('PIXLOOM_SUPABASE_CLIENT_SECRET', 'oauth-secret')
  files = await templateFiles()
})
afterEach(async () => {
  const state = globalThis as unknown as { pixloomDb?: { close(): void } }
  state.pixloomDb?.close()
  delete state.pixloomDb
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('Cloud configuration, credentials and project ownership', () => {
  it('defaults to platform Cloud without allocating a resource for static apps', () => {
    const p = project()
    expect(cloudStatus(p.id)).toMatchObject({
      mode: 'managed',
      status: 'disabled',
      managedConfigured: true,
    })
    expect(resources(p.id)).toEqual([])
    setCloudPreference(p.id, 'external')
    expect(cloudStatus(p.id).mode).toBe('external')
  })
  it('encrypts credentials with authenticated, purpose-bound encryption and refuses another key', () => {
    const value = seal('secret-access-token', 'access:one')
    expect(value).not.toContain('secret-access-token')
    expect(unseal(value, 'access:one')).toBe('secret-access-token')
    expect(() => unseal(value, 'access:two')).toThrow('无法解密')
    vi.stubEnv('PIXLOOM_CLOUD_ENCRYPTION_KEY', '34'.repeat(32))
    expect(() => unseal(value, 'access:one')).toThrow('无法解密')
  })
  it('reserves two environments atomically, enforces capacity and forbids mode switches', () => {
    const p = project()
    reserveBinding(p.id, { mode: 'managed' })
    reserveBinding(p.id, { mode: 'managed' })
    expect(resources(p.id)).toHaveLength(2)
    reserveBinding(project().id, { mode: 'managed' })
    const p3 = project()
    expect(() => reserveBinding(p3.id, { mode: 'managed' })).toThrow('上限')
    expect(resources(p3.id)).toEqual([])
    expect(() =>
      reserveBinding(p.id, {
        mode: 'external',
        development: refs[0],
        production: refs[1],
      }),
    ).toThrow('切换')
    const rows = resources(p.id)
    expect(rows[0].password).not.toEqual(rows[1].password)
  })
  it('requires separate external projects, encrypts OAuth credentials and prevents cross-app reuse', () => {
    const p = project()
    expect(() =>
      reserveBinding(p.id, {
        mode: 'external',
        development: refs[0],
        production: refs[1],
      }),
    ).toThrow('授权')
    saveConnection({
      access_token: 'external-token',
      refresh_token: 'refresh-secret',
      expires_in: 3600,
    })
    expect(
      JSON.stringify(db().prepare('SELECT * FROM cloud_connections').all()),
    ).not.toContain('external-token')
    expect(() =>
      reserveBinding(p.id, {
        mode: 'external',
        development: refs[0],
        production: refs[0],
      }),
    ).toThrow('不同')
    reserveBinding(p.id, {
      mode: 'external',
      development: refs[0],
      production: refs[1],
    })
    expect(() =>
      reserveBinding(project().id, {
        mode: 'external',
        development: refs[0],
        production: refs[2],
      }),
    ).toThrow('其他')
  })
  it('fails explicitly with missing config without making upstream calls', async () => {
    const remote = fakeSupabase()
    vi.stubEnv('PIXLOOM_SUPABASE_ACCESS_TOKEN', '')
    await expect(
      prepareCloud(project().id, { mode: 'managed' }, active()),
    ).rejects.toThrow('尚未配置')
    expect(remote.fetch).not.toHaveBeenCalled()
  })
})

describe('dual-mode provisioning and durable external side effects', () => {
  it('creates managed resources, supplies public-only configs and reuses existing projects', async () => {
    const remote = fakeSupabase(),
      p = project()
    await prepareCloud(p.id, { mode: 'managed' }, active())
    expect(remote.projects).toHaveLength(2)
    expect(cloudStatus(p.id).status).toBe('ready')
    expect(resources(p.id).every((row) => row.password === null)).toBe(true)
    const config = cloudManifest(p.id)
    if (config.format !== 'pixloom-cloud-v1')
      throw new Error('Expected legacy manifest')
    expect(JSON.stringify(config)).not.toMatch(/platform-secret|sb_secret/)
    expect(config.development.ref).not.toBe(config.production.ref)
    await prepareCloud(p.id, { mode: 'managed' }, active())
    expect(remote.projects).toHaveLength(2)
  })
  it('does not create projects or change auth settings in external mode', async () => {
    const remote = fakeSupabase(),
      p = project()
    remote.projects.push(
      { id: refs[0], name: 'Existing dev', organization_id: 'user-org' },
      { id: refs[1], name: 'Existing prod', organization_id: 'user-org' },
    )
    saveConnection({
      access_token: 'external-token',
      refresh_token: 'refresh-secret',
      expires_in: 3600,
    })
    await prepareCloud(
      p.id,
      { mode: 'external', development: refs[0], production: refs[1] },
      active(),
    )
    expect(cloudStatus(p.id)).toMatchObject({
      mode: 'external',
      status: 'ready',
    })
    expect(
      remote.calls.some((call) => call.pathname.endsWith('/config/auth')),
    ).toBe(false)
    expect(remote.calls.filter((call) => call.method === 'POST')).toHaveLength(
      0,
    )
  })
  it('reconciles a lost create response by name instead of creating duplicates', async () => {
    const options = { loseCreate: true },
      remote = fakeSupabase(options),
      p = project()
    await expect(
      prepareCloud(p.id, { mode: 'managed' }, active()),
    ).rejects.toThrow('可能未确认')
    expect(remote.projects).toHaveLength(1)
    expect(
      resources(p.id).find((row) => row.environment === 'development')?.status,
    ).toBe('uncertain')
    options.loseCreate = false
    await prepareCloud(p.id, { mode: 'managed' }, active())
    expect(remote.projects).toHaveLength(2)
    expect(cloudStatus(p.id).status).toBe('ready')
  })
  it('preserves pending refs and resumes without recreating resources', async () => {
    const options = { pending: true },
      remote = fakeSupabase(options),
      p = project()
    await expect(
      prepareCloud(p.id, { mode: 'managed' }, active()),
    ).rejects.toThrow('正在启动')
    expect(remote.projects).toHaveLength(2)
    options.pending = false
    await prepareCloud(p.id, { mode: 'managed' }, active())
    expect(remote.projects).toHaveLength(2)
  })
  it('allows retry after a definite upstream rejection without abandoning the reserved slot', async () => {
    const remote = fakeSupabase(),
      p = project(),
      original = remote.fetch.getMockImplementation()!
    remote.fetch.mockImplementation(async (input, init = {}) =>
      String(input).endsWith('/v1/projects') && init.method === 'POST'
        ? json({ error: 'forbidden' }, 403)
        : original(input, init),
    )
    await expect(
      prepareCloud(p.id, { mode: 'managed' }, active()),
    ).rejects.toThrow('权限不足')
    expect(resources(p.id).every((row) => row.status === 'reserved')).toBe(true)
    remote.fetch.mockImplementation(original)
    await prepareCloud(p.id, { mode: 'managed' }, active())
    expect(cloudStatus(p.id).status).toBe('ready')
    expect(remote.projects).toHaveLength(2)
  })
  it('retains an unconfirmed reservation if the remote project cannot be found', async () => {
    const remote = fakeSupabase({ loseCreate: true }),
      p = project()
    await expect(
      prepareCloud(p.id, { mode: 'managed' }, active()),
    ).rejects.toThrow()
    remote.projects.splice(0)
    await expect(
      prepareCloud(p.id, { mode: 'managed' }, active()),
    ).rejects.toThrow('不会重复创建')
    expect(remote.calls.filter((call) => call.method === 'POST')).toHaveLength(
      1,
    )
  })
  it('runs setup through the serial worker without Docker and rejects cancelled queue entries', async () => {
    fakeSupabase()
    const p = project()
    enqueueCloudSetup(p.id, { mode: 'managed' })
    const task = claimTask()!
    const controller = new AbortController()
    await runTask(task, undefined, controller.signal)
    expect(getTask(task.id).status).toBe('completed')
    expect(getDraft(p.id).revision).toBe(0)
    expect(cloudStatus(p.id).status).toBe('ready')
    enqueueCloudSetup(p.id, { mode: 'managed' })
    const queued = claimTask()!
    cancelTask(queued.id)
    await runTask(queued)
    expect(getTask(queued.id).status).toBe('cancelled')
  })
})

describe('Supabase OAuth', () => {
  async function flow() {
    const p = project(),
      response = startSupabaseOAuth(new Request(origin), p.id)
    const url = new URL(response.headers.get('location')!)
    const browser = response.cookies.get(cloudFlowCookie)!.value
    return {
      p,
      response,
      url,
      callback: new Request(
        `${origin}/api/cloud/supabase/callback?state=${url.searchParams.get('state')}&code=test-code`,
        { headers: { cookie: `${cloudFlowCookie}=${browser}` } },
      ),
    }
  }
  it('binds authorization to a browser, enforces PKCE, consumes state once and encrypts tokens', async () => {
    const f = await flow()
    expect(f.url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(f.response.cookies.get(cloudFlowCookie)?.httpOnly).toBe(true)
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const values = new URLSearchParams(String(init?.body))
      expect(values.get('code_verifier')).toBeTruthy()
      expect(values.get('redirect_uri')).toBe(
        origin + '/api/cloud/supabase/callback',
      )
      return json({
        access_token: 'oauth-access',
        refresh_token: 'oauth-refresh',
        expires_in: 3600,
      })
    })
    vi.stubGlobal('fetch', fetch)
    const response = await finishSupabaseOAuth(f.callback)
    expect(response.headers.get('location')).toContain('cloudProject=' + f.p.id)
    expect(await externalToken('workspace-supabase')).toBe('oauth-access')
    expect(
      JSON.stringify(db().prepare('SELECT * FROM cloud_connections').all()),
    ).not.toContain('oauth-access')
    await expect(finishSupabaseOAuth(f.callback)).rejects.toThrow('过期')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects forged/missing browser state before exchanging tokens', async () => {
    const f = await flow()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      finishSupabaseOAuth(new Request(f.callback.url)),
    ).rejects.toThrow('过期')
    const changed = new URL(f.callback.url)
    changed.searchParams.set('state', 'forged')
    await expect(
      finishSupabaseOAuth(
        new Request(changed, { headers: f.callback.headers }),
      ),
    ).rejects.toThrow('过期')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('refreshes expired OAuth credentials and keeps replacements encrypted', async () => {
    saveConnection({
      access_token: 'expired',
      refresh_token: 'old-refresh',
      expires_in: 1,
    })
    const fetch = vi.fn(async () =>
      json({
        access_token: 'fresh-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    )
    vi.stubGlobal('fetch', fetch)
    expect(await externalToken('workspace-supabase')).toBe('fresh-access')
    expect(await externalToken('workspace-supabase')).toBe('fresh-access')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(
      JSON.stringify(db().prepare('SELECT * FROM cloud_connections').all()),
    ).not.toContain('new-refresh')
  })
})

describe('versioned backend definitions, preview and publication', () => {
  const schema = {
    tables: [
      {
        name: 'todos',
        columns: [
          { name: 'title', type: 'text' as const },
          { name: 'completed', type: 'boolean' as const },
        ],
      },
    ],
  }
  it('compiles additive user-owned tables with grants, RLS and an ownership guard', () => {
    const sql = compileSchema(schema, randomUUID())
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('AS RESTRICTIVE')
    expect(sql).toContain('REVOKE ALL')
    expect(sql).toContain('auth.uid()')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS')
    expect(sql).not.toContain('DROP TABLE')
    expect(() =>
      cloudSchema.parse({
        tables: [{ name: 'todos;drop table users', columns: [] }],
      }),
    ).toThrow()
    expect(() =>
      cloudSchema.parse({
        tables: [
          { name: 'todos', columns: [{ name: 'owner_id', type: 'text' }] },
        ],
      }),
    ).toThrow()
  })
  it('deploys development definitions separately, pins configs and uses production endpoints when published', async () => {
    const remote = fakeSupabase(),
      p = project()
    await prepareCloud(p.id, { mode: 'managed' }, active())
    await applySchema(p.id, 'development', schema, active())
    await applySchema(p.id, 'development', schema, active())
    expect(
      remote.calls.filter((call) => call.pathname.endsWith('/migrations')),
    ).toHaveLength(1)
    const source = [
      ...files,
      { path: 'src/pixloom-schema.json', content: JSON.stringify(schema) },
      { path: CLOUD_CLIENT_PATH, content: cloudClientSource },
      {
        path: 'src/backend/functions/echo.js',
        content:
          'export default async function(req, context) { return {id:context.user.id} }',
      },
    ]
    const fn = appFunctions(source)[0]
    const assets = withCloudConfig(
      [
        {
          path: 'index.html',
          contentType: 'text/html',
          body: Buffer.from('<div id="root">test</div>').toString('base64'),
        },
      ],
      p.id,
      source,
    )
    const decoded = assets.map((asset) => ({
      ...asset,
      body: Buffer.from(asset.body, 'base64'),
    }))
    const pinned = readManifest(decoded)!
    if (pinned.format !== 'pixloom-cloud-v1')
      throw new Error('Expected legacy manifest')
    expect(pinned.functions.echo).toBe(fn.slug)
    expect(pinned.environment).toBe('development')
    expect(readManifest(productionAssets(decoded))?.environment).toBe(
      'production',
    )
    await syncBackend(p.id, source, 'production', active(), pinned)
    expect(
      remote.calls.filter(
        (call) =>
          call.pathname === `/v1/projects/${refs[1]}/database/migrations`,
      ),
    ).toHaveLength(1)
    expect(
      remote.calls.find((call) => call.pathname.endsWith('/functions/deploy'))
        ?.body,
    ).toBeInstanceOf(FormData)
    await expect(
      syncBackend(p.id, source, 'production', active(), {
        ...pinned,
        projectId: randomUUID(),
      }),
    ).rejects.toThrow('变化')
    const csp = runtimePreviewHeaders(
      new Request(origin + '/api/previews/' + randomUUID() + '/index.html'),
      'text/html',
      pinned.development.url,
    )['Content-Security-Policy']
    expect(csp).toContain(pinned.development.url)
    expect(csp).not.toContain(pinned.production.url)
    expect(
      publishedHeaders('text/html', false, pinned.production.url)[
        'Content-Security-Policy'
      ],
    ).toContain(pinned.production.url)
    expect(
      cloudNetworkAllowed(
        new URL(pinned.development.url + '/rest/v1/todos'),
        pinned.development.url,
      ),
    ).toBe(true)
    expect(
      cloudNetworkAllowed(
        new URL('https://api.supabase.com/v1/projects'),
        pinned.development.url,
      ),
    ).toBe(false)
    expect(
      cloudNetworkAllowed(
        new URL(pinned.production.url + '/rest/v1/todos'),
        pinned.development.url,
      ),
    ).toBe(false)
  })
  it('wraps functions with real user authentication and handles immutable Response headers', async () => {
    const remote = fakeSupabase(),
      p = project()
    await prepareCloud(p.id, { mode: 'managed' }, active())
    await deployFunctions(
      p.id,
      'development',
      [
        {
          path: 'src/backend/functions/echo.js',
          content:
            'export default async function(request, context) { return {id:context.user.id} }',
        },
      ],
      active(),
    )
    const form = remote.calls.find((call) =>
      call.pathname.endsWith('/functions/deploy'),
    )!.body as FormData
    const wrapper = await (form.getAll('file')[0] as Blob).text()
    let handler: ((request: Request) => Promise<Response>) | undefined
    const implementation = vi.fn(async () =>
      Response.redirect('https://example.com'),
    )
    const identity = vi.fn(async () => json({ id: 'verified-user' }))
    new Function(
      'handler',
      'Deno',
      'fetch',
      wrapper.replace("import handler from './handler.js';", ''),
    )(
      implementation,
      {
        serve(value: (request: Request) => Promise<Response>) {
          handler = value
        },
      },
      identity,
    )
    identity.mockResolvedValueOnce(json({ error: 'unauthorized' }, 401))
    expect(
      (await handler!(new Request('https://example.test', { method: 'POST' })))
        .status,
    ).toBe(401)
    expect(implementation).not.toHaveBeenCalled()
    const result = await handler!(
      new Request('https://example.test', {
        method: 'POST',
        headers: { Authorization: 'Bearer user-token' },
      }),
    )
    expect(result.status).toBe(302)
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(implementation).toHaveBeenCalledOnce()
  })
  it('publishes production configuration and preserves the last live release when a later migration fails', async () => {
    const remote = fakeSupabase(),
      p = project()
    vi.stubEnv('PIXLOOM_PUBLISH_ENABLED', '1')
    vi.stubEnv('PIXLOOM_PUBLISH_DOMAIN', 'apps.localhost')
    await prepareCloud(p.id, { mode: 'managed' }, active())
    const source = [
      ...files,
      { path: CLOUD_CLIENT_PATH, content: cloudClientSource },
      { path: 'src/pixloom-schema.json', content: JSON.stringify(schema) },
    ]
    const createVersion = (candidate: SourceFile[]) => {
      const draft = getDraft(p.id)
      const saved = updateDraft(
        p.id,
        draft.revision,
        candidate.map((file) => ({
          type: 'write' as const,
          path: file.path,
          content: file.content,
        })),
      )
      enqueueTask(p.id, 'commit', saved.revision, saved.baseVersionId)
      const task = claimTask()!
      task.candidateFiles = candidate
      const id = randomUUID()
      return completeBuild(
        task,
        'test-template',
        id,
        withCloudConfig(
          [
            {
              path: 'index.html',
              contentType: 'text/html',
              body: Buffer.from('<div id="root">cloud</div>').toString(
                'base64',
              ),
            },
          ],
          p.id,
          candidate,
        ),
      )!
    }
    const v1 = createVersion(source)
    const target = publicationTarget(p.id, publicationConfig())
    const first = enqueuePublication(
      p.id,
      { action: 'publish', versionId: v1.id, expectedReleaseId: null },
      target,
    )
    const disk = new PublicationFiles()
    const verify = vi.fn(
      async (_id: string, assets: { path: string; body: string }[]) => {
        const config = JSON.parse(
          Buffer.from(
            assets.find((asset) => asset.path === 'pixloom-cloud.json')!.body,
            'base64',
          ).toString(),
        )
        expect(config.environment).toBe('production')
        expect(config.production.ref).toBe(refs[1])
        return { ok: true, output: 'verified', completedSteps: 0 }
      },
    )
    await runTask(
      claimTask()!,
      undefined,
      undefined,
      undefined,
      undefined,
      verify,
      { stage: disk.stage.bind(disk), preflight: async () => {} },
    )
    expect(liveRelease(p.id)?.id).toBe(first.release.id)
    expect(artifactManifest(v1.artifactId)?.environment).toBe('development')
    const extended = [
      ...source.filter((file) => file.path !== 'src/pixloom-schema.json'),
      {
        path: 'src/pixloom-schema.json',
        content: JSON.stringify({
          tables: [
            {
              name: 'todos',
              columns: [
                ...schema.tables[0].columns,
                { name: 'category', type: 'text' },
              ],
            },
          ],
        }),
      },
    ]
    const v2 = createVersion(extended)
    const next = enqueuePublication(
      p.id,
      {
        action: 'publish',
        versionId: v2.id,
        expectedReleaseId: first.release.id,
      },
      target,
    )
    const original = remote.fetch.getMockImplementation()!
    remote.fetch.mockImplementation(async (input, init) =>
      String(input).includes('/database/migrations')
        ? json({ message: 'secret provider detail' }, 500)
        : original(input, init),
    )
    await runTask(
      claimTask()!,
      undefined,
      undefined,
      undefined,
      undefined,
      verify,
      { stage: disk.stage.bind(disk), preflight: async () => {} },
    )
    expect(liveRelease(p.id)?.id).toBe(first.release.id)
    expect(getRelease(next.release.id).status).toBe('failed')
    expect(getTask(next.task.id).error).not.toContain('secret provider detail')
    expect(verify).toHaveBeenCalledTimes(1)
  })
  it('does not silently allocate managed resources after the user chose external mode', async () => {
    const p = project()
    setCloudPreference(p.id, 'external')
    enqueueTask(p.id, 'commit', 0, null)
    const task = claimTask()!
    await expect(enableCloud(task, active())).rejects.toThrow('自有 Supabase')
    expect(resources(p.id)).toHaveLength(0)
  })
})

describe('temporary development identities', () => {
  it.each(['managed', 'external'] as const)(
    'creates a verified test login in development only and cleans it in %s mode',
    async (mode) => {
      const remote = fakeSupabase(),
        p = project()
      if (mode === 'external') {
        saveConnection({
          access_token: 'external-token',
          refresh_token: 'refresh-secret',
          expires_in: 3600,
        })
        remote.projects.push(
          { id: refs[0], name: 'dev', organization_id: 'user' },
          { id: refs[1], name: 'prod', organization_id: 'user' },
        )
      }
      await prepareCloud(
        p.id,
        mode === 'managed'
          ? { mode }
          : { mode, development: refs[0], production: refs[1] },
        active(),
      )
      enqueueTask(p.id, 'commit', 0, null)
      const task = claimTask()!,
        userId = randomUUID(),
        calls: string[] = []
      const original = remote.fetch.getMockImplementation()!
      remote.fetch.mockImplementation(async (input, init = {}) => {
        const url = new URL(String(input))
        calls.push(url.href)
        if (url.pathname.includes('/auth/v1/admin/users')) {
          expect(url.origin).toBe(`https://${refs[0]}.supabase.co`)
          return json(init.method === 'POST' ? { id: userId } : {})
        }
        if (url.pathname.endsWith('/database/query')) return json([])
        return original(input, init)
      })
      const credentials = await cloudTestAccount(task, active())
      expect(credentials.environment).toBe('development')
      expect(credentials.email).toContain(task.id)
      expect(
        JSON.stringify(db().prepare('SELECT * FROM cloud_test_accounts').all()),
      ).not.toContain(credentials.password)
      expect(
        redactTestCredentials(
          task.id,
          credentials.email + ' ' + credentials.password,
        ),
      ).toBe('[开发测试账号] [测试密码]')
      expect(() =>
        assertNoTestCredentials(task.id, [{ content: credentials.password }]),
      ).toThrow('不要把')
      expect(await cloudTestAccount(task, active())).toEqual(credentials)
      await cleanupTestAccount(task.id)
      expect(
        db()
          .prepare('SELECT status FROM cloud_test_accounts WHERE taskId=?')
          .get(task.id),
      ).toMatchObject({ status: 'ready' })
      cancelTask(task.id)
      await cleanupTestAccount(task.id)
      expect(
        db()
          .prepare(
            'SELECT status,password FROM cloud_test_accounts WHERE taskId=?',
          )
          .get(task.id),
      ).toMatchObject({ status: 'deleted', password: '' })
      expect(
        calls.some(
          (url) => url.includes(refs[1]) && url.includes('admin/users'),
        ),
      ).toBe(false)
    },
  )
})

describe('Cloud application client and APIs', () => {
  it('runs the generated client through login, CRUD and logout with public keys only', async () => {
    parse(cloudClientSource, { ecmaVersion: 'latest', sourceType: 'module' })
    const backend = {
      ref: refs[0],
      url: `https://${refs[0]}.supabase.co`,
      publishableKey: 'sb_publishable_browser',
    }
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('opaque origin')
      },
      setItem() {
        throw new Error('opaque origin')
      },
      removeItem() {},
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url === '/pixloom-cloud.json')
          return json({ environment: 'development', development: backend })
        if (url.includes('/token'))
          return json({
            access_token: 'user-session',
            refresh_token: 'user-refresh',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          })
        if (url.includes('/auth/v1/user')) return json({ id: 'user-one' })
        if (url.includes('/logout')) return new Response(null, { status: 204 })
        if (url.includes('/rest/v1/'))
          return json([{ id: 'todo', title: 'Persisted' }])
        throw new Error(url)
      }),
    )
    const cloud = new Function(
      cloudClientSource
        .replace('import.meta.env.BASE_URL', JSON.stringify('/'))
        .replace('export const cloud', 'const cloud') + ';return cloud;',
    )()
    expect(await cloud.getUser()).toBeNull()
    await cloud.signIn('test@example.com', 'pass123456')
    expect(await cloud.getUser()).toEqual({ id: 'user-one' })
    expect(await cloud.insert('todos', { title: 'Persisted' })).toHaveLength(1)
    expect(await cloud.select('todos')).toHaveLength(1)
    const insert = calls.find(
      (call) => call.init?.method === 'POST' && call.url.includes('/rest/v1/'),
    )!
    expect(insert.init?.headers).toMatchObject({
      apikey: 'sb_publishable_browser',
      Authorization: 'Bearer user-session',
    })
    await cloud.signOut()
    expect(await cloud.getUser()).toBeNull()
  })
  it('exposes safe status, rejects cross-origin mutations and queues setup through the worker lock', async () => {
    const p = project(),
      context = { params: { id: p.id } }
    const response = await statusGET(request(), context)
    expect(response.status).toBe(200)
    expect(JSON.stringify(await response.json())).not.toContain(
      'platform-secret-token',
    )
    const cross = new Request(origin + '/api/cloud', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'managed' }),
    })
    expect((await setupPOST(cross, context)).status).toBe(403)
    acquireWorker('test-worker')
    expect(
      (await setupPOST(request({ mode: 'managed' }), context)).status,
    ).toBe(202)
    expect(
      (await preferencePATCH(request({ mode: 'external' }, 'PATCH'), context))
        .status,
    ).toBe(409)
    expect(
      (await setupPOST(request({ mode: 'managed' }), context)).status,
    ).toBe(409)
  })
})

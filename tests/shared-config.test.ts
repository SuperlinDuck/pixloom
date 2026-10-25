import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createProject, db } from '../src/lib/store'
import { configured } from '../src/lib/cloud/config'
import {
  sharedConfigured,
  sharedPoolConfig,
  runtimeOrigin,
} from '../src/lib/cloud/shared-config'
import {
  reserveSharedEnvironment,
  sharedApp,
} from '../src/lib/cloud/shared-store'
import { sharedRuntimeHandler } from '../src/lib/cloud/shared-runtime'
import {
  parseSharedCredentials,
  poolRequest,
} from '../src/lib/cloud/shared-auth'
import { cloudStatus, reserveBinding } from '../src/lib/cloud/store'
import { saveConnection } from '../src/lib/cloud/oauth'

const files = [
  { path: 'index.html', content: '<div id="root"></div>' },
  { path: 'src/main.jsx', content: 'console.log("test")' },
]
let directory: string
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-shared-config-'))
  vi.stubEnv('PIXLOOM_DATA_DIR', directory)
  vi.stubEnv('PIXLOOM_CLOUD_ENCRYPTION_KEY', '12'.repeat(32))
  vi.stubEnv('PIXLOOM_CLOUD_LEGACY_PROVISIONING', '0')
  vi.stubEnv('PIXLOOM_CLOUD_DEV_PROJECT_REF', 'abcdefghijklmnopqrst')
  vi.stubEnv(
    'PIXLOOM_CLOUD_DEV_DATABASE_URL',
    'postgresql://postgres:secret@127.0.0.1:5432/postgres',
  )
  vi.stubEnv('PIXLOOM_CLOUD_DEV_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('PIXLOOM_CLOUD_DEV_SECRET_KEY', 'sb_secret_test')
  vi.stubEnv('PIXLOOM_CLOUD_PROD_PROJECT_REF', '')
  vi.stubEnv('PIXLOOM_CLOUD_RUNTIME_URL', 'http://127.0.0.1:4180')
  vi.stubEnv('PIXLOOM_CLOUD_MAX_APPS', '2')
  vi.stubEnv('PIXLOOM_CLOUD_MAX_PROJECTS', '2')
})
afterEach(async () => {
  const state = globalThis as unknown as { pixloomDb?: { close(): void } }
  state.pixloomDb?.close()
  delete state.pixloomDb
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})
describe('Shared Cloud default configuration', () => {
  it('reports unconfirmed email using a fixed message without exposing upstream response contents', async () => {
    const project = createProject('Email confirmation', files)
    const row = reserveSharedEnvironment(project.id, 'development')
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    for (const code of ['email_not_confirmed', 'invalid_credentials']) {
      upstream.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code,
            message: 'private-upstream-response-must-not-leak',
          }),
          { status: 400 },
        ),
      )
      await expect(
        poolRequest(row, '/auth/v1/token?grant_type=password', {
          method: 'POST',
          body: { email: 'test@example.com', password: 'test-password' },
        }),
      ).rejects.toMatchObject({
        status: 401,
        message:
          code === 'email_not_confirmed'
            ? '请先完成邮箱验证，再返回此应用登录'
            : '认证失败，请检查凭证、邮件确认状态或稍后重试',
      })
    }
    upstream.mockResolvedValueOnce(
      new Response('private-upstream-response-must-not-leak', { status: 502 }),
    )
    await expect(poolRequest(row, '/auth/v1/token')).rejects.toMatchObject({
      status: 401,
      message: '认证失败，请检查凭证、邮件确认状态或稍后重试',
    })
  })

  it('returns actionable credential errors before contacting the upstream auth provider', async () => {
    const project = createProject('Registration validation', files)
    reserveSharedEnvironment(project.id, 'development')
    db()
      .prepare(
        "UPDATE cloud_environments_v2 SET status='ready' WHERE projectId=?",
      )
      .run(project.id)
    const upstream = vi.fn(() => {
      throw new Error('Invalid input must not reach the auth provider')
    })
    vi.stubGlobal('fetch', upstream)
    const endpoint = `${runtimeOrigin()}/cloud/v2/apps/${project.id}/environments/development/${sharedApp(project.id)!.generation}`
    for (const [body, message] of [
      [
        { email: 'test@example.com', password: '1234' },
        '注册密码长度须为 8–256 个字符',
      ],
      [
        { email: 'test@example.com', password: 'x'.repeat(257) },
        '注册密码长度须为 8–256 个字符',
      ],
      [
        { email: 'invalid-email', password: 'long-enough-password' },
        '请输入有效的邮箱地址',
      ],
      [
        {
          email: 'test@example.com',
          password: 'long-enough-password',
          secret: 'must-not-leak',
        },
        '认证字段无效',
      ],
    ] as const) {
      const response = await sharedRuntimeHandler(
        new Request(endpoint + '/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
      expect(response.status).toBe(400)
      const result = await response.text()
      expect(result).toContain(message)
      expect(result).not.toContain('must-not-leak')
      expect(result).not.toContain(body.password)
    }
    expect(upstream).not.toHaveBeenCalled()
    // Existing short passwords can still be used to sign in; only signup has an eight-character minimum.
    expect(
      parseSharedCredentials({ email: 'test@example.com', password: '1234' })
        .password,
    ).toBe('1234')
    for (const length of [8, 256])
      expect(
        parseSharedCredentials(
          { email: 'test@example.com', password: 'x'.repeat(length) },
          true,
        ).password,
      ).toHaveLength(length)
  })

  it('requires only a development pool, not a token, organization or production credentials', () => {
    vi.stubEnv('PIXLOOM_SUPABASE_ACCESS_TOKEN', '')
    vi.stubEnv('PIXLOOM_SUPABASE_ORGANIZATION', '')
    expect(configured('managed')).toBe(true)
    expect(sharedConfigured('production')).toBe(false)
    const project = createProject('Static app', files)
    expect(cloudStatus(project.id)).toMatchObject({
      provider: 'shared',
      status: 'disabled',
      resources: [],
      productionConfigured: false,
    })
    expect(db().prepare('SELECT * FROM cloud_pools').all()).toEqual([])
  })
  it('reserves two apps in one pool atomically without subtracting two projects per app', () => {
    const a = createProject('A', files),
      b = createProject('B', files),
      c = createProject('C', files)
    const first = reserveSharedEnvironment(a.id, 'development'),
      second = reserveSharedEnvironment(b.id, 'development')
    expect(first.poolId).toBe(second.poolId)
    expect(first.namespace).not.toBe(second.namespace)
    expect(reserveSharedEnvironment(a.id, 'development').id).toBe(first.id)
    expect(() => reserveSharedEnvironment(c.id, 'development')).toThrow(
      '名额已满',
    )
    expect(
      db().prepare('SELECT * FROM cloud_environments_v2').all(),
    ).toHaveLength(2)
    expect(
      db().prepare('SELECT * FROM cloud_apps_v2 WHERE projectId=?').get(c.id),
    ).toBeUndefined()
  })
  it('rejects pool replacement, shared dev/prod projects, transaction pooling and insecure public gateways', () => {
    const project = createProject('Pinned', files)
    reserveSharedEnvironment(project.id, 'development')
    vi.stubEnv('PIXLOOM_CLOUD_DEV_PROJECT_REF', 'bcdefghijklmnopqrstu')
    expect(() => reserveSharedEnvironment(project.id, 'development')).toThrow(
      '配置已变化',
    )
    vi.stubEnv('PIXLOOM_CLOUD_DEV_PROJECT_REF', 'abcdefghijklmnopqrst')
    vi.stubEnv('PIXLOOM_CLOUD_PROD_PROJECT_REF', 'abcdefghijklmnopqrst')
    expect(() => sharedPoolConfig('development')).toThrow('必须使用不同')
    vi.stubEnv('PIXLOOM_CLOUD_PROD_PROJECT_REF', '')
    vi.stubEnv(
      'PIXLOOM_CLOUD_DEV_DATABASE_URL',
      'postgresql://postgres:secret@pooler.example:6543/postgres',
    )
    expect(() => sharedPoolConfig('development')).toThrow('Session pooler')
    vi.stubEnv('PIXLOOM_CLOUD_RUNTIME_URL', 'http://public.example')
    expect(() => runtimeOrigin()).toThrow('HTTPS')
    vi.stubEnv('PIXLOOM_CLOUD_RUNTIME_URL', 'https://cloud.example')
    expect(runtimeOrigin()).toBe('https://cloud.example')
  })
  it('never includes malformed credential values in configuration errors', () => {
    vi.stubEnv('PIXLOOM_CLOUD_DEV_DATABASE_URL', 'sensitive-broken-password')
    expect(() => sharedPoolConfig('development')).toThrow(
      'DATABASE_URL 配置无效',
    )
    try {
      sharedPoolConfig('development')
    } catch (error) {
      expect(String(error)).not.toContain('sensitive-broken-password')
    }
  })
  it('does not let the independent adapter deploy arbitrary functions into a shared pool project', () => {
    saveConnection({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expires_in: 3600,
    })
    const project = createProject('External app', files)
    expect(() =>
      reserveBinding(project.id, {
        mode: 'external',
        development: 'abcdefghijklmnopqrst',
        production: 'bcdefghijklmnopqrstu',
      }),
    ).toThrow('共享池项目不能绑定')
    expect(db().prepare('SELECT * FROM cloud_bindings').all()).toEqual([])
  })
})

import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { dockerCommand } from '../src/lib/runtime/docker'
import {
  createProject,
  db,
  enqueueTask,
  claimTask,
  acquireWorker,
  cancelTask,
  getTask,
  getVersion,
  getDraft,
  updateDraft,
} from '../src/lib/store'
import { templateFiles } from '../src/lib/runtime/template'
import {
  ensureSharedEnvironment,
  applySharedSchema,
  sharedTransaction,
  closeSharedConnections,
  quoteIdentifier,
  poolCapacity,
} from '../src/lib/cloud/shared-db'
import {
  sharedApp,
  sharedEnvironment,
  sharedEnvironments,
} from '../src/lib/cloud/shared-store'
import { sharedRuntimeHandler } from '../src/lib/cloud/shared-runtime'
import { enableCloud, syncBackend } from '../src/lib/cloud/backend'
import {
  cloudManifest,
  productionAssets,
  readManifest,
  manifestEndpoint,
  cloudNetworkAllowed,
} from '../src/lib/cloud/manifest'
import { sharedClientSource } from '../src/lib/cloud/shared-client'
import { cloudStatus } from '../src/lib/cloud/store'
import { runtimePreviewHeaders } from '../src/lib/runtime/preview'
import {
  cloudTestAccount,
  cleanupTestAccount,
  assertNoTestCredentials,
} from '../src/lib/cloud/test-account'
import { verifyBrowser, type CloudTransport } from '../src/lib/browser'
import type { BuildAsset } from '../src/lib/types'
import { unseal } from '../src/lib/cloud/crypto'
import { publicationConfig } from '../src/lib/publication/config'
import { gatewayHandler } from '../src/lib/publication/gateway'
import { createServer, request as nodeRequest } from 'node:http'
import {
  exportSharedEnvironment,
  restoreSharedEnvironment,
  deleteSharedEnvironment,
} from '../src/lib/cloud/shared-lifecycle'
import { DockerRuntime } from '../src/lib/runtime/docker'
import { runTask } from '../src/lib/runner'
import { enqueuePublication, liveRelease } from '../src/lib/publication/store'
import { publicationTarget } from '../src/lib/publication/config'
import { PublicationFiles } from '../src/lib/publication/files'
import type { ModelProvider } from '../src/lib/ai/provider'

const active = () => ({ signal: new AbortController().signal, check() {} })
const schema = {
  tables: [
    { name: 'todos', columns: [{ name: 'title', type: 'text' as const }] },
  ],
  buckets: ['uploads'],
}
const directoryPrefix = 'pixloom-shared-test-'
describe.skipIf(process.env.PIXLOOM_SHARED_DB_TESTS !== '1')(
  'Shared pool: real PostgreSQL and bounded runtime',
  () => {
    let directory: string,
      container: string,
      admin: Pool,
      port: number,
      projectA: string,
      projectB: string
    let password: string
    let gateway: ReturnType<typeof createServer>
    const users = new Map<
      string,
      { id: string; email: string; password: string; app_metadata?: unknown }
    >()
    const tokens = new Map<string, string>()
    const storage = new Map<string, Buffer>()
    const calls: string[] = []
    let failStorage = false
    const refs = {
      development: 'abcdefghijklmnopqrst',
      production: 'bcdefghijklmnopqrstu',
    }
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    function endpoint(projectId: string, environment = 'development') {
      return `http://127.0.0.1:4180/cloud/v2/apps/${projectId}/environments/${environment}/${sharedApp(projectId)!.generation}`
    }
    async function request(
      projectId: string,
      route: string,
      options: {
        method?: string
        body?: unknown
        token?: string
        environment?: string
        contentType?: string
      } = {},
    ) {
      return sharedRuntimeHandler(
        new Request(endpoint(projectId, options.environment) + '/' + route, {
          method: options.method || 'GET',
          headers: {
            ...(options.token
              ? { Authorization: 'Bearer ' + options.token }
              : {}),
            'Content-Type': options.contentType || 'application/json',
          },
          body:
            options.body === undefined
              ? undefined
              : Buffer.isBuffer(options.body)
                ? new Uint8Array(options.body)
                : JSON.stringify(options.body),
        }),
        randomUUID(),
      )
    }
    async function login(
      projectId: string,
      email = 'a@example.com',
      environment = 'development',
    ) {
      const result = await request(projectId, 'auth/signin', {
        method: 'POST',
        body: { email, password: 'password-123' },
        environment,
      })
      expect(result.status, await result.clone().text()).toBe(200)
      return (await result.json()).access_token as string
    }
    beforeAll(async () => {
      directory = await mkdtemp(path.join(tmpdir(), directoryPrefix))
      container = directoryPrefix + randomUUID()
      password = randomBytes(24).toString('hex')
      vi.stubEnv('PIXLOOM_DATA_DIR', directory)
      vi.stubEnv('PIXLOOM_CLOUD_ENCRYPTION_KEY', '12'.repeat(32))
      vi.stubEnv('PIXLOOM_CLOUD_LEGACY_PROVISIONING', '0')
      vi.stubEnv('PIXLOOM_CLOUD_RUNTIME_URL', 'http://127.0.0.1:4180')
      vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_ID', '')
      vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_SECRET', '')
      vi.stubEnv('PIXLOOM_CLOUD_REQUESTS_PER_MINUTE', '10000')
      vi.stubEnv('PIXLOOM_CLOUD_MAX_APPS', '30')
      const run = await dockerCommand(
        [
          'run',
          '-d',
          '--name',
          container,
          '--label',
          'dev.pixloom.test=shared-cloud',
          '--memory',
          '256m',
          '--cpus',
          '1',
          '--pids-limit',
          '100',
          '--tmpfs',
          '/var/lib/postgresql/data:rw,size=128m',
          '-p',
          '127.0.0.1::5432',
          '-e',
          `POSTGRES_PASSWORD=${password}`,
          'postgres:17-alpine',
        ],
        { timeout: 60000 },
      )
      expect(run.code, run.stderr).toBe(0)
      const binding = await dockerCommand(['port', container, '5432/tcp'])
      port = Number(binding.stdout.trim().split(':').pop())
      admin = new Pool({
        connectionString: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
        connectionTimeoutMillis: 1000,
      })
      let ready = false
      for (let i = 0; i < 30; i++) {
        try {
          await admin.query('SELECT 1')
          ready = true
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }
      expect(ready).toBe(true)
      await admin.query('CREATE DATABASE production')
      await admin.query('CREATE ROLE anon; CREATE ROLE authenticated')
      await admin.query(
        'CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb)',
      )
      for (const [environment, ref] of Object.entries(refs)) {
        const prefix = `PIXLOOM_CLOUD_${environment === 'development' ? 'DEV' : 'PROD'}_`
        vi.stubEnv(prefix + 'PROJECT_REF', ref)
        vi.stubEnv(
          prefix + 'DATABASE_URL',
          `postgresql://postgres:${password}@127.0.0.1:${port}/${environment === 'development' ? 'postgres' : 'production'}`,
        )
        vi.stubEnv(prefix + 'PUBLISHABLE_KEY', 'sb_publishable_test')
        vi.stubEnv(prefix + 'SECRET_KEY', 'sb_secret_test')
      }
      for (const email of ['a@example.com', 'b@example.com']) {
        const user = { id: randomUUID(), email, password: 'password-123' }
        users.set(email, user)
        await admin.query('INSERT INTO auth.users VALUES ($1,$2,$3)', [
          user.id,
          email,
          '{}',
        ])
      }
      const nativeFetch = globalThis.fetch
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          )
          if (url.hostname === '127.0.0.1') return nativeFetch(input, init)
          calls.push(url.pathname)
          const body =
            typeof init.body === 'string' ? JSON.parse(init.body) : init.body
          const headers = new Headers(init.headers)
          if (url.pathname === '/auth/v1/token') {
            const user = users.get(body.email)
            if (!user || user.password !== body.password)
              return json({ message: 'Invalid' }, 400)
            const token = randomBytes(24).toString('hex')
            tokens.set(token, user.email)
            return json({
              access_token: token,
              refresh_token: 'upstream-refresh-secret',
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user: {
                ...user,
                password: undefined,
                email_confirmed_at: new Date().toISOString(),
              },
            })
          }
          if (url.pathname === '/auth/v1/user') {
            const user = users.get(
              tokens.get(
                (headers.get('authorization') || '').replace('Bearer ', ''),
              ) || '',
            )
            return user ? json({ ...user, password: undefined }) : json({}, 401)
          }
          if (url.pathname === '/auth/v1/signup')
            return json({ user: { id: randomUUID() } })
          if (url.pathname.startsWith('/auth/v1/admin/users')) {
            expect(headers.get('apikey')).toBe('sb_secret_test')
            if (init.method === 'POST') {
              const user = {
                id: randomUUID(),
                email: body.email,
                password: body.password,
                app_metadata: body.app_metadata,
              }
              users.set(user.email, user)
              await admin.query('INSERT INTO auth.users VALUES ($1,$2,$3)', [
                user.id,
                user.email,
                JSON.stringify(user.app_metadata),
              ])
              return json({ id: user.id })
            }
            const id = url.pathname.split('/').pop()
            for (const [email, user] of Array.from(users))
              if (user.id === id) {
                users.delete(email)
                await admin.query('DELETE FROM auth.users WHERE id=$1', [id])
              }
            return json({})
          }
          if (url.pathname.startsWith('/storage/v1/bucket'))
            return json({ public: false })
          if (url.pathname.startsWith('/storage/v1/object/')) {
            expect(headers.get('apikey')).toBe('sb_secret_test')
            if (init.method === 'POST') {
              storage.set(url.pathname, Buffer.from(init.body as Uint8Array))
              return json({}, failStorage ? 500 : 200)
            }
            if (init.method === 'DELETE') {
              for (const key of body.prefixes)
                storage.delete(
                  '/storage/v1/object/pixloom-cloud-v2/' +
                    key.split('/').map(encodeURIComponent).join('/'),
                )
              return json({})
            }
            const value = storage.get(url.pathname)
            return value
              ? new Response(new Uint8Array(value), {
                  headers: { 'Content-Type': 'text/plain' },
                })
              : json({}, 404)
          }
          throw new Error(
            'Unexpected shared Cloud network path ' + url.pathname,
          )
        }),
      )
      const files = await templateFiles()
      projectA = createProject('Shared A', files).id
      projectB = createProject('Shared B', files).id
      gateway = createServer(gatewayHandler(publicationConfig()))
      await new Promise<void>((resolve) =>
        gateway.listen(0, '127.0.0.1', resolve),
      )
    }, 60000)
    afterAll(async () => {
      if (gateway)
        await new Promise<void>((resolve) => gateway.close(() => resolve()))
      await closeSharedConnections()
      if (admin) await admin.end()
      const state = globalThis as unknown as { pixloomDb?: { close(): void } }
      state.pixloomDb?.close()
      delete state.pixloomDb
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      if (container) {
        const info = await dockerCommand([
          'inspect',
          '--format',
          '{{ index .Config.Labels "dev.pixloom.test" }}',
          container,
        ])
        if (info.code === 0 && info.stdout.trim() === 'shared-cloud')
          await dockerCommand(['rm', '-f', container])
      }
      if (directory) await rm(directory, { recursive: true, force: true })
    }, 30000)
    it('allocates only development, reuses two registered pools across apps, and never creates a remote project', async () => {
      expect(sharedEnvironments(projectA)).toEqual([])
      for (const project of [projectA, projectB]) {
        await ensureSharedEnvironment(project, 'development', active())
        await applySharedSchema(project, 'development', schema, active())
      }
      const a = sharedEnvironment(projectA, 'development')!,
        b = sharedEnvironment(projectB, 'development')!
      expect(a.poolId).toBe(b.poolId)
      expect(a.namespace).not.toBe(b.namespace)
      expect(sharedEnvironment(projectA, 'production')).toBeUndefined()
      const again = await ensureSharedEnvironment(
        projectA,
        'development',
        active(),
      )
      expect(again.id).toBe(a.id)
      expect(cloudStatus(projectA)).toMatchObject({
        provider: 'shared',
        status: 'ready',
        productionConfigured: true,
      })
      expect(calls.some((path) => path === '/v1/projects')).toBe(false)
      expect(
        (
          await admin.query(
            "SELECT count(*) AS n FROM pg_roles WHERE rolname LIKE 'pxr_%'",
          )
        ).rows[0].n,
      ).toBe('2')
    })
    it('uses separate login roles with FORCE RLS and no access to another app, public API roles or private control tables', async () => {
      const row = sharedEnvironment(projectA, 'development')!,
        other = sharedEnvironment(projectB, 'development')!
      const rolePool = new Pool({
        host: '127.0.0.1',
        port,
        database: 'postgres',
        user: row.role,
        password: unseal(row.password, `shared-role:${row.id}`),
      })
      try {
        const result = await rolePool.query(
          'SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user',
        )
        expect(result.rows[0]).toEqual({
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
        })
        await expect(
          rolePool.query(
            `SELECT * FROM ${quoteIdentifier(other.namespace)}.todos`,
          ),
        ).rejects.toThrow('permission denied')
        await expect(
          rolePool.query('SELECT * FROM pixloom_pool_v2.members'),
        ).rejects.toThrow('permission denied')
        await expect(
          rolePool.query(
            `CREATE TABLE ${quoteIdentifier(row.namespace)}.evil(id int)`,
          ),
        ).rejects.toThrow('permission denied')
        await expect(
          rolePool.query(
            `INSERT INTO ${quoteIdentifier(row.namespace)}.todos(title) VALUES ('anonymous')`,
          ),
        ).rejects.toThrow()
        await expect(
          rolePool.query(`SET ROLE ${quoteIdentifier(other.role)}`),
        ).rejects.toThrow('permission denied')
        const runtimeClient = await rolePool.connect()
        try {
          await runtimeClient.query('BEGIN')
          await runtimeClient.query(
            "SELECT set_config('pixloom.user_id',$1,true)",
            [users.get('a@example.com')!.id],
          )
          await expect(
            runtimeClient.query(
              `INSERT INTO ${quoteIdentifier(row.namespace)}.todos(owner_id,title) VALUES ($1,'forged owner')`,
              [users.get('b@example.com')!.id],
            ),
          ).rejects.toThrow('row-level security')
        } finally {
          await runtimeClient.query('ROLLBACK')
          runtimeClient.release()
        }
        const anonymous = await admin.connect()
        try {
          await anonymous.query('BEGIN; SET LOCAL ROLE anon')
          await expect(
            anonymous.query(
              `SELECT * FROM ${quoteIdentifier(row.namespace)}.todos`,
            ),
          ).rejects.toThrow('permission denied')
        } finally {
          await anonymous.query('ROLLBACK')
          anonymous.release()
        }
      } finally {
        await rolePool.end()
      }
    })
    it('isolates users, app memberships and opaque sessions, rejects forged identifiers/owners and revokes logout', async () => {
      const token = await login(projectA),
        otherUser = await login(projectA, 'b@example.com'),
        otherApp = await login(projectB)
      expect(
        (
          await request(projectA, 'tables/todos', {
            method: 'POST',
            token,
            body: { title: 'A private' },
          })
        ).status,
      ).toBe(200)
      expect(
        await (
          await request(projectA, 'tables/todos', { token: otherUser })
        ).json(),
      ).toEqual([])
      expect(
        await (
          await request(projectB, 'tables/todos', { token: otherApp })
        ).json(),
      ).toEqual([])
      expect((await request(projectB, 'tables/todos', { token })).status).toBe(
        401,
      )
      expect(
        (
          await request(projectA, 'tables/todos', {
            method: 'POST',
            token,
            body: { owner_id: users.get('b@example.com')!.id, title: 'forged' },
          })
        ).status,
      ).toBe(400)
      expect(
        (await request(projectA, 'tables/todos;DROP TABLE todos', { token }))
          .status,
      ).toBe(404)
      expect(
        (await request(projectA, 'tables/todos?or=(owner_id.neq.x)', { token }))
          .status,
      ).toBe(400)
      const row = sharedEnvironment(projectA, 'development')!
      await sharedTransaction('development', async (client) => {
        await client.query(
          'DELETE FROM pixloom_pool_v2.members WHERE environment_id=$1 AND user_id=$2',
          [row.id, users.get('a@example.com')!.id],
        )
      })
      expect((await request(projectA, 'tables/todos', { token })).status).toBe(
        403,
      )
      const restored = await login(projectA)
      expect(
        await (
          await request(projectA, 'tables/todos', { token: restored })
        ).json(),
      ).toHaveLength(1)
      expect(
        (
          await request(projectA, 'auth/signout', {
            method: 'POST',
            token: restored,
          })
        ).status,
      ).toBe(200)
      expect(
        (await request(projectA, 'tables/todos', { token: restored })).status,
      ).toBe(401)
      expect(
        (await request(projectB, 'tables/todos', { token: otherApp })).status,
      ).toBe(200)
    })
    it('enforces row/byte limits transactionally across simultaneous writes from different users', async () => {
      const row = sharedEnvironment(projectB, 'development')!
      await sharedTransaction('development', async (client) => {
        await client.query(
          'UPDATE pixloom_pool_v2.environments SET max_rows=2 WHERE id=$1',
          [row.id],
        )
      })
      const a = await login(projectB),
        b = await login(projectB, 'b@example.com')
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          request(projectB, 'tables/todos', {
            method: 'POST',
            token: i % 2 ? a : b,
            body: { title: 'Concurrent ' + i },
          }),
        ),
      )
      expect(results.filter((result) => result.status === 200)).toHaveLength(2)
      expect(results.filter((result) => result.status === 409)).toHaveLength(2)
      const usage = await sharedTransaction(
        'development',
        async (client) =>
          (
            await client.query(
              'SELECT rows,bytes FROM pixloom_pool_v2.environments WHERE id=$1',
              [row.id],
            )
          ).rows[0],
      )
      expect(usage.rows).toBe('2')
      expect(Number(usage.bytes)).toBeGreaterThan(0)
      await sharedTransaction('development', async (client) => {
        await client.query(
          'UPDATE pixloom_pool_v2.environments SET max_rows=10000,max_bytes=bytes WHERE id=$1',
          [row.id],
        )
      })
      expect(
        (
          await request(projectB, 'tables/todos', {
            method: 'POST',
            token: a,
            body: { title: 'byte overflow' },
          })
        ).status,
      ).toBe(409)
      await sharedTransaction('development', async (client) => {
        await client.query(
          'UPDATE pixloom_pool_v2.environments SET max_bytes=10485760 WHERE id=$1',
          [row.id],
        )
      })
    })
    it('retains data through additive migrations, recovery and old-code deploys, rejects type changes and functions', async () => {
      const row = sharedEnvironment(projectA, 'development')!
      const extended = {
        ...schema,
        tables: [
          {
            name: 'todos',
            columns: [
              ...schema.tables[0].columns,
              { name: 'category', type: 'text' as const },
            ],
          },
        ],
      }
      await applySharedSchema(projectA, 'development', extended, active())
      await applySharedSchema(projectA, 'development', schema, active())
      const recovered = await ensureSharedEnvironment(
        projectA,
        'development',
        active(),
      )
      expect(recovered.id).toBe(row.id)
      await expect(
        applySharedSchema(
          projectA,
          'development',
          {
            tables: [
              { name: 'todos', columns: [{ name: 'title', type: 'integer' }] },
            ],
          },
          active(),
        ),
      ).rejects.toThrow('类型变化')
      const token = await login(projectA)
      expect(
        (await (await request(projectA, 'tables/todos', { token })).json())[0]
          .title,
      ).toBe('A private')
      await expect(
        syncBackend(
          projectA,
          [
            {
              path: 'src/backend/functions/test.js',
              content: 'export default ()=>null',
            },
          ],
          'development',
          active(),
        ),
      ).rejects.toThrow('暂不支持')
      const abort = new AbortController()
      abort.abort()
      await expect(
        ensureSharedEnvironment(projectA, 'development', {
          signal: abort.signal,
          check() {
            abort.signal.throwIfAborted()
          },
        }),
      ).rejects.toThrow()
    })
    it('allocates production only when publishing and pins capabilities, environment and generation without pool secrets', async () => {
      const manifest = cloudManifest(projectA)
      expect(manifest.format).toBe('pixloom-cloud-v2')
      expect(JSON.stringify(manifest)).not.toMatch(
        /secret|password|refresh|postgres/,
      )
      const assets = [
        {
          path: 'pixloom-cloud.json',
          body: Buffer.from(JSON.stringify(manifest)),
          contentType: 'application/json',
        },
      ]
      expect(() => productionAssets(assets)).toThrow('尚未就绪')
      await syncBackend(
        projectA,
        [{ path: 'src/pixloom-schema.json', content: JSON.stringify(schema) }],
        'production',
        active(),
        manifest,
      )
      const production = readManifest(productionAssets(assets))!
      expect(production.environment).toBe('production')
      expect(db().prepare('SELECT * FROM cloud_pools').all()).toHaveLength(2)
      const token = await login(projectA),
        prodToken = await login(projectA, 'a@example.com', 'production')
      expect(
        (
          await request(projectA, 'tables/todos', {
            token,
            environment: 'production',
          })
        ).status,
      ).toBe(401)
      expect(
        await (
          await request(projectA, 'tables/todos', {
            token: prodToken,
            environment: 'production',
          })
        ).json(),
      ).toEqual([])
      if (manifest.format !== 'pixloom-cloud-v2') throw new Error('format')
      await expect(
        syncBackend(
          projectA,
          [
            {
              path: 'src/pixloom-schema.json',
              content: JSON.stringify(schema),
            },
          ],
          'production',
          active(),
          { ...manifest, generation: randomUUID() },
        ),
      ).rejects.toThrow('已变化')
      const allowed = manifestEndpoint(manifest)!
      expect(
        cloudNetworkAllowed(new URL(allowed + 'tables/todos'), allowed),
      ).toBe(true)
      expect(
        cloudNetworkAllowed(
          new URL('http://127.0.0.1:4180/api/projects'),
          allowed,
        ),
      ).toBe(false)
      expect(
        cloudNetworkAllowed(
          new URL(endpoint(projectB) + '/tables/todos'),
          allowed,
        ),
      ).toBe(false)
      expect(
        runtimePreviewHeaders(
          new Request(
            'http://127.0.0.1:3000/api/previews/' +
              randomUUID() +
              '/index.html',
          ),
          'text/html',
          allowed,
        )['Content-Security-Policy'],
      ).toContain(allowed)
    })
    it('keeps files scoped to application/environment/user and retains quota reservations on uncertain uploads', async () => {
      const a = await login(projectA),
        b = await login(projectA, 'b@example.com'),
        otherApp = await login(projectB)
      expect(
        (
          await request(projectA, 'files/uploads/a.txt', {
            method: 'POST',
            token: a,
            body: Buffer.from('hello'),
            contentType: 'text/plain',
          })
        ).status,
      ).toBe(200)
      expect(
        await (
          await request(projectA, 'files/uploads/a.txt', { token: a })
        ).text(),
      ).toBe('hello')
      expect(
        (await request(projectA, 'files/uploads/a.txt', { token: b })).status,
      ).toBe(404)
      expect(
        (await request(projectB, 'files/uploads/a.txt', { token: otherApp }))
          .status,
      ).toBe(404)
      expect(
        (
          await request(projectA, 'files/uploads/a%2f..%2fother.txt', {
            token: a,
          })
        ).status,
      ).toBe(400)
      failStorage = true
      expect(
        (
          await request(projectA, 'files/uploads/uncertain.txt', {
            method: 'POST',
            token: a,
            body: Buffer.from('uncertain'),
          })
        ).status,
      ).toBe(502)
      const row = sharedEnvironment(projectA, 'development')!
      const usage = await sharedTransaction(
        'development',
        async (client) =>
          (
            await client.query(
              'SELECT file_bytes FROM pixloom_pool_v2.environments WHERE id=$1',
              [row.id],
            )
          ).rows[0],
      )
      expect(usage.file_bytes).toBe('14')
      failStorage = false
      expect(
        (
          await request(projectA, 'files/uploads/uncertain.txt', {
            method: 'POST',
            token: a,
            body: Buffer.from('retry'),
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await request(projectA, 'files/uploads/uncertain.txt', {
            method: 'DELETE',
            token: a,
          })
        ).status,
      ).toBe(200)
      expect(storage.size).toBe(1)
    })
    it('creates and cleans only task-owned test identities, data, files and local sessions', async () => {
      const worker = randomUUID()
      acquireWorker(worker)
      const queued = enqueueTask(projectA, 'commit', 0, null),
        task = claimTask(worker)!
      expect(task.id).toBe(queued.id)
      const account = await cloudTestAccount(task, active())
      expect(() =>
        assertNoTestCredentials(task.id, [{ content: account.password }]),
      ).toThrow('不要把')
      const signin = await request(projectA, 'auth/signin', {
        method: 'POST',
        body: account.email
          ? { email: account.email, password: account.password }
          : undefined,
      })
      expect(signin.status).toBe(200)
      const token = (await signin.json()).access_token
      expect(
        (
          await request(projectA, 'tables/todos', {
            method: 'POST',
            token,
            body: { title: 'test only' },
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await request(projectB, 'auth/signin', {
            method: 'POST',
            body: { email: account.email, password: account.password },
          })
        ).status,
      ).toBe(403)
      cancelTask(task.id)
      await cleanupTestAccount(task.id)
      expect(users.has(account.email)).toBe(false)
      expect(users.has('a@example.com')).toBe(true)
      expect((await request(projectA, 'tables/todos', { token })).status).toBe(
        401,
      )
      const regular = await login(projectA)
      expect(
        (
          await (
            await request(projectA, 'tables/todos', { token: regular })
          ).json()
        ).map((row: { title: string }) => row.title),
      ).toContain('A private')
    })
    it('runs two application clients in real opaque-origin Chromium against the runtime and reloads saved data', async () => {
      for (const projectId of [projectA, projectB]) {
        const artifact = randomUUID(),
          base = `/api/previews/${artifact}/`
        const asset = (path: string, body: string): BuildAsset => ({
          path,
          body: Buffer.from(body).toString('base64'),
          contentType: 'ignored',
        })
        const assets = [
          asset(
            'index.html',
            `<div id="root"><input id="email"><input id="password"><button id="login" type="button">登录</button><input id="title"><button id="add" type="button">添加</button><ul></ul><output>请登录</output></div><script type="module" src="${base}app.js"></script>`,
          ),
          asset(
            'cloud.js',
            sharedClientSource.replace(
              'import.meta.env.BASE_URL',
              JSON.stringify(base),
            ),
          ),
          asset(
            'app.js',
            `import {cloud} from './cloud.js';const output=document.querySelector('output');async function render(){const rows=await cloud.select('todos');document.querySelector('ul').replaceChildren(...rows.map(row=>{const li=document.createElement('li');li.textContent=row.title;return li}));output.textContent='已登录'}document.querySelector('#login').onclick=async()=>{try{await cloud.signIn(document.querySelector('#email').value,document.querySelector('#password').value);await render()}catch(e){output.textContent=e.message}};document.querySelector('#add').onclick=async()=>{try{await cloud.insert('todos',{title:document.querySelector('#title').value});await render()}catch(e){output.textContent=e.message}}`,
          ),
          asset('pixloom-cloud.json', JSON.stringify(cloudManifest(projectId))),
        ]
        const transport: CloudTransport = async (input) => {
          const response = await sharedRuntimeHandler(
            new Request(input.url, {
              method: input.method,
              headers: input.headers,
              body: input.body ? new Uint8Array(input.body) : null,
            }),
            'browser-test',
          )
          return {
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
          }
        }
        const loginSteps = [
          {
            action: 'fill' as const,
            selector: '#email',
            value: 'a@example.com',
          },
          {
            action: 'fill' as const,
            selector: '#password',
            value: 'password-123',
          },
          { action: 'click' as const, selector: '#login', value: '' },
          {
            action: 'assert_text' as const,
            selector: 'output',
            value: '已登录',
          },
        ]
        const title = projectId === projectA ? 'Browser A' : 'Browser B'
        const first = await verifyBrowser(
          artifact,
          assets,
          [
            ...loginSteps,
            { action: 'fill', selector: '#title', value: title },
            { action: 'click', selector: '#add', value: '' },
            { action: 'assert_text', selector: 'ul', value: title },
          ],
          active().signal,
          transport,
        )
        expect(first, first.output).toMatchObject({
          ok: true,
          completedSteps: 7,
        })
        const second = await verifyBrowser(
          artifact,
          assets,
          [
            ...loginSteps,
            { action: 'assert_text', selector: 'ul', value: title },
          ],
          active().signal,
          transport,
        )
        expect(second, second.output).toMatchObject({
          ok: true,
          completedSteps: 5,
        })
      }
      expect(calls).not.toContain('/v1/projects')
    }, 60000)
    it('serves only scoped runtime routes through the HTTP gateway and authorizes its HTTPS host for Caddy', async () => {
      const address = gateway.address() as { port: number }
      const root = `http://127.0.0.1:${address.port}`
      const token = await login(projectA)
      const route = new URL(endpoint(projectA) + '/tables/todos').pathname
      const http = (host: string) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = nodeRequest(
            root + route,
            { headers: { Host: host, Authorization: 'Bearer ' + token } },
            (res) => {
              const chunks: Buffer[] = []
              res.on('data', (chunk) => chunks.push(chunk))
              res.on('end', () =>
                resolve({
                  status: res.statusCode!,
                  body: Buffer.concat(chunks).toString(),
                }),
              )
            },
          )
          req.on('error', reject)
          req.end()
        })
      const result = await http('127.0.0.1:4180')
      expect(result.status, result.body).toBe(200)
      expect(JSON.parse(result.body)).toMatchObject([
        { title: 'Browser A' },
        { title: 'A private' },
      ])
      const rejected = await http('wrong.example')
      expect(rejected.status).toBe(404)
      vi.stubEnv('PIXLOOM_CLOUD_RUNTIME_URL', 'https://cloud.example')
      try {
        expect(
          (await fetch(root + '/_pixloom/allow-domain?domain=cloud.example'))
            .status,
        ).toBe(200)
        expect(
          (await fetch(root + '/_pixloom/allow-domain?domain=other.example'))
            .status,
        ).toBe(403)
      } finally {
        vi.stubEnv('PIXLOOM_CLOUD_RUNTIME_URL', 'http://127.0.0.1:4180')
      }
    })
    it('backs up and restores one app into a fresh namespace, verifies files, and deletes only that namespace', async () => {
      const backup = await exportSharedEnvironment(projectA, 'development')
      expect(JSON.stringify(backup)).not.toMatch(
        /sb_secret|upstream-refresh|postgresql/,
      )
      const restored = createProject('Restored app', await templateFiles())
      const result = await restoreSharedEnvironment(
        restored.id,
        'development',
        backup,
      )
      expect(result.ok).toBe(true)
      expect(result.environmentId).not.toBe(
        sharedEnvironment(projectA, 'development')!.id,
      )
      const token = await login(restored.id)
      expect(
        (
          await (await request(restored.id, 'tables/todos', { token })).json()
        ).map((row: { title: string }) => row.title),
      ).toContain('A private')
      expect(
        await (
          await request(restored.id, 'files/uploads/a.txt', { token })
        ).text(),
      ).toBe('hello')
      await expect(
        deleteSharedEnvironment(restored.id, 'development', randomUUID()),
      ).rejects.toThrow('明确确认')
      await deleteSharedEnvironment(
        restored.id,
        'development',
        result.environmentId,
      )
      expect(
        (await request(restored.id, 'tables/todos', { token })).status,
      ).toBe(404)
      const original = await login(projectA)
      expect(
        await (
          await request(projectA, 'files/uploads/a.txt', { token: original })
        ).text(),
      ).toBe('hello')
      expect(
        (
          await admin.query(
            'SELECT count(*) AS n FROM pixloom_pool_v2.environments',
          )
        ).rows[0].n,
      ).toBe('2')
      expect(users.has('a@example.com')).toBe(true)
      expect(calls).not.toContain('/v1/projects')
    })
    it('generates two full-stack apps with one Engineer, real Docker/Vite/Chromium, publishes them and preserves live data on failure', async () => {
      vi.stubEnv('PIXLOOM_PUBLISH_ENABLED', '1')
      vi.stubEnv('PIXLOOM_PUBLISH_DOMAIN', 'apps.localhost')
      const runtime = new DockerRuntime()
      expect(await runtime.health()).toMatchObject({
        available: true,
        imageReady: true,
      })
      const transport: CloudTransport = async (input) => {
        const result = await sharedRuntimeHandler(
          new Request(input.url, {
            method: input.method,
            headers: input.headers,
            body: input.body ? new Uint8Array(input.body) : null,
          }),
          'engineer-test',
        )
        return {
          status: result.status,
          headers: Object.fromEntries(result.headers),
          body: Buffer.from(await result.arrayBuffer()),
        }
      }
      const source = `import React,{useState} from 'react';import {cloud} from './pixloom-cloud.js';export default function App(){const[email,E]=useState(''),[password,P]=useState(''),[title,T]=useState(''),[rows,R]=useState([]),[status,S]=useState('请登录');async function load(){R(await cloud.select('todos'));S('已登录')}return <main><h1>使用 Pixloom Cloud 账号登录</h1><input id="email" value={email} onChange={e=>E(e.target.value)}/><input id="password" value={password} onChange={e=>P(e.target.value)}/><button id="login" type="button" onClick={async()=>{await cloud.signIn(email,password);await load()}}>登录</button><output>{status}</output><input id="title" value={title} onChange={e=>T(e.target.value)}/><button id="add" type="button" onClick={async()=>{await cloud.insert('todos',{title});await load()}}>添加</button><ul>{rows.map(row=><li key={row.id}>{row.title}</li>)}</ul></main>}`
      for (let number = 0; number < 2; number++) {
        const project = createProject(
          'Generated shared ' + number,
          await templateFiles(),
        )
        try {
          let phase = 0,
            credentials: { email: string; password: string } | undefined
          const provider: ModelProvider = {
            createSession: () => ({
              next: async (inputs) => {
                for (const input of inputs)
                  if (input.type === 'tool' && input.id === 'account')
                    credentials = JSON.parse(input.output)
                phase++
                const calls =
                  phase === 1
                    ? [{ id: 'enable', name: 'cloud_enable', arguments: {} }]
                    : phase === 2
                      ? [
                          {
                            id: 'account',
                            name: 'cloud_test_account',
                            arguments: {},
                          },
                        ]
                      : phase === 3
                        ? [
                            {
                              id: 'schema',
                              name: 'write_file',
                              arguments: {
                                path: 'src/pixloom-schema.json',
                                content: JSON.stringify(schema),
                              },
                            },
                            {
                              id: 'app',
                              name: 'write_file',
                              arguments: {
                                path: 'src/App.jsx',
                                content: source,
                              },
                            },
                            { id: 'build', name: 'build', arguments: {} },
                          ]
                        : phase === 4
                          ? [
                              {
                                id: 'browser',
                                name: 'browser_test',
                                arguments: {
                                  steps: [
                                    {
                                      action: 'fill',
                                      selector: '#email',
                                      value: credentials!.email,
                                    },
                                    {
                                      action: 'fill',
                                      selector: '#password',
                                      value: credentials!.password,
                                    },
                                    {
                                      action: 'click',
                                      selector: '#login',
                                      value: '',
                                    },
                                    {
                                      action: 'assert_text',
                                      selector: 'output',
                                      value: '已登录',
                                    },
                                    {
                                      action: 'fill',
                                      selector: '#title',
                                      value: 'Engineer ' + number,
                                    },
                                    {
                                      action: 'click',
                                      selector: '#add',
                                      value: '',
                                    },
                                    {
                                      action: 'assert_text',
                                      selector: 'li',
                                      value: 'Engineer ' + number,
                                    },
                                  ],
                                },
                              },
                            ]
                          : []
                return {
                  text: phase >= 5 ? '已完成登录和持久化待办。' : '',
                  calls,
                  usage: { inputTokens: 0, outputTokens: 0 },
                  responseBytes: 0,
                }
              },
            }),
          }
          enqueueTask(project.id, 'agent', 0, null, undefined, undefined, {
            provider: 'gemini',
            model: 'deterministic-shared',
            prompt: '创建带登录的云端待办',
            steps: 0,
            toolCalls: 0,
            buildFailures: 0,
            responseBytes: 0,
            reservedOutputTokens: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
            startedAt: null,
          })
          const task = claimTask()!
          await runTask(
            task,
            runtime,
            undefined,
            undefined,
            provider,
            (id, assets, steps, signal) =>
              verifyBrowser(id, assets, steps, signal, transport),
          )
          const finished = getTask(task.id)
          expect(
            finished,
            finished.error || JSON.stringify(finished.events),
          ).toMatchObject({ status: 'completed' })
          const version = getVersion(project.id, finished.resultVersionId!)
          expect(sharedEnvironment(project.id, 'production')).toBeUndefined()
          expect(cloudStatus(project.id).cleanupPending).toBe(0)
          expect(JSON.stringify(version.files)).not.toContain(
            credentials!.password,
          )
          const disk = new PublicationFiles()
          const target = publicationTarget(project.id, publicationConfig())
          const first = enqueuePublication(
            project.id,
            {
              action: 'publish',
              versionId: version.id,
              expectedReleaseId: null,
            },
            target,
          )
          await runTask(
            claimTask()!,
            runtime,
            undefined,
            undefined,
            undefined,
            verifyBrowser,
            { stage: disk.stage.bind(disk), preflight: async () => {} },
          )
          expect(liveRelease(project.id)?.id).toBe(first.release.id)
          expect(sharedEnvironment(project.id, 'production')?.status).toBe(
            'ready',
          )
          const token = await login(project.id, 'a@example.com', 'production')
          expect(
            (
              await request(project.id, 'tables/todos', {
                token,
                environment: 'production',
                method: 'POST',
                body: { title: 'Live data' },
              })
            ).status,
          ).toBe(200)
          // A later stage/verification failure must leave the current release and data intact.
          const draft = getDraft(project.id)
          const saved = updateDraft(project.id, draft.revision, [
            {
              type: 'write',
              path: 'src/App.jsx',
              content: source.replace(
                '使用 Pixloom Cloud 账号登录',
                '使用 Pixloom Cloud 账号登录 v2',
              ),
            },
          ])
          enqueueTask(project.id, 'commit', saved.revision, saved.baseVersionId)
          const rebuild = claimTask()!
          await runTask(rebuild, runtime)
          const rebuilt = getTask(rebuild.id)
          expect(rebuilt.status, rebuilt.error || 'rebuild').toBe('completed')
          enqueuePublication(
            project.id,
            {
              action: 'publish',
              versionId: rebuilt.resultVersionId!,
              expectedReleaseId: first.release.id,
            },
            target,
          )
          const next = claimTask()!
          await runTask(
            next,
            runtime,
            undefined,
            undefined,
            undefined,
            async () => ({
              ok: false,
              output: 'Deliberate publication failure',
              completedSteps: 0,
            }),
            { stage: disk.stage.bind(disk), preflight: async () => {} },
          )
          expect(getTask(next.id).status).toBe('failed')
          expect(liveRelease(project.id)?.id).toBe(first.release.id)
          expect(
            await (
              await request(project.id, 'tables/todos', {
                token,
                environment: 'production',
              })
            ).json(),
          ).toMatchObject([{ title: 'Live data' }])
        } finally {
          await runtime.remove(project.id).catch(() => {})
        }
      }
      expect(db().prepare('SELECT * FROM cloud_pools').all()).toHaveLength(2)
      expect(calls).not.toContain('/v1/projects')
    }, 120000)
    it('limits authentication bursts, expires sessions, stops growth near capacity and recovers an existing reservation', async () => {
      const loginRequest = () =>
        sharedRuntimeHandler(
          new Request(endpoint(projectB) + '/auth/signin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: 'not-found@example.com',
              password: 'invalid-password',
            }),
          }),
          'rate-limit-test',
        )
      for (let index = 0; index < 10; index++)
        expect((await loginRequest()).status).toBe(401)
      expect((await loginRequest()).status).toBe(429)
      const token = await login(projectB)
      db()
        .prepare(
          'UPDATE cloud_sessions_v2 SET expiresAt=0 WHERE environmentId=?',
        )
        .run(sharedEnvironment(projectB, 'development')!.id)
      expect((await request(projectB, 'tables/todos', { token })).status).toBe(
        401,
      )
      const { bytes } = await poolCapacity('development')
      vi.stubEnv(
        'PIXLOOM_CLOUD_POOL_MAX_BYTES',
        String(Math.floor(bytes / 0.75)),
      )
      expect(await poolCapacity('development')).toMatchObject({
        warning: true,
        blocked: false,
      })
      vi.stubEnv(
        'PIXLOOM_CLOUD_POOL_MAX_BYTES',
        String(Math.floor(bytes / 0.9)),
      )
      const project = createProject('Capacity limited', await templateFiles())
      await expect(
        ensureSharedEnvironment(project.id, 'development', active()),
      ).rejects.toThrow('保护阈值')
      const reserved = sharedEnvironment(project.id, 'development')!
      vi.stubEnv('PIXLOOM_CLOUD_POOL_MAX_BYTES', '524288000')
      expect(
        (await ensureSharedEnvironment(project.id, 'development', active())).id,
      ).toBe(reserved.id)
      await deleteSharedEnvironment(project.id, 'development', reserved.id)
      expect(calls).not.toContain('/v1/projects')
    })
  },
)

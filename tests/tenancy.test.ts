import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { DockerRuntime } from '../src/lib/runtime/docker'
import {
  authCookieName,
  currentAccount,
  requireProjectUser,
  requireWorkspaceUser,
  revokeSession,
  sessionCookie,
  signInAccount,
} from '../src/lib/auth'
import {
  acquireWorker,
  workerOnline,
  claimTask,
  createProject,
  db,
  enqueueTask,
  getRuntime,
  getTask,
  setRuntime,
} from '../src/lib/store'
import {
  createInvitation,
  redeemInvitation,
  usageSummary,
} from '../src/lib/tenancy'
import {
  releaseModelCall,
  reserveModelCall,
  settleModelCall,
  withModelBilling,
} from '../src/lib/ai/billing'
import { openaiProvider } from '../src/lib/ai/provider'
import { templateFiles } from '../src/lib/runtime/template'
import { previewGrant } from '../src/lib/preview-access'
import { reapEnvironments } from '../src/lib/runtime/lifecycle'
import { assertProductionConfig } from '../src/lib/platform-config'
import {
  GET as projectsGET,
  POST as projectsPOST,
} from '../src/app/api/projects/route'
import {
  GET as projectGET,
  PATCH as projectPATCH,
} from '../src/app/api/projects/[id]/route'
import {
  GET as filesGET,
  PATCH as filesPATCH,
} from '../src/app/api/projects/[id]/files/route'
import { GET as taskGET } from '../src/app/api/tasks/[id]/route'
import { POST as cancelPOST } from '../src/app/api/tasks/[id]/cancel/route'
import {
  GET as releasesGET,
  POST as releasesPOST,
  PATCH as releasesPATCH,
} from '../src/app/api/projects/[id]/releases/route'
import {
  GET as cloudGET,
  POST as cloudPOST,
  PATCH as cloudPATCH,
} from '../src/app/api/projects/[id]/cloud/route'
import {
  GET as runtimeGET,
  POST as runtimePOST,
} from '../src/app/api/projects/[id]/runtime/route'
import { GET as diffGET } from '../src/app/api/projects/[id]/diff/route'
import { GET as versionsGET } from '../src/app/api/projects/[id]/versions/route'
import { GET as versionGET } from '../src/app/api/projects/[id]/versions/[versionId]/route'
import { GET as exportGET } from '../src/app/api/projects/[id]/versions/[versionId]/export/route'
import {
  GET as backupsGET,
  POST as backupsPOST,
} from '../src/app/api/projects/[id]/draft-backups/route'
import { POST as commitsPOST } from '../src/app/api/projects/[id]/commits/route'
import { POST as restoresPOST } from '../src/app/api/projects/[id]/restores/route'
import { POST as previewsPOST } from '../src/app/api/projects/[id]/previews/route'
import { POST as tasksPOST } from '../src/app/api/projects/[id]/tasks/route'
import { POST as grantPOST } from '../src/app/api/projects/[id]/preview-access/route'
import { POST as invitationPOST } from '../src/app/api/auth/invitation/route'
import { GET as assetGET } from '../src/app/api/previews/[artifactId]/[[...path]]/route'
import { POST as appAuthPOST } from '../src/app/api/app-auth/[artifactId]/[action]/route'
import { connectionId } from '../src/lib/cloud/store'
import { saveConnection, startSupabaseOAuth } from '../src/lib/cloud/oauth'
import type { AgentState } from '../src/lib/types'
import type { ProjectRuntime } from '../src/lib/runtime/types'

let directory: string
const origin = 'http://127.0.0.1:3000'
const profile = (name: string) => ({
  subject: `google-${name}`,
  email: `${name}@example.com`,
  name,
  picture: null,
})
function request(session = '', body?: unknown, pathname = '/') {
  return new Request(origin + pathname, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: '127.0.0.1:3000',
      cookie: `${sessionCookie}=${session}`,
      origin,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function account(name: string) {
  const session = signInAccount(profile(name))
  const user = currentAccount(request(session))!
  return { session, id: user.id }
}
function activated(name: string) {
  const user = account(name)
  redeemInvitation(user.id, createInvitation().code)
  return user
}
const agent = (): AgentState => ({
  provider: 'openai',
  model: 'test-model',
  prompt: 'hello',
  steps: 0,
  toolCalls: 0,
  buildFailures: 0,
  responseBytes: 0,
  reservedOutputTokens: 0,
  usage: { inputTokens: 0, outputTokens: 0 },
  startedAt: null,
})
async function agentTask(name = 'alice') {
  const user = activated(name)
  const project = createProject(name, await templateFiles(), user.id)
  enqueueTask(project.id, 'agent', 0, null, undefined, undefined, agent())
  return { user, project, task: claimTask()! }
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-tenancy-'))
  vi.stubEnv('PIXLOOM_DATA_DIR', directory)
  vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_ID', 'client')
  vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_SECRET', 'secret')
  vi.stubEnv('PIXLOOM_AUTH_URL', origin)
  vi.stubEnv('PIXLOOM_ADMIN_EMAILS', 'admin@example.com')
  vi.stubEnv('PIXLOOM_CLOUD_ENCRYPTION_KEY', 'a'.repeat(64))
  vi.stubEnv('PIXLOOM_AI_ENABLED', '1')
  vi.stubEnv('PIXLOOM_MODEL_WEIGHTS', '{}')
})
afterEach(async () => {
  db().close()
  delete (globalThis as { pixloomDb?: unknown }).pixloomDb
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('invitation and ownership boundary', () => {
  it('keeps new users pending, denies mutations, and only designates the configured administrator', async () => {
    const pending = account('alice')
    expect(currentAccount(request(pending.session))?.status).toBe('pending')
    expect(
      (await projectsPOST(request(pending.session, { name: 'no' }))).status,
    ).toBe(403)
    expect(currentAccount(request(account('admin').session))?.role).toBe(
      'admin',
    )
    const invite = createInvitation({ credits: 12345, days: 2 })
    const response = await invitationPOST(
      request(pending.session, { code: invite.code }),
    )
    expect(response.status).toBe(200)
    expect(usageSummary(pending.id).creditLimit).toBe(12345)
    expect(() => redeemInvitation(pending.id, createInvitation().code)).toThrow(
      '已激活',
    )
    expect(() => requireWorkspaceUser(request(pending.session))).not.toThrow()
  })
  it('atomically consumes one-use codes, rejects expired/disabled codes, and counts failed attempts', async () => {
    const alice = account('alice'),
      bob = account('bob')
    const invite = createInvitation()
    expect(db().prepare('SELECT codeHash FROM invitations').get()).not.toEqual({
      codeHash: invite.code,
    })
    const outcomes = await Promise.allSettled(
      [alice, bob].map((user) =>
        Promise.resolve().then(() => redeemInvitation(user.id, invite.code)),
      ),
    )
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      db().prepare('SELECT uses FROM invitations WHERE id=?').get(invite.id),
    ).toMatchObject({ uses: 1 })
    const remaining =
      currentAccount(request(alice.session))?.status === 'pending' ? alice : bob
    const expired = createInvitation()
    db()
      .prepare('UPDATE invitations SET expiresAt=0 WHERE id=?')
      .run(expired.id)
    expect(() => redeemInvitation(remaining.id, expired.code)).toThrow('失效')
    const disabled = createInvitation()
    db()
      .prepare('UPDATE invitations SET disabled=1 WHERE id=?')
      .run(disabled.id)
    expect(() => redeemInvitation(remaining.id, disabled.code)).toThrow('失效')
    for (let i = 0; i < 2; i++)
      expect(() => redeemInvitation(remaining.id, 'bad')).toThrow()
    expect(() =>
      redeemInvitation(remaining.id, createInvitation().code),
    ).toThrow('频繁')
  })
  it('filters lists and denies every project and task route before reading or modifying another owner', async () => {
    const alice = activated('alice'),
      bob = activated('bob')
    const project = createProject(
      'alice secret',
      await templateFiles(),
      alice.id,
    )
    const other = createProject(
      'bob public to bob',
      await templateFiles(),
      bob.id,
    )
    const task = enqueueTask(project.id, 'initialize', 0, null)
    const list = await (await projectsGET(request(bob.session))).json()
    expect(list.map((row: { id: string }) => row.id)).toEqual([other.id])
    const context = { params: { id: project.id, versionId: randomUUID() } }
    for (const handler of [
      projectGET,
      filesGET,
      releasesGET,
      cloudGET,
      runtimeGET,
      diffGET,
      versionsGET,
      versionGET,
      exportGET,
      backupsGET,
    ])
      expect((await handler(request(bob.session), context)).status).toBe(404)
    for (const handler of [
      projectPATCH,
      filesPATCH,
      releasesPOST,
      releasesPATCH,
      cloudPOST,
      cloudPATCH,
      runtimePOST,
      backupsPOST,
      commitsPOST,
      restoresPOST,
      previewsPOST,
      tasksPOST,
      grantPOST,
    ])
      expect((await handler(request(bob.session, {}), context)).status).toBe(
        404,
      )
    expect(
      (await taskGET(request(bob.session), { params: { id: task.id } })).status,
    ).toBe(404)
    expect(
      (await cancelPOST(request(bob.session, {}), { params: { id: task.id } }))
        .status,
    ).toBe(404)
    expect(getTask(task.id).status).toBe('queued')
    expect((await filesGET(request(alice.session), context)).status).toBe(200)
    expect(() => startSupabaseOAuth(request(bob.session), project.id)).toThrow(
      '项目不存在',
    )
  })
  it('assigns old local data only to an administrator and isolates external backend credentials', async () => {
    const local = createProject('local', await templateFiles())
    const alice = activated('alice'),
      bob = activated('bob')
    expect(() => requireProjectUser(request(alice.session), local.id)).toThrow(
      '不存在',
    )
    const admin = account('admin')
    expect(() =>
      requireProjectUser(request(admin.session), local.id),
    ).not.toThrow()
    const a = saveConnection(
      {
        access_token: 'alice-secret',
        refresh_token: 'alice-refresh',
        expires_in: 1000,
      },
      alice.id,
    )
    const b = saveConnection(
      {
        access_token: 'bob-secret',
        refresh_token: 'bob-refresh',
        expires_in: 1000,
      },
      bob.id,
    )
    expect(connectionId(alice.id)).toBe(a)
    expect(connectionId(bob.id)).toBe(b)
    expect(a).not.toBe(b)
    expect(connectionId(admin.id)).toBeNull()
  })
  it('migrates the legacy single-owner account, project and persistent session without transferring data to invitees', async () => {
    const local = { id: randomUUID() }
    const legacyDb = new DatabaseSync(path.join(directory, 'pixloom-v3.db'))
    legacyDb.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,currentVersionId TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE auth_account (id INTEGER PRIMARY KEY CHECK(id=1),subject TEXT NOT NULL UNIQUE,name TEXT NOT NULL,email TEXT NOT NULL,picture TEXT);
      CREATE TABLE auth_sessions (tokenHash TEXT PRIMARY KEY,expiresAt INTEGER NOT NULL); PRAGMA user_version=3;`)
    legacyDb
      .prepare('INSERT INTO projects VALUES (?,?,?,?,?)')
      .run(
        local.id,
        'legacy',
        null,
        new Date().toISOString(),
        new Date().toISOString(),
      )
    legacyDb
      .prepare('INSERT INTO auth_account VALUES (1,?,?,?,?)')
      .run('legacy-sub', 'legacy', 'legacy@example.com', null)
    legacyDb
      .prepare('INSERT INTO auth_sessions VALUES (?,?)')
      .run('old-hash', Date.now() + 100000)
    legacyDb.close()
    const migrated = db()
      .prepare('SELECT * FROM users WHERE subject=?')
      .get('legacy-sub') as { id: string; role: string }
    expect(migrated.role).toBe('admin')
    expect(
      db().prepare('SELECT ownerId FROM projects WHERE id=?').get(local.id),
    ).toMatchObject({ ownerId: migrated.id })
    expect(
      db()
        .prepare('SELECT userId FROM auth_sessions WHERE tokenHash=?')
        .get('old-hash'),
    ).toMatchObject({ userId: migrated.id })
    const other = activated('alice')
    expect(() => requireProjectUser(request(other.session), local.id)).toThrow(
      '不存在',
    )
    // Reopening repeats the additive migration safely.
    db().close()
    delete (globalThis as { pixloomDb?: unknown }).pixloomDb
    expect(
      db()
        .prepare('SELECT count(*) AS n FROM users WHERE subject=?')
        .get('legacy-sub'),
    ).toMatchObject({ n: 1 })
  })
  it('enforces access expiry, project/task limits and preserves reads after AI quota exhaustion', async () => {
    const alice = activated('alice')
    vi.stubEnv('PIXLOOM_MAX_PROJECTS_PER_USER', '1')
    const project = createProject('one', await templateFiles(), alice.id)
    const files = await templateFiles()
    expect(() => createProject('two', files, alice.id)).toThrow('数量')
    db().prepare('UPDATE users SET creditLimit=0 WHERE id=?').run(alice.id)
    expect(() =>
      enqueueTask(project.id, 'agent', 0, null, undefined, undefined, agent()),
    ).toThrow('额度')
    expect(
      (await filesGET(request(alice.session), { params: { id: project.id } }))
        .status,
    ).toBe(200)
    db().prepare('UPDATE users SET accessExpiresAt=0 WHERE id=?').run(alice.id)
    expect(() => requireWorkspaceUser(request(alice.session))).toThrow('到期')
  })
})

describe('metering at the upstream request boundary', () => {
  it('settles even incomplete model responses and is idempotent', async () => {
    const { user, task } = await agentTask()
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'incomplete',
            output: [],
            usage: { input_tokens: 120, output_tokens: 30 },
          }),
        ),
      ),
    )
    const session = openaiProvider.createSession({
      model: 'test-model',
      prompt: 'hello',
      signal: new AbortController().signal,
    })
    await expect(
      withModelBilling(task, () => session.next([], 100)),
    ).rejects.toThrow('未完成')
    expect(usageSummary(user.id)).toMatchObject({
      usedCredits: 240,
      inputTokens: 120,
      outputTokens: 30,
      reservedCredits: 0,
    })
    const reservation = await withModelBilling(task, async () =>
      reserveModelCall('abc', 100),
    )
    settleModelCall(reservation, { inputTokens: 3, outputTokens: 1 })
    settleModelCall(reservation, { inputTokens: 999, outputTokens: 999 })
    expect(usageSummary(user.id).usedCredits).toBe(247)
  })
  it('preserves unknown reservations across cancellation/restart and blocks budget overbooking', async () => {
    const { user, task } = await agentTask()
    await withModelBilling(task, async () => reserveModelCall('abc', 24000))
    expect(usageSummary(user.id).reservedCredits).toBe(96003)
    db().prepare('UPDATE users SET creditLimit=96004 WHERE id=?').run(user.id)
    await expect(
      withModelBilling(task, async () => reserveModelCall('abc', 100)),
    ).rejects.toThrow('剩余额度')
    acquireWorker('replacement')
    const restarted = claimTask('replacement')!
    expect(restarted.attemptId).not.toBe(task.attemptId)
    await expect(
      withModelBilling(task, async () => reserveModelCall('abc', 1)),
    ).rejects.toThrow('中断')
    expect(usageSummary(user.id).reservedCredits).toBe(96003)
    db().prepare('UPDATE users SET creditLimit=2000000 WHERE id=?').run(user.id)
    vi.stubEnv('PIXLOOM_DAILY_CREDITS', '96004')
    await expect(
      withModelBilling(restarted, async () => reserveModelCall('abc', 1)),
    ).rejects.toThrow('平台今日')
  })
  it('counts per-task output reservations, supports model weights, and honors the emergency switch', async () => {
    const { task, user } = await agentTask()
    vi.stubEnv(
      'PIXLOOM_MODEL_WEIGHTS',
      JSON.stringify({ 'openai:test-model': { input: 2, output: 10 } }),
    )
    const reservation = await withModelBilling(task, async () =>
      reserveModelCall('abcd', 24000),
    )
    expect(usageSummary(user.id).reservedCredits).toBe(240008)
    await withModelBilling(task, async () => reserveModelCall('abcd', 24000))
    await expect(
      withModelBilling(task, async () => reserveModelCall('a', 1)),
    ).rejects.toThrow('输出预算')
    releaseModelCall(reservation)
    expect(usageSummary(user.id).reservedCredits).toBe(240008)
    db()
      .prepare("INSERT INTO platform_settings VALUES ('ai_enabled','0')")
      .run()
    await expect(
      withModelBilling(task, async () => reserveModelCall('a', 1)),
    ).rejects.toThrow('暂停')
  })
  it('charges repeated network attempts conservatively and releases explicit rejected requests', async () => {
    const { task, user } = await agentTask()
    vi.stubEnv('OPENAI_API_KEY', 'test')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 401 })),
    )
    const session = openaiProvider.createSession({
      model: 'test-model',
      prompt: 'hello',
      signal: new AbortController().signal,
    })
    await expect(
      withModelBilling(task, () => session.next([], 100)),
    ).rejects.toThrow('401')
    expect(usageSummary(user.id).usedCredits).toBe(0)
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        controller.abort()
        throw new Error('lost')
      }),
    )
    const lost = openaiProvider.createSession({
      model: 'test-model',
      prompt: 'hello',
      signal: controller.signal,
    })
    await expect(
      withModelBilling(task, () => lost.next([], 100)),
    ).rejects.toThrow('lost')
    expect(usageSummary(user.id).reservedCredits).toBeGreaterThan(400)
  })
})

describe('private preview capabilities and runtime recycling', () => {
  it('requires ownership for preview and app auth, rewrites module paths and immediately revokes grants on logout', async () => {
    const alice = activated('alice'),
      bob = activated('bob')
    const project = createProject('private', await templateFiles(), alice.id),
      artifact = randomUUID()
    db()
      .prepare('INSERT INTO preview_artifacts VALUES (?,?,?,?,?,?)')
      .run(
        artifact,
        project.id,
        'hash',
        'template',
        100,
        new Date().toISOString(),
      )
    const html = `<script type="module" src="/api/previews/${artifact}/assets/app.js"></script>`
    for (const [file, body, type] of [
      ['index.html', html, 'text/html'],
      [
        'assets/app.js',
        `export const url='/api/previews/${artifact}/assets/x.css'`,
        'application/javascript',
      ],
    ])
      db()
        .prepare('INSERT INTO preview_assets VALUES (?,?,?,?)')
        .run(artifact, file, type, Buffer.from(body))
    expect(
      (await assetGET(request(), { params: { artifactId: artifact } })).status,
    ).toBe(401)
    expect(
      (
        await assetGET(request(bob.session), {
          params: { artifactId: artifact },
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await appAuthPOST(request(bob.session, {}), {
          params: { artifactId: artifact, action: 'resume' },
        })
      ).status,
    ).toBe(404)
    const grant = previewGrant(request(alice.session), artifact)
    const path = ['_grant', grant.token, 'index.html']
    const response = await assetGET(request(), {
      params: { artifactId: artifact, path },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(`${grant.base}assets/app.js`)
    const script = await assetGET(request(), {
      params: {
        artifactId: artifact,
        path: ['_grant', grant.token, 'assets', 'app.js'],
      },
    })
    expect(await script.text()).toContain(`${grant.base}assets/x.css`)
    expect(script.headers.get('content-security-policy')).toContain(
      'sandbox allow-scripts;',
    )
    expect(
      previewGrant(request(alice.session), artifact, grant.token).token,
    ).toBe(grant.token)
    revokeSession(request(alice.session))
    expect(
      (await assetGET(request(), { params: { artifactId: artifact, path } }))
        .status,
    ).toBe(403)
  })
  it('does not enumerate or manage another instance containers', async () => {
    const projectId = randomUUID()
    const command = vi.fn(async (args: string[]) => ({
      code: 0,
      stdout:
        args[0] === 'ps'
          ? projectId + '\n'
          : JSON.stringify([
              {
                Config: {
                  Labels: {
                    'dev.pixloom.runtime': 'true',
                    'dev.pixloom.project': projectId,
                    'dev.pixloom.instance': 'another-instance',
                  },
                },
                State: { Running: true },
              },
            ]),
      stderr: '',
    }))
    const runtime = new DockerRuntime(command, 'this-instance')
    expect(await runtime.managedProjects()).toEqual([projectId])
    expect(command.mock.calls[0][0]).toContain(
      'label=dev.pixloom.instance=this-instance',
    )
    await expect(runtime.remove(projectId)).rejects.toThrow('不属于')
    expect(command.mock.calls.some(([args]) => args[0] === 'rm')).toBe(false)
  })
  it('expires grants and refuses expired or disabled accounts without weakening asset validation', async () => {
    const { user, project } = await agentTask()
    const artifact = randomUUID()
    db()
      .prepare('INSERT INTO preview_artifacts VALUES (?,?,?,?,?,?)')
      .run(
        artifact,
        project.id,
        'hash',
        'template',
        1,
        new Date().toISOString(),
      )
    const grant = previewGrant(request(user.session), artifact)
    db().prepare('UPDATE preview_grants SET expiresAt=0').run()
    expect(
      (
        await assetGET(request(), {
          params: {
            artifactId: artifact,
            path: ['_grant', grant.token, 'index.html'],
          },
        })
      ).status,
    ).toBe(403)
    const next = previewGrant(request(user.session), artifact)
    db().prepare("UPDATE users SET status='disabled' WHERE id=?").run(user.id)
    expect(
      (
        await assetGET(request(), {
          params: {
            artifactId: artifact,
            path: ['_grant', next.token, 'index.html'],
          },
        })
      ).status,
    ).toBe(403)
  })
  it('reclaims idle/stopped and orphaned containers, skips running tasks, and reconciles missing containers', async () => {
    const projects = await Promise.all(
      [0, 1, 2, 3].map(async (i) =>
        createProject(`p${i}`, await templateFiles()),
      ),
    )
    for (const project of projects) setRuntime(project.id, 'running')
    db()
      .prepare('UPDATE runtime_workspaces SET updatedAt=?')
      .run('2020-01-01T00:00:00.000Z')
    enqueueTask(projects[1].id, 'initialize', 0, null)
    claimTask()
    const orphan = randomUUID(),
      removed: string[] = []
    const runtime = {
      managedProjects: async () => [...projects.map((p) => p.id), orphan],
      state: async (id: string) =>
        id === projects[2].id ? 'absent' : 'running',
      remove: async (id: string) => {
        removed.push(id)
      },
    } as unknown as ProjectRuntime
    await reapEnvironments(runtime)
    expect(removed.sort()).toEqual(
      [projects[0].id, projects[3].id, orphan].sort(),
    )
    expect(getRuntime(projects[1].id)?.state).toBe('running')
    expect(getRuntime(projects[2].id)?.state).toBe('absent')
  })
  it('reclaims oldest environments under capacity pressure and respects Worker ownership', async () => {
    const projects = await Promise.all(
      [0, 1, 2].map(async (i) => createProject(`p${i}`, await templateFiles())),
    )
    for (const project of projects) setRuntime(project.id, 'stopped')
    const removed: string[] = []
    const runtime = {
      state: async () => 'stopped',
      remove: async (id: string) => {
        removed.push(id)
      },
    } as unknown as ProjectRuntime
    await reapEnvironments(runtime, 'stale', true)
    expect(removed).toHaveLength(0)
    acquireWorker('owner')
    await reapEnvironments(runtime, 'owner', true)
    expect(removed).toHaveLength(1)
  })
})

describe('operator CLI against an isolated database', () => {
  it('creates/disables invitations, pauses running AI, and only reconciles terminal requests', async () => {
    const { user, task } = await agentTask()
    const run = (...args: string[]) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          ['--import', 'tsx', 'scripts/admin.ts', ...args],
          {
            cwd: process.cwd(),
            env: process.env,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      )
    const invitation = run('invite:create', '--credits=12345', '--uses=1') as {
      id: string
      code: string
    }
    expect(invitation.code).toHaveLength(32)
    expect(run('invite:disable', invitation.id)).toMatchObject({ ok: true })
    await withModelBilling(task, async () => reserveModelCall('abc', 100))
    const row = db()
      .prepare("SELECT id FROM usage_ledger WHERE status='reserved'")
      .get() as { id: string }
    expect(() => run('ledger:settle', row.id, '0', '0')).toThrow()
    expect(run('ai:pause')).toMatchObject({ ok: true })
    expect(getTask(task.id).status).toBe('cancelled')
    expect(run('ledger:settle', row.id, '0', '0')).toMatchObject({ ok: true })
    expect(usageSummary(user.id).reservedCredits).toBe(0)
    expect(run('credits:add', user.id, '100').creditLimit).toBe(2000100)
    expect(run('ai:resume')).toMatchObject({ ok: true })
  })
})

describe('HTTPS host cookies', () => {
  it('uses host-only cookie prefixes and refuses a domain-shadowed legacy session', () => {
    const alice = activated('alice')
    vi.stubEnv('PIXLOOM_AUTH_URL', 'https://pixloom.example')
    expect(authCookieName(sessionCookie)).toBe('__Host-pixloom_session')
    expect(currentAccount(request(alice.session))).toBeNull()
    const secure = new Request('https://pixloom.example', {
      headers: { cookie: `__Host-pixloom_session=${alice.session}` },
    })
    expect(currentAccount(secure)?.id).toBe(alice.id)
  })
  it('promotes a newly designated administrator without an invitation', () => {
    const alice = account('alice')
    vi.stubEnv('PIXLOOM_ADMIN_EMAILS', 'alice@example.com')
    const session = signInAccount(profile('alice'))
    expect(currentAccount(request(session))).toMatchObject({
      id: alice.id,
      role: 'admin',
      status: 'active',
    })
  })
})

describe('release readiness', () => {
  it('does not accept a recent heartbeat from the previous Worker release', () => {
    acquireWorker('old-worker')
    expect(workerOnline()).toBe(true)
    expect(workerOnline('a'.repeat(40))).toBe(false)
    db().prepare('UPDATE worker SET releaseSha=?').run('a'.repeat(40))
    expect(workerOnline('a'.repeat(40))).toBe(true)
    expect(workerOnline('b'.repeat(40))).toBe(false)
  })
})

describe('production fails closed', () => {
  it('requires OAuth, HTTPS, administrator and persistent absolute directories', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => assertProductionConfig()).toThrow('HTTPS')
    vi.stubEnv('PIXLOOM_AUTH_URL', 'https://pixloom.example')
    vi.stubEnv('PIXLOOM_DATA_DIR', directory)
    vi.stubEnv('PIXLOOM_PUBLISH_DIR', '/srv/pixloom/published')
    expect(() => assertProductionConfig()).not.toThrow()
    vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_ID', '')
    vi.stubEnv('PIXLOOM_GOOGLE_CLIENT_SECRET', '')
    expect(() => assertProductionConfig()).toThrow('Google')
    expect(() => requireWorkspaceUser(request())).toThrow('配置不完整')
  })
})

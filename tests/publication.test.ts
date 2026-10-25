import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID, randomInt } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  acquireWorker,
  cancelTask,
  claimTask,
  completeBuild,
  createProject,
  db,
  enqueueTask,
  getDraft,
  getProject,
  getTask,
  getVersion,
  updateDraft,
  artifactDelivery,
  projectPublicId,
} from '../src/lib/store'
import {
  enqueuePublication,
  getRelease,
  liveRelease,
  releaseForTask,
  setReleasePhase,
  completePublication,
} from '../src/lib/publication/store'
import {
  publicationConfig,
  publicationTarget,
  caddyConfig,
} from '../src/lib/publication/config'
import { PublicationFiles } from '../src/lib/publication/files'
import { gatewayHandler } from '../src/lib/publication/gateway'
import { runTask } from '../src/lib/runner'
import { templateFiles } from '../src/lib/runtime/template'
import { GET, POST, PATCH } from '../src/app/api/projects/[id]/releases/route'
import type { Release, SourceFile, Task } from '../src/lib/types'

vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>()
  return { ...original, randomInt: vi.fn(original.randomInt) }
})

let directory: string, files: SourceFile[]
const keys = [
  'PIXLOOM_DATA_DIR',
  'PIXLOOM_PUBLISH_ENABLED',
  'PIXLOOM_PUBLISH_DOMAIN',
  'PIXLOOM_PUBLISH_DIR',
  'PIXLOOM_GATEWAY_PORT',
  'PIXLOOM_PUBLISH_PORT',
]
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
const verify = vi.fn(async () => ({
  ok: true,
  completedSteps: 0,
  output: '加载正常',
}))
const preflight = vi.fn(async () => {})
function executor() {
  const disk = new PublicationFiles()
  return { stage: disk.stage.bind(disk), preflight }
}
const execute = (task: Task, owner?: string) =>
  runTask(task, undefined, undefined, owner, undefined, verify, executor())
function version(
  projectId: string,
  text: string,
  kind: 'initialize' | 'commit' | 'preview' = 'commit',
  target?: string,
) {
  const state = getProject(projectId)
  enqueueTask(
    projectId,
    kind,
    state.draft.revision,
    state.project.currentVersionId,
    target,
  )
  const artifactId = randomUUID()
  return completeBuild(claimTask()!, 'fixed-template', artifactId, [
    {
      path: 'index.html',
      contentType: '',
      body: Buffer.from(
        `<div id="root">${text}</div><script type="module" src="/api/previews/${artifactId}/assets/app.js"></script>`,
      ).toString('base64'),
    },
    {
      path: 'assets/app.js',
      contentType: '',
      body: Buffer.from(`window.label=${JSON.stringify(text)}`).toString(
        'base64',
      ),
    },
    {
      path: 'manifest.json',
      contentType: '',
      body: Buffer.from('{"app":true}').toString('base64'),
    },
  ])
}
function initial() {
  const project = createProject('Publish test', files)
  return { project, v1: version(project.id, 'one', 'initialize')! }
}
function queue(projectId: string, versionId: string) {
  return enqueuePublication(
    projectId,
    {
      action: 'publish',
      versionId,
      expectedReleaseId: liveRelease(projectId)?.id || null,
    },
    publicationTarget(projectId),
  )
}
async function publish(projectId: string, versionId: string) {
  const { release } = queue(projectId, versionId)
  await execute(claimTask()!)
  return getRelease(release.id)
}
async function serve(
  host: string,
  url = '/',
  method = 'GET',
  remote = '127.0.0.1',
) {
  let status = 0,
    headers: Record<string, string | number> = {},
    body = Buffer.alloc(0)
  const response = {
    setHeader(key: string, value: string) {
      headers[key] = value
    },
    writeHead(code: number, values?: typeof headers) {
      status = code
      headers = { ...headers, ...values }
      return this
    },
    end(value?: string | Buffer) {
      if (value) body = Buffer.from(value)
      return this
    },
  }
  await gatewayHandler()(
    {
      method,
      url,
      headers: { host },
      socket: { remoteAddress: remote },
    } as IncomingMessage,
    response as unknown as ServerResponse,
  )
  return { status, headers, body }
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-publish-test-'))
  process.env.PIXLOOM_DATA_DIR = directory
  process.env.PIXLOOM_PUBLISH_DIR = path.join(directory, 'published')
  process.env.PIXLOOM_PUBLISH_ENABLED = '1'
  process.env.PIXLOOM_PUBLISH_DOMAIN = 'apps.localhost'
  delete process.env.PIXLOOM_PUBLISH_PORT
  files = await templateFiles()
})
beforeEach(async () => {
  db().exec('DELETE FROM versions; DELETE FROM projects; DELETE FROM worker;')
  await rm(path.join(directory, 'published'), { recursive: true, force: true })
  verify
    .mockReset()
    .mockResolvedValue({ ok: true, completedSteps: 0, output: '加载正常' })
  preflight.mockReset().mockResolvedValue()
  process.env.PIXLOOM_PUBLISH_ENABLED = '1'
})
afterAll(async () => {
  db().close()
  delete (globalThis as { pixloomDb?: unknown }).pixloomDb
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  await rm(directory, { recursive: true, force: true })
})

describe('stable six-character public IDs', () => {
  it('assigns six lowercase letters/digits per project and retries collisions', () => {
    vi.mocked(randomInt)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 1)
    const first = createProject('first', files),
      second = createProject('second', files)
    expect(projectPublicId(first.id)).toBe('000000')
    expect(projectPublicId(second.id)).toBe('000001')
    expect(publicationTarget(first.id).domain).toBe('000000.apps.localhost')
    expect(first.id).toMatch(/^[a-f0-9-]{36}$/)
    db().close()
    delete (globalThis as { pixloomDb?: unknown }).pixloomDb
    expect(projectPublicId(first.id)).toBe('000000')
    expect(projectPublicId(second.id)).toBe('000001')
  })

  it('upgrades legacy release addresses without rewriting audit rows or breaking old links', async () => {
    const { project, v1 } = initial(),
      original = await publish(project.id, v1.id)
    const legacy = `p-${project.id.replace(/-/g, '')}.apps.localhost`
    db()
      .prepare('UPDATE releases SET domain=?,url=? WHERE id=?')
      .run(legacy, `http://${legacy}:4180`, original.id)
    db()
      .prepare('UPDATE published_sites SET domain=? WHERE projectId=?')
      .run(legacy, project.id)
    db()
      .prepare('DELETE FROM project_public_ids WHERE projectId=?')
      .run(project.id)
    const migrated = liveRelease(project.id)!
    expect(migrated.domain).toMatch(/^[a-z0-9]{6}\.apps\.localhost$/)
    expect(migrated.url).toBe(`http://${migrated.domain}:4180`)
    expect(
      (
        db()
          .prepare('SELECT domain FROM releases WHERE id=?')
          .get(original.id) as { domain: string }
      ).domain,
    ).toBe(legacy)
    expect((await serve(migrated.domain)).status).toBe(200)
    expect((await serve(legacy)).status).toBe(200)
    expect(
      (
        await serve(
          '127.0.0.1',
          `/_pixloom/allow-domain?domain=${migrated.domain}`,
        )
      ).status,
    ).toBe(200)
    expect(
      (await serve('127.0.0.1', `/_pixloom/allow-domain?domain=${legacy}`))
        .status,
    ).toBe(200)
    const api = await (
      await GET(new Request('http://localhost'), { params: { id: project.id } })
    ).json()
    expect(api.live.domain).toBe(migrated.domain)
    expect(api.releases[0].domain).toBe(migrated.domain)
    updateDraft(project.id, getDraft(project.id).revision, [
      { type: 'write', path: 'src/App.jsx', content: 'export default 2' },
    ])
    const v2 = version(project.id, 'two')!
    expect((await publish(project.id, v2.id)).domain).toBe(migrated.domain)
    expect((await serve(legacy)).body.toString()).toContain('two')
    expect((await serve(migrated.domain)).body.toString()).toContain('two')
    expect(
      (await serve(`p-${randomUUID().replace(/-/g, '')}.apps.localhost`))
        .status,
    ).toBe(404)
    const other = initial()
    expect(
      (await serve(legacy, `/api/previews/${other.v1.artifactId}/index.html`))
        .status,
    ).toBe(404)
    enqueuePublication(
      project.id,
      { action: 'unpublish', expectedReleaseId: liveRelease(project.id)!.id },
      null,
    )
    await execute(claimTask()!)
    expect((await serve(migrated.domain)).status).toBe(404)
    expect((await serve(legacy)).status).toBe(404)
  })
})

describe('custom publication prefixes', () => {
  const request = (body: unknown, method = 'PATCH') =>
    new Request('http://localhost/api', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const rename = (projectId: string, prefix: string, extra = {}) =>
    PATCH(
      request({
        prefix,
        expectedPrefix: projectPublicId(projectId),
        expectedReleaseId: liveRelease(projectId)?.id || null,
        ...extra,
      }),
      { params: { id: projectId } },
    )

  it('accepts a custom prefix directly on publish and normalizes case and whitespace', async () => {
    const { project, v1 } = initial()
    acquireWorker('custom-api')
    const response = await POST(
      request(
        {
          action: 'publish',
          versionId: v1.id,
          expectedReleaseId: null,
          prefix: ' My-App ',
          expectedPrefix: projectPublicId(project.id),
        },
        'POST',
      ),
      { params: { id: project.id } },
    )
    expect(response.status).toBe(202)
    const { release } = await response.json()
    expect(release.domain).toBe('my-app.apps.localhost')
    await execute(claimTask()!)
    expect((await serve(release.domain)).status).toBe(200)
    expect(liveRelease(project.id)?.url).toBe(
      'http://my-app.apps.localhost:4180',
    )
  })

  it('reserves unpublished prefixes, prevents case-insensitive duplicates and retries random collisions', async () => {
    const first = initial(),
      second = initial()
    expect((await rename(first.project.id, '000000')).status).toBe(200)
    vi.mocked(randomInt)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 1)
    const third = createProject('collision', files)
    expect(projectPublicId(third.id)).toBe('000001')
    const duplicate = await rename(second.project.id, '000000')
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json()).error).toContain('已被使用')
    expect((await rename(first.project.id, 'My-App')).status).toBe(200)
    expect((await rename(second.project.id, 'MY-APP')).status).toBe(409)
    expect(() =>
      db()
        .prepare('UPDATE project_public_ids SET shortId=? WHERE projectId=?')
        .run('my-app', second.project.id),
    ).toThrow('UNIQUE')
    expect((await rename(second.project.id, 'my-app-2')).status).toBe(200)
    db().close()
    delete (globalThis as { pixloomDb?: unknown }).pixloomDb
    expect(projectPublicId(first.project.id)).toBe('my-app')
    expect(projectPublicId(second.project.id)).toBe('my-app-2')
  })

  it('allows only one of two concurrent requests to claim the same prefix', async () => {
    const first = initial(),
      second = initial()
    const responses = await Promise.all([
      rename(first.project.id, 'same-name'),
      rename(second.project.id, 'SAME-NAME'),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ])
    expect(
      [
        projectPublicId(first.project.id),
        projectPublicId(second.project.id),
      ].filter((prefix) => prefix === 'same-name'),
    ).toHaveLength(1)
  })

  it.each([
    '',
    '-app',
    'app-',
    'my_app',
    'app.test',
    'https://app',
    '中文',
    'x'.repeat(64),
    `p-${'a'.repeat(32)}`,
  ])('rejects invalid or reserved prefix %s', async (prefix) => {
    const { project } = initial()
    const before = projectPublicId(project.id)
    expect((await rename(project.id, prefix)).status).toBe(400)
    expect(projectPublicId(project.id)).toBe(before)
  })

  it('switches live routing and certificate authorization without rebuilding; rollback retains the new prefix', async () => {
    const { project, v1 } = initial()
    const first = await publish(project.id, v1.id)
    const response = await rename(project.id, 'live-app')
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.live.id).toBe(first.id)
    expect(result.live.artifactId).toBe(first.artifactId)
    expect(result.live.domain).toBe('live-app.apps.localhost')
    expect(result.releases[0].domain).toBe(first.domain)
    expect((await serve(first.domain)).status).toBe(404)
    expect((await serve(result.live.domain)).body.toString()).toContain('one')
    for (const [domain, expected] of [
      [first.domain, 403],
      [result.live.domain, 200],
    ] as const)
      expect(
        (await serve('127.0.0.1', `/_pixloom/allow-domain?domain=${domain}`))
          .status,
      ).toBe(expected)
    const legacy = `p-${project.id.replace(/-/g, '')}.apps.localhost`
    expect((await serve(legacy)).status).toBe(200)
    updateDraft(project.id, getDraft(project.id).revision, [
      { type: 'write', path: 'src/App.jsx', content: 'export default 2' },
    ])
    const v2 = version(project.id, 'two')!
    const second = await publish(project.id, v2.id)
    enqueuePublication(
      project.id,
      { action: 'rollback', releaseId: first.id, expectedReleaseId: second.id },
      publicationTarget(project.id),
    )
    await execute(claimTask()!)
    expect(liveRelease(project.id)?.domain).toBe(result.live.domain)
    expect((await serve(result.live.domain)).body.toString()).toContain('one')
    enqueuePublication(
      project.id,
      { action: 'unpublish', expectedReleaseId: liveRelease(project.id)!.id },
      null,
    )
    await execute(claimTask()!)
    expect((await serve(result.live.domain)).status).toBe(404)
    expect((await serve(legacy)).status).toBe(404)
    // Taking a site offline keeps its prefix reserved for republishing.
    const other = initial()
    expect((await rename(other.project.id, 'live-app')).status).toBe(409)
  })

  it('rejects stale edits and active tasks, and rolls back a prefix claim when enqueue fails', async () => {
    const { project, v1 } = initial()
    const before = projectPublicId(project.id)
    expect((await rename(project.id, 'new-prefix')).status).toBe(200)
    expect(
      (await rename(project.id, 'stale-prefix', { expectedPrefix: before }))
        .status,
    ).toBe(409)
    expect(
      (
        await rename(project.id, 'stale-release', {
          expectedReleaseId: randomUUID(),
        })
      ).status,
    ).toBe(409)
    acquireWorker('custom-api')
    expect(
      (
        await POST(
          request(
            {
              action: 'publish',
              versionId: randomUUID(),
              expectedReleaseId: null,
              prefix: 'failed-claim',
              expectedPrefix: 'new-prefix',
            },
            'POST',
          ),
          { params: { id: project.id } },
        )
      ).status,
    ).toBe(404)
    expect(projectPublicId(project.id)).toBe('new-prefix')
    const queued = queue(project.id, v1.id)
    expect((await rename(project.id, 'blocked')).status).toBe(409)
    cancelTask(queued.task.id)
    expect((await rename(project.id, 'after-cancel')).status).toBe(200)
    // A request constructed before the edit cannot publish under the stale address.
    expect(() =>
      enqueuePublication(
        project.id,
        { action: 'publish', versionId: v1.id, expectedReleaseId: null },
        publicationTarget(project.id, publicationConfig(), 'new-prefix'),
      ),
    ).toThrow('域名前缀已变化')
  })

  it('upgrades the old six-character database constraint while preserving IDs and uniqueness', async () => {
    const first = initial(),
      second = initial()
    const before = projectPublicId(first.project.id)
    db().exec(`BEGIN IMMEDIATE;
      CREATE TABLE project_public_ids_old (projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,shortId TEXT NOT NULL UNIQUE CHECK(length(shortId)=6 AND shortId NOT GLOB '*[^a-z0-9]*'));
      INSERT INTO project_public_ids_old SELECT * FROM project_public_ids;
      DROP TABLE project_public_ids;
      ALTER TABLE project_public_ids_old RENAME TO project_public_ids;
      COMMIT;`)
    db().close()
    delete (globalThis as { pixloomDb?: unknown }).pixloomDb
    expect(projectPublicId(first.project.id)).toBe(before)
    expect(
      (await rename(first.project.id, 'migrated-custom-prefix')).status,
    ).toBe(200)
    expect(
      (await rename(second.project.id, 'migrated-custom-prefix')).status,
    ).toBe(409)
  })
})

describe('automatic publication lifecycle', () => {
  it('publishes pinned artifacts without touching the draft, source versions or Docker', async () => {
    const { project, v1 } = initial()
    updateDraft(project.id, getDraft(project.id).revision, [
      { type: 'write', path: 'src/private.txt', content: 'not-published' },
    ])
    const draft = getDraft(project.id),
      state = getProject(project.id)
    const release = await publish(project.id, v1.id)
    expect(release.status).toBe('published')
    expect(getDraft(project.id)).toEqual(draft)
    expect(getProject(project.id).versions).toEqual(state.versions)
    expect(getProject(project.id).runtime).toBeNull()
    expect((await serve(release.domain)).body.toString()).toContain('one')
    expect((await serve(release.domain, '/src/private.txt')).status).toBe(404)
    expect(
      (
        await serve(
          release.domain,
          `/api/previews/${v1.artifactId}/manifest.json`,
        )
      ).body.toString(),
    ).toBe('{"app":true}')
    expect(() => queue(project.id, v1.id)).toThrow('已经上线')
  })

  it('updates the live pointer atomically while keeping old resource URLs available', async () => {
    const { project, v1 } = initial(),
      r1 = await publish(project.id, v1.id)
    updateDraft(project.id, getDraft(project.id).revision, [
      { type: 'write', path: 'src/App.jsx', content: 'export default 2' },
    ])
    const v2 = version(project.id, 'two')!
    const queued = queue(project.id, v2.id),
      task = claimTask()!
    let finish!: () => void
    verify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ ok: true, completedSteps: 0, output: '正常' })
        }),
    )
    const running = execute(task)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(liveRelease(project.id)!.id).toBe(r1.id)
    expect((await serve(r1.domain)).body.toString()).toContain('one')
    finish()
    await running
    expect(getRelease(queued.release.id).status).toBe('published')
    expect((await serve(r1.domain)).body.toString()).toContain('two')
    const old = await serve(
      r1.domain,
      `/api/previews/${v1.artifactId}/assets/app.js`,
    )
    expect(old.body.toString()).toContain('one')
    expect(old.headers['Cache-Control']).toContain('immutable')
    expect((await serve(r1.domain)).headers['Cache-Control']).toBe('no-store')
  })

  it('rolls back to the original release artifact after the source version preview was rebuilt', async () => {
    const { project, v1 } = initial(),
      r1 = await publish(project.id, v1.id)
    updateDraft(project.id, getDraft(project.id).revision, [
      { type: 'write', path: 'src/App.jsx', content: 'export default 2' },
    ])
    const v2 = version(project.id, 'two')!,
      r2 = await publish(project.id, v2.id)
    version(project.id, 'rebuilt-one', 'preview', v1.id)
    expect(getVersion(project.id, v1.id).artifactId).not.toBe(r1.artifactId)
    const draft = getDraft(project.id)
    const queued = enqueuePublication(
      project.id,
      { action: 'rollback', releaseId: r1.id, expectedReleaseId: r2.id },
      publicationTarget(project.id),
    )
    await execute(claimTask()!)
    expect(getRelease(queued.release.id).artifactId).toBe(r1.artifactId)
    expect((await serve(r1.domain)).body.toString()).toContain('one')
    expect((await serve(r1.domain)).body.toString()).not.toContain('rebuilt')
    expect(getDraft(project.id)).toEqual(draft)
    expect(getProject(project.id).project.currentVersionId).toBe(v2.id)
  })

  it('keeps the previous live release on gateway or browser failure', async () => {
    const { project, v1 } = initial(),
      r1 = await publish(project.id, v1.id)
    updateDraft(project.id, getDraft(project.id).revision, [
      { type: 'write', path: 'src/App.jsx', content: 'export default 2' },
    ])
    const v2 = version(project.id, 'two')!
    preflight.mockRejectedValueOnce(new Error('offline'))
    const failedGateway = await publish(project.id, v2.id)
    expect(failedGateway.status).toBe('failed')
    expect(failedGateway.error).toContain('网关')
    verify.mockResolvedValueOnce({
      ok: false,
      completedSteps: 0,
      output: '页面异常',
    })
    expect((await publish(project.id, v2.id)).status).toBe('failed')
    preflight
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('gateway stopped before switching'))
    const stopped = await publish(project.id, v2.id)
    expect(stopped.status).toBe('failed')
    expect(stopped.error).toContain('网关')
    expect(liveRelease(project.id)!.id).toBe(r1.id)
  })

  it('cancels queued and in-flight releases and rejects late completion', async () => {
    const { project, v1 } = initial()
    const queued = queue(project.id, v1.id)
    cancelTask(queued.task.id)
    expect(getRelease(queued.release.id).status).toBe('cancelled')
    const next = queue(project.id, v1.id),
      task = claimTask()!
    let finish!: () => void
    verify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ ok: true, completedSteps: 0, output: '正常' })
        }),
    )
    const running = execute(task)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    cancelTask(task.id)
    finish()
    await running
    expect(getRelease(next.release.id).status).toBe('cancelled')
    expect(liveRelease(project.id)).toBeNull()
    expect(completePublication(task)).toBe(false)
  })

  it('recovers staged tasks under a new worker without granting an old attempt commit rights', async () => {
    const { project, v1 } = initial()
    queue(project.id, v1.id)
    acquireWorker('old')
    const old = claimTask('old')!
    const oldRelease = releaseForTask(old)
    await new PublicationFiles().stage(
      oldRelease,
      artifactDelivery(
        project.id,
        oldRelease.artifactId,
        oldRelease.sourceHash,
        oldRelease.templateId,
      ),
      old.attemptId!,
      new AbortController().signal,
    )
    setReleasePhase(old, 'verifying', 'old')
    db().prepare('UPDATE worker SET heartbeat=0').run()
    expect(acquireWorker('new')).toBe(true)
    const next = claimTask('new')!
    expect(next.attemptId).not.toBe(old.attemptId)
    await execute(next, 'new')
    expect(liveRelease(project.id)).not.toBeNull()
    expect(completePublication(old, 'old')).toBe(false)
  })

  it('unpublishes every artifact URL and can republish a historical release', async () => {
    const { project, v1 } = initial(),
      r1 = await publish(project.id, v1.id)
    const down = enqueuePublication(
      project.id,
      { action: 'unpublish', expectedReleaseId: r1.id },
      null,
    )
    await execute(claimTask()!)
    expect(getRelease(down.release.id).status).toBe('unpublished')
    expect((await serve(r1.domain)).status).toBe(404)
    expect(
      (await serve(r1.domain, `/api/previews/${v1.artifactId}/assets/app.js`))
        .status,
    ).toBe(404)
    expect(
      (await serve('127.0.0.1', `/_pixloom/allow-domain?domain=${r1.domain}`))
        .status,
    ).toBe(403)
    enqueuePublication(
      project.id,
      { action: 'rollback', releaseId: r1.id, expectedReleaseId: null },
      publicationTarget(project.id),
    )
    await execute(claimTask()!)
    expect((await serve(r1.domain)).status).toBe(200)
  })

  it('checks online baselines, project ownership and the unified project operation lock', async () => {
    const { project, v1 } = initial(),
      other = initial().project
    expect(() => queue(other.id, v1.id)).toThrow('版本不存在')
    expect(() =>
      enqueuePublication(
        project.id,
        {
          action: 'publish',
          versionId: v1.id,
          expectedReleaseId: randomUUID(),
        },
        publicationTarget(project.id),
      ),
    ).toThrow('线上版本已变化')
    queue(project.id, v1.id)
    expect(() =>
      updateDraft(project.id, getDraft(project.id).revision, [
        { type: 'write', path: 'src/x.txt', content: '' },
      ]),
    ).toThrow('正在执行')
    expect(() => queue(project.id, v1.id)).toThrow('正在执行')
  })
})

describe('publication gateway and API boundaries', () => {
  it('serves only published project resources and denies platform paths, forged hosts and cross-project assets', async () => {
    const a = initial(),
      b = initial()
    const r1 = await publish(a.project.id, a.v1.id),
      r2 = await publish(b.project.id, b.v1.id)
    for (const url of [
      '/api/projects',
      '/api/tasks/123',
      '/_pixloom/health',
      '/.env',
      '/source/src/App.jsx',
      `/api/previews/${r2.artifactId}/index.html`,
    ])
      expect((await serve(r1.domain, url)).status).not.toBe(200)
    expect((await serve(r1.domain + '.evil')).status).toBe(404)
    expect((await serve(r1.domain, '/', 'POST')).status).toBe(405)
    expect((await serve(r1.domain, '/', 'HEAD')).body.length).toBe(0)
    expect(
      (await serve(r1.domain)).headers['Access-Control-Allow-Origin'],
    ).toBeUndefined()
    expect(
      (await serve('127.0.0.1', `/_pixloom/allow-domain?domain=${r1.domain}`))
        .status,
    ).toBe(200)
    expect(
      (
        await serve(
          '127.0.0.1',
          `/_pixloom/allow-domain?domain=${r1.domain}`,
          'GET',
          '1.2.3.4',
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await serve(
          '127.0.0.1',
          '/_pixloom/allow-domain?domain=unknown.apps.localhost',
        )
      ).status,
    ).toBe(403)
    expect((await serve('127.0.0.1', '/_pixloom/health')).status).toBe(200)
  })

  it('fails closed on tampered or symlinked artifacts', async () => {
    const { project, v1 } = initial(),
      release = await publish(project.id, v1.id)
    const target = path.join(
      directory,
      'published',
      project.id,
      'artifacts',
      v1.artifactId,
      'site',
      'index.html',
    )
    await writeFile(target, 'tampered')
    expect((await serve(release.domain)).status).toBe(503)
    const outside = path.join(directory, 'outside.html')
    await writeFile(outside, 'private')
    await rm(target)
    await symlink(outside, target)
    const response = await serve(release.domain)
    expect(response.status).toBe(503)
    expect(response.body.toString()).not.toContain('private')
    await expect(
      new PublicationFiles().readAsset(
        project.id,
        v1.artifactId,
        '../outside.html',
      ),
    ).rejects.toThrow('路径')
  })

  it('validates API inputs, requires the worker, and returns asynchronous release records', async () => {
    const { project, v1 } = initial(),
      params = { id: project.id }
    const req = (body: unknown) =>
      new Request('http://localhost/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const input = {
      action: 'publish',
      versionId: v1.id,
      expectedReleaseId: null,
    }
    expect((await POST(req(input), { params })).status).toBe(503)
    acquireWorker('api')
    expect(
      (await POST(req({ ...input, domain: 'evil.test' }), { params })).status,
    ).toBe(400)
    process.env.PIXLOOM_PUBLISH_ENABLED = '0'
    expect((await POST(req(input), { params })).status).toBe(503)
    process.env.PIXLOOM_PUBLISH_ENABLED = '1'
    const result = await POST(req(input), { params })
    expect(result.status).toBe(202)
    const json = await result.json()
    expect(json.release.status).toBe('queued')
    expect(json.task.candidateFiles).toEqual([])
    const status = await (
      await GET(new Request('http://localhost'), { params })
    ).json()
    expect(status.releases).toHaveLength(1)
    expect(status.live).toBeNull()
  })

  it('generates restricted Caddy configs and rejects invalid domain injection', () => {
    const config = publicationConfig()
    expect(caddyConfig(config)).toContain('/_pixloom/allow-domain')
    expect(caddyConfig(config)).toContain('respond @internal 404')
    expect(caddyConfig(config, 8123)).toContain('bind 127.0.0.1')
    expect(() => caddyConfig(config, 0)).toThrow('端口')
    const old = process.env.PIXLOOM_PUBLISH_DOMAIN
    process.env.PIXLOOM_PUBLISH_DOMAIN = 'apps.pixloom.io { evil }'
    expect(() => publicationConfig()).toThrow('DNS')
    process.env.PIXLOOM_PUBLISH_DOMAIN = old
  })
})

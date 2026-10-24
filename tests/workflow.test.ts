import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  acquireWorker,
  artifactFor,
  cancelTask,
  claimTask,
  completeBuild,
  createProject,
  db,
  draftBackups,
  enqueueTask,
  getDraft,
  listProjects,
  getProject,
  getTask,
  getVersion,
  heartbeat,
  previewAsset,
  recoverDraftBackup,
  releaseWorker,
  setRuntime,
  updateDraft,
  validateAssets,
} from '../src/lib/store'
import { snapshot } from '../src/lib/workspace-files'
import { diffFiles } from '../src/lib/diff'
import { runTask } from '../src/lib/runner'
import type { BuildAsset, Task } from '../src/lib/types'
import type { ProjectRuntime, SourceFile } from '../src/lib/runtime/types'
import { templateFiles } from '../src/lib/runtime/template'
import { GET as taskGET } from '../src/app/api/tasks/[id]/route'
import {
  GET as projectGET,
  PATCH as projectPATCH,
} from '../src/app/api/projects/[id]/route'
import { POST as projectPOST } from '../src/app/api/projects/route'
import {
  GET as filesGET,
  PATCH as filesPATCH,
} from '../src/app/api/projects/[id]/files/route'
import { POST as commitPOST } from '../src/app/api/projects/[id]/commits/route'
import { POST as restorePOST } from '../src/app/api/projects/[id]/restores/route'
import { GET as previewGET } from '../src/app/api/previews/[artifactId]/[[...path]]/route'

import { verifyBrowser } from '../src/lib/browser'
vi.mock('../src/lib/browser', () => ({
  verifyBrowser: vi.fn(async () => ({
    ok: true,
    output: '浏览器验证通过',
    completedSteps: 1,
  })),
}))

let directory: string, files: SourceFile[]
const asset = (text = 'React preview'): BuildAsset[] => [
  {
    path: 'index.html',
    contentType: 'text/html',
    body: Buffer.from(text).toString('base64'),
  },
]
function fakeRuntime() {
  let state: 'absent' | 'running' | 'stopped' = 'absent'
  let loaded: SourceFile[] = []
  const runtime: ProjectRuntime = {
    health: vi.fn(async () => ({
      available: true,
      imageReady: true,
      reason: null,
    })),
    prepare: vi.fn(async () => {}),
    templateId: vi.fn(async () => 'sha256:fixed-template'),
    create: vi.fn(async () => {
      state = 'running'
    }),
    start: vi.fn(async () => {
      state = 'running'
    }),
    state: vi.fn(async () => state),
    stop: vi.fn(async () => {
      state = 'stopped'
    }),
    remove: vi.fn(async () => {
      state = 'absent'
    }),
    replaceFiles: vi.fn(async (_id, next) => {
      loaded = next
    }),
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => {}),
    listFiles: vi.fn(async () => []),
    searchFiles: vi.fn(async () => []),
    execute: vi.fn(async () => ({
      exitCode: 0,
      output: 'build success',
      timedOut: false,
    })),
    exportBuild: vi.fn(async () => asset(JSON.stringify(loaded))),
    logs: vi.fn(async () => ''),
    preview: vi.fn(async () => ({
      status: 200,
      body: '',
      contentType: 'text/html',
    })),
  }
  return runtime
}
function newProject() {
  return createProject('测试 React', files)
}
async function initialize() {
  const project = newProject(),
    runtime = fakeRuntime()
  enqueueTask(project.id, 'initialize', 0, null)
  const task = claimTask()!
  await runTask(task, runtime)
  return {
    project,
    runtime,
    version: getVersion(
      project.id,
      getProject(project.id).project.currentVersionId!,
    ),
  }
}
function queueCommit(id: string) {
  const detail = getProject(id)
  enqueueTask(
    id,
    'commit',
    detail.draft.revision,
    detail.project.currentVersionId,
  )
  return claimTask()!
}
function edit(
  id: string,
  content = 'export default function App(){return <h1>修改</h1>}',
) {
  const draft = getDraft(id)
  return updateDraft(id, draft.revision, [
    { type: 'write', path: 'src/App.jsx', content },
  ])
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-v3-'))
  process.env.PIXLOOM_DATA_DIR = directory
  files = await templateFiles()
})
beforeEach(() => {
  db().exec('DELETE FROM versions; DELETE FROM projects; DELETE FROM worker;')
  vi.restoreAllMocks()
  vi.mocked(verifyBrowser).mockReset().mockResolvedValue({
    ok: true,
    output: '浏览器验证通过',
    completedSteps: 1,
  })
})
afterAll(async () => {
  db().close()
  delete (globalThis as { pixloomDb?: unknown }).pixloomDb
  delete process.env.PIXLOOM_DATA_DIR
  await rm(directory, { recursive: true, force: true })
})

describe('multi-file workspace lifecycle', () => {
  it('builds v1/v2, restores v1 as v3 without future files, then modifies v3 into v4', async () => {
    const { project, runtime, version: v1 } = await initialize()
    const draft = getDraft(project.id)
    updateDraft(project.id, draft.revision, [
      { type: 'write', path: 'src/extra.jsx', content: 'export default 2' },
      {
        type: 'write',
        path: 'src/styles.css',
        content: 'body { color: red; }',
      },
    ])
    await runTask(queueCommit(project.id), runtime)
    const v2 = getVersion(
      project.id,
      getProject(project.id).project.currentVersionId!,
    )
    expect(diffFiles(v1.files, v2.files).map((f) => [f.path, f.type])).toEqual([
      ['src/extra.jsx', 'added'],
      ['src/styles.css', 'modified'],
    ])
    const before = getDraft(project.id)
    enqueueTask(project.id, 'restore', before.revision, v2.id, v1.id)
    await runTask(claimTask()!, runtime)
    const v3 = getVersion(
      project.id,
      getProject(project.id).project.currentVersionId!,
    )
    expect(v3.number).toBe(3)
    expect(v3.parentVersionId).toBe(v2.id)
    expect(v3.restoredFromVersionId).toBe(v1.id)
    expect(v3.files).toEqual(v1.files)
    expect(v3.artifactId).toBe(v1.artifactId)
    expect(
      getDraft(project.id).files.some((f) => f.path === 'src/extra.jsx'),
    ).toBe(false)
    edit(project.id)
    const task = queueCommit(project.id)
    expect(task.baseVersionId).toBe(v3.id)
    expect(task.candidateFiles.some((f) => f.path === 'src/extra.jsx')).toBe(
      false,
    )
    await runTask(task, runtime)
    expect(getProject(project.id).versions.map((v) => v.number)).toEqual([
      4, 3, 2, 1,
    ])
    expect(
      previewAsset(v2.artifactId, 'index.html').body.length,
    ).toBeGreaterThan(0)
  })
  it('keeps failed source as a persisted draft, preserves the current version and preview', async () => {
    const { project, runtime, version } = await initialize()
    edit(project.id, 'broken syntax')
    vi.mocked(runtime.execute).mockResolvedValueOnce({
      exitCode: 1,
      output: 'syntax error',
      timedOut: false,
    })
    const task = queueCommit(project.id)
    await runTask(task, runtime)
    expect(getTask(task.id).status).toBe('failed')
    expect(getProject(project.id).project.currentVersionId).toBe(version.id)
    expect(
      getDraft(project.id).files.find((f) => f.path === 'src/App.jsx')?.content,
    ).toBe('broken syntax')
    expect(
      previewAsset(version.artifactId, 'index.html').body.length,
    ).toBeGreaterThan(0)
    expect(getProject(project.id).versions).toHaveLength(1)
  })
  it('backs up saved drafts on restore and can recover them without changing the current version', async () => {
    const { project, runtime, version: v1 } = await initialize()
    edit(project.id)
    await runTask(queueCommit(project.id), runtime)
    const v2 = getProject(project.id).project.currentVersionId!
    edit(project.id, 'unsuccessful saved work')
    const draft = getDraft(project.id)
    enqueueTask(project.id, 'restore', draft.revision, v2, v1.id)
    await runTask(claimTask()!, runtime)
    const current = getProject(project.id).project.currentVersionId
    const backup = draftBackups(project.id)[0] as { id: string }
    expect(backup).toBeTruthy()
    const recovered = recoverDraftBackup(
      project.id,
      backup.id,
      getDraft(project.id).revision,
    )
    expect(recovered.files).toEqual(draft.files)
    expect(getProject(project.id).project.currentVersionId).toBe(current)
  })
  it('cancels a running build and rejects its late result, while a queued successor stays intact', async () => {
    const { project, runtime, version } = await initialize()
    edit(project.id)
    const task = queueCommit(project.id)
    vi.mocked(runtime.execute).mockImplementationOnce(async () => {
      cancelTask(task.id)
      enqueueTask(
        project.id,
        'commit',
        getDraft(project.id).revision,
        version.id,
      )
      return { exitCode: 0, output: 'late', timedOut: false }
    })
    await runTask(task, runtime)
    expect(getTask(task.id).status).toBe('cancelled')
    expect(getProject(project.id).versions).toHaveLength(1)
    expect(runtime.stop).toHaveBeenCalled()
    const successor = claimTask()!
    await runTask(successor, runtime)
    expect(getTask(successor.id).status).toBe('completed')
    expect(getProject(project.id).versions).toHaveLength(2)
  })
  it('uses one operation lock across draft saves, restores and environment changes', async () => {
    const { project, version } = await initialize()
    edit(project.id)
    const task = queueCommit(project.id)
    expect(() =>
      updateDraft(project.id, getDraft(project.id).revision, []),
    ).toThrow('已有')
    expect(() =>
      enqueueTask(
        project.id,
        'stop',
        getDraft(project.id).revision,
        version.id,
      ),
    ).toThrow('已有')
    expect(() =>
      enqueueTask(
        project.id,
        'restore',
        getDraft(project.id).revision,
        version.id,
        version.id,
      ),
    ).toThrow('已有')
    cancelTask(task.id)
    expect(() =>
      updateDraft(project.id, 0, [
        { type: 'write', path: 'src/test.txt', content: 'stale' },
      ]),
    ).toThrow('已更新')
  })
  it('replays interrupted work with a new attempt, and commits one version only', async () => {
    const project = newProject()
    expect(acquireWorker('first')).toBe(true)
    enqueueTask(project.id, 'initialize', 0, null)
    const old = claimTask('first')!
    releaseWorker('first')
    expect(acquireWorker('second')).toBe(true)
    const next = claimTask('second')!
    expect(next.attemptId).not.toBe(old.attemptId)
    expect(
      completeBuild(old, 'fixed', randomUUID(), asset(), 'first'),
    ).toBeNull()
    await runTask(next, fakeRuntime(), undefined, 'second')
    expect(getProject(project.id).versions).toHaveLength(1)
    expect(
      completeBuild(next, 'fixed', randomUUID(), asset(), 'second'),
    ).toBeNull()
    expect(heartbeat('first')).toBe(false)
  })
  it('rejects a changed baseline even when a running task returns valid artifacts', async () => {
    const { project, version } = await initialize()
    edit(project.id)
    const task = queueCommit(project.id)
    db()
      .prepare(
        'UPDATE workspace_drafts SET revision=revision+1 WHERE projectId=?',
      )
      .run(project.id)
    expect(() => completeBuild(task, 'fixed', randomUUID(), asset())).toThrow(
      '基线',
    )
    expect(getProject(project.id).project.currentVersionId).toBe(version.id)
  })
  it('supports atomic rename/delete and compares actual file contents', async () => {
    const project = newProject()
    const first = getDraft(project.id)
    const next = updateDraft(project.id, first.revision, [
      { type: 'write', path: 'src/a.jsx', content: 'A' },
      { type: 'rename', path: 'src/a.jsx', to: 'src/b.jsx' },
    ])
    expect(next.files.some((f) => f.path === 'src/b.jsx')).toBe(true)
    expect(() =>
      updateDraft(project.id, next.revision, [
        { type: 'delete', path: 'src/b.jsx' },
        { type: 'delete', path: 'src/main.jsx' },
      ]),
    ).toThrow('固定入口')
    expect(getDraft(project.id).files.some((f) => f.path === 'src/b.jsx')).toBe(
      true,
    )
    expect(snapshot([...files].reverse()).hash).toBe(snapshot(files).hash)
    expect(() =>
      snapshot([...files, { path: 'src/App.jsx/child.js', content: '' }]),
    ).toThrow('冲突')
    const changes = diffFiles(
      [{ path: 'src/a.txt', content: 'same\nbefore\nend' }],
      [{ path: 'src/a.txt', content: 'same\nafter\nend' }],
    )
    expect(changes[0].lines).toContainEqual({ type: 'removed', text: 'before' })
    expect(changes[0].lines).toContainEqual({ type: 'added', text: 'after' })
  })
  it('keeps immutable preview readable after stop/remove and read-only version browsing', async () => {
    const { project, runtime, version } = await initialize()
    enqueueTask(project.id, 'remove', getDraft(project.id).revision, version.id)
    await runTask(claimTask()!, runtime)
    expect(getProject(project.id).runtime?.state).toBe('absent')
    getVersion(project.id, version.id)
    expect(getProject(project.id).project.currentVersionId).toBe(version.id)
    const response = await previewGET(new Request('http://localhost/api'), {
      params: { artifactId: version.artifactId, path: ['index.html'] },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toContain(
      'sandbox allow-scripts',
    )
    expect(await response.text()).toContain('src/App.jsx')
  })
})

describe('boundaries and APIs', () => {
  it('does not return snapshot bodies from polling and validates cross-project references', async () => {
    const { project, version } = await initialize(),
      other = newProject()
    const response = await projectGET(new Request('http://localhost'), {
      params: { id: project.id },
    })
    const json = await response.json()
    expect(json.draft.files).toBeUndefined()
    expect(json.versions[0].files).toBeUndefined()
    expect(json.tasks[0].candidateFiles).toBeUndefined()
    expect(() => getVersion(other.id, version.id)).toThrow('版本不存在')
    const read = await filesGET(
      new Request(`http://localhost?versionId=${version.id}`),
      { params: { id: other.id } },
    )
    expect(read.status).toBe(404)
  })
  it('returns 409 for stale saves, queues commits/restores and rejects bad paths', async () => {
    const project = newProject()
    acquireWorker('test')
    const req = (body: unknown) =>
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const invalid = await filesPATCH(
      req({
        expectedRevision: 0,
        operations: [{ type: 'write', path: '../secret', content: 'bad' }],
      }),
      { params: { id: project.id } },
    )
    expect(invalid.status).toBe(400)
    const stale = await filesPATCH(
      req({
        expectedRevision: 99,
        operations: [{ type: 'write', path: 'src/new.txt', content: 'bad' }],
      }),
      { params: { id: project.id } },
    )
    expect(stale.status).toBe(409)
    const response = await commitPOST(
      req({ expectedRevision: 0, expectedVersionId: null }),
      { params: { id: project.id } },
    )
    expect(response.status).toBe(202)
    const task = claimTask()!
    await runTask(task, fakeRuntime())
    const v1 = getProject(project.id).project.currentVersionId!
    edit(project.id)
    await runTask(queueCommit(project.id), fakeRuntime())
    const detail = getProject(project.id)
    const restore = await restorePOST(
      req({
        expectedRevision: detail.draft.revision,
        expectedVersionId: detail.project.currentVersionId,
        versionId: v1,
      }),
      { params: { id: project.id } },
    )
    expect(restore.status).toBe(202)
  })
  it('rejects artifact traversal, duplicates, oversize resources and forged reuse', () => {
    for (const invalid of [
      [{ ...asset()[0], path: '../outside' }],
      [...asset(), ...asset()],
      [{ ...asset()[0], body: '?not base64' }],
    ])
      expect(() => validateAssets(invalid)).toThrow()
    expect(() =>
      validateAssets([
        {
          ...asset()[0],
          body: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'),
        },
      ]),
    ).toThrow('限制')
    expect(
      validateAssets([
        {
          ...asset()[0],
          body: Buffer.alloc(2 * 1024 * 1024).toString('base64'),
        },
      ]).bytes,
    ).toBe(2 * 1024 * 1024)
    const project = newProject()
    enqueueTask(project.id, 'initialize', 0, null)
    const task = claimTask()!
    expect(() => completeBuild(task, 'fixed', randomUUID())).toThrow('不存在')
    expect(artifactFor(project.id, 'anything', 'fixed')).toBeUndefined()
  })
})

describe('preview gateway and cache rebuilds', () => {
  it('rebuilds a version preview without changing source history or the current pointer', async () => {
    const { project, runtime, version } = await initialize()
    const draft = getDraft(project.id)
    enqueueTask(project.id, 'preview', draft.revision, version.id, version.id)
    await runTask(claimTask()!, runtime)
    const after = getVersion(project.id, version.id)
    expect(after.artifactId).not.toBe(version.artifactId)
    expect(after.files).toEqual(version.files)
    expect(getProject(project.id).project.currentVersionId).toBe(version.id)
    expect(getProject(project.id).versions).toHaveLength(1)
    expect(getDraft(project.id).revision).toBe(draft.revision)
  })
  it('restores the exact stored template and artifact even if Docker is unavailable', async () => {
    const { project, runtime, version: v1 } = await initialize()
    edit(project.id)
    await runTask(queueCommit(project.id), runtime)
    vi.mocked(runtime.templateId).mockRejectedValue(
      new Error('Docker unavailable'),
    )
    enqueueTask(
      project.id,
      'restore',
      getDraft(project.id).revision,
      getProject(project.id).project.currentVersionId,
      v1.id,
    )
    const task = claimTask()!
    await runTask(task, runtime)
    expect(getTask(task.id).status).toBe('completed')
    expect(getProject(project.id).versions[0].artifactId).toBe(v1.artifactId)
  })
})

describe('operation timeout and storage limits', () => {
  it('finishes a timed-out lifecycle operation as failed rather than leaving it running', async () => {
    const { project, runtime, version } = await initialize()
    enqueueTask(project.id, 'stop', getDraft(project.id).revision, version.id)
    const task = claimTask()!
    vi.useFakeTimers()
    try {
      vi.mocked(runtime.stop).mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150001))
      })
      const running = runTask(task, runtime)
      await vi.advanceTimersByTimeAsync(150001)
      await running
      expect(getTask(task.id).status).toBe('failed')
      expect(getTask(task.id).error).toContain('超时')
      expect(getProject(project.id).project.currentVersionId).toBe(version.id)
    } finally {
      vi.useRealTimers()
    }
  })
  it('rejects over-budget writes without changing the saved draft', async () => {
    const { project } = await initialize()
    const draft = getDraft(project.id)
    db()
      .prepare('UPDATE preview_artifacts SET bytes=? WHERE projectId=?')
      .run(128 * 1024 * 1024, project.id)
    expect(() => edit(project.id)).toThrow('128 MiB')
    expect(getDraft(project.id)).toEqual(draft)
  })
})

// Exercise the real task/attempt/transaction pipeline with deterministic model turns.
import type { ModelProvider, ModelTurn } from '../src/lib/ai/provider'
import type { AgentInput, ToolCall } from '../src/lib/ai/tools'
import { POST as agentPOST } from '../src/app/api/projects/[id]/tasks/route'
import { checkpointAgent } from '../src/lib/store'
const call = (name: string, args: unknown = {}): ToolCall => ({
  id: randomUUID(),
  name,
  arguments: args,
})
const turn = (calls: ToolCall[] = [], text = ''): ModelTurn => ({
  calls,
  text,
  usage: { inputTokens: 10, outputTokens: 20 },
  responseBytes: 100,
})
function scripted(...turns: ModelTurn[]) {
  const next = vi.fn(async (_inputs: AgentInput[], _budget: number) => {
    const value =
      turns.shift() ||
      (_inputs.some(
        (input) =>
          input.type === 'user' && input.text.includes('请调用 browser_test'),
      )
        ? turn([
            call('browser_test', {
              steps: [
                { action: 'assert_visible', selector: '#root', value: '' },
              ],
            }),
          ])
        : _inputs.some(
              (input) => input.type === 'tool' && input.name === 'browser_test',
            )
          ? turn([], '完成')
          : undefined)
    if (!value) throw new Error('Unexpected extra model step')
    return value
  })
  const provider: ModelProvider = { createSession: vi.fn(() => ({ next })) }
  return { provider, next }
}
function queueAgent(projectId: string, prompt = '创建待办应用') {
  const detail = getProject(projectId)
  enqueueTask(
    projectId,
    'agent',
    detail.draft.revision,
    detail.project.currentVersionId,
    undefined,
    undefined,
    {
      provider: 'gemini',
      model: 'test-model',
      prompt,
      steps: 0,
      toolCalls: 0,
      buildFailures: 0,
      responseBytes: 0,
      reservedOutputTokens: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      startedAt: null,
    },
  )
  return claimTask()!
}
async function agentRun(
  task: Task,
  runtime: ProjectRuntime,
  provider: ModelProvider,
) {
  await runTask(task, runtime, undefined, undefined, provider)
  return getTask(task.id)
}
describe('conversation-first creation', () => {
  const request = (body: unknown) =>
    new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  it('starts generation from the first message and saves the first result as AI v1', async () => {
    acquireWorker('test')
    vi.stubEnv('GEMINI_API_KEY', 'fake')
    const prompt = '创建一个待办应用，支持分类筛选\n并可以标记完成'
    try {
      const response = await projectPOST(
        request({ prompt, provider: 'gemini' }),
      )
      expect(response.status).toBe(201)
      const project = await response.json()
      expect(project.name).toBe(prompt.replace(/\s+/g, ' ').slice(0, 28))
      const detail = getProject(project.id)
      expect(detail.versions).toHaveLength(0)
      expect(detail.tasks).toHaveLength(1)
      expect(detail.tasks[0]).toMatchObject({
        kind: 'agent',
        status: 'queued',
        baseVersionId: null,
        agent: { prompt },
      })
      expect(getDraft(project.id).files).toEqual(snapshot(files).files)
      const model = scripted(
        turn([
          call('write_file', {
            path: 'src/App.jsx',
            content: 'export default () => <h1>待办应用</h1>',
          }),
        ]),
        turn([
          call('browser_test', {
            steps: [{ action: 'assert_visible', selector: '#root', value: '' }],
          }),
        ]),
        turn([], '已创建待办应用，可以在预览中使用。'),
      )
      const task = await agentRun(claimTask()!, fakeRuntime(), model.provider)
      expect(task.status).toBe('completed')
      expect(task.events).toContainEqual(
        expect.objectContaining({
          type: 'reply',
          message: '已创建待办应用，可以在预览中使用。',
        }),
      )
      expect(getProject(project.id).versions).toMatchObject([
        { number: 1, source: 'agent' },
      ])
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('does not create projects for unavailable services or invalid input', async () => {
    expect(
      (await projectPOST(request({ prompt: '创建应用', provider: 'gemini' })))
        .status,
    ).toBe(503)
    acquireWorker('test')
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('VERTEX_AI_API_KEY', '')
    try {
      expect(
        (await projectPOST(request({ prompt: '创建应用', provider: 'gemini' })))
          .status,
      ).toBe(400)
      vi.stubEnv('GEMINI_API_KEY', 'fake')
      for (const body of [
        { prompt: ' ', provider: 'gemini' },
        { prompt: 'x'.repeat(8001), provider: 'gemini' },
        { prompt: '创建应用', provider: 'unknown' },
        { prompt: '创建应用', provider: 'gemini', name: '混合请求' },
      ]) {
        expect((await projectPOST(request(body))).status).toBe(400)
      }
      expect(listProjects()).toHaveLength(0)
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('rolls back the project and draft when first-task insertion fails', async () => {
    acquireWorker('test')
    vi.stubEnv('GEMINI_API_KEY', 'fake')
    db().exec(
      "CREATE TRIGGER reject_first_task BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    )
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(
        (await projectPOST(request({ prompt: '创建应用', provider: 'gemini' })))
          .status,
      ).toBe(500)
      expect(listProjects()).toHaveLength(0)
      expect(db().prepare('SELECT * FROM workspace_drafts').all()).toHaveLength(
        0,
      )
    } finally {
      db().exec('DROP TRIGGER reject_first_task')
      vi.unstubAllEnvs()
      log.mockRestore()
    }
  })
  it('keeps blank creation available offline and allows renaming without changing source or tasks', async () => {
    const response = await projectPOST(request({ name: '未命名项目' }))
    expect(response.status).toBe(201)
    const project = await response.json()
    const before = getProject(project.id)
    expect(before.tasks).toHaveLength(0)
    expect(
      (
        await projectPATCH(request({ name: '我的应用' }), {
          params: { id: project.id },
        })
      ).status,
    ).toBe(200)
    const after = getProject(project.id)
    expect(after.project.name).toBe('我的应用')
    expect(after.draft).toEqual(before.draft)
    expect(after.tasks).toEqual(before.tasks)
    expect(
      (
        await projectPATCH(request({ name: ' ' }), {
          params: { id: project.id },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await projectPATCH(request({ name: '不存在' }), {
          params: { id: randomUUID() },
        })
      ).status,
    ).toBe(404)
    acquireWorker('test')
    const online = await projectPOST(request({ name: '空白模板' }))
    expect(getProject((await online.json()).id).tasks).toMatchObject([
      { kind: 'initialize' },
    ])
  })
})

describe('coding agent workspace loop', () => {
  it('requires new behavior tests after editing an already tested candidate', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const model = scripted(
      turn([
        call('browser_test', {
          steps: [{ action: 'assert_visible', selector: '#root', value: '' }],
        }),
      ]),
      turn([
        call('write_file', {
          path: 'src/App.jsx',
          content: 'export default () => <h1>后续修改</h1>',
        }),
      ]),
      turn([], '完成'),
    )
    const task = queueAgent(project.id)
    expect((await agentRun(task, runtime, model.provider)).status).toBe(
      'completed',
    )
    expect(verifyBrowser).toHaveBeenCalledTimes(4) // smoke + behavior for each source hash
    expect(runtime.execute).toHaveBeenCalledTimes(2)
    expect(model.next.mock.calls[3][0][0]).toHaveProperty(
      'text',
      expect.stringContaining('请调用 browser_test'),
    )
  })
  it('fails explicitly when the browser environment is unavailable without committing', async () => {
    const { project, runtime, version } = await initialize()
    vi.mocked(verifyBrowser).mockRejectedValueOnce(
      new Error('浏览器验证环境不可用'),
    )
    const model = scripted(turn([call('build')]))
    const result = await agentRun(
      queueAgent(project.id),
      runtime,
      model.provider,
    )
    expect(result.status).toBe('failed')
    expect(result.error).toContain('浏览器验证环境不可用')
    expect(getProject(project.id).project.currentVersionId).toBe(version.id)
    expect(model.next).toHaveBeenCalledTimes(1)
  })
  it('feeds runtime errors back for repair before saving a version', async () => {
    const { project, runtime, version } = await initialize()
    vi.mocked(verifyBrowser).mockResolvedValueOnce({
      ok: false,
      output: '页面异常：undefined is not a function',
      completedSteps: 0,
    })
    const model = scripted(
      turn([call('build')]),
      turn([
        call('write_file', {
          path: 'src/App.jsx',
          content: 'export default () => <h1>修复运行错误</h1>',
        }),
      ]),
      turn([], '完成'),
    )
    const task = queueAgent(project.id)
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('completed')
    expect(model.next.mock.calls[1][0][0]).toHaveProperty(
      'output',
      expect.stringContaining('undefined is not a function'),
    )
    expect(result.agent?.validationFailures).toBe(1)
    expect(result.agent?.buildFailures).toBe(0)
    expect(
      getVersion(project.id, result.resultVersionId!).parentVersionId,
    ).toBe(version.id)
    expect(result.events.some((event) => event.type === 'validation')).toBe(
      true,
    )
  })
  it('repairs failed interactions and repeats tests after source edits', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    vi.mocked(verifyBrowser)
      .mockResolvedValueOnce({
        ok: true,
        output: '加载通过',
        completedSteps: 0,
      })
      .mockResolvedValueOnce({
        ok: false,
        output: '断言失败：新增待办后数量仍是 0',
        completedSteps: 2,
      })
    const test = () =>
      call('browser_test', {
        steps: [{ action: 'assert_count', selector: 'li', value: '1' }],
      })
    const model = scripted(
      turn([test()]),
      turn([
        call('write_file', {
          path: 'src/App.jsx',
          content: 'export default () => <ul><li>修复</li></ul>',
        }),
        test(),
      ]),
      turn([], '完成'),
    )
    const task = queueAgent(project.id)
    expect((await agentRun(task, runtime, model.provider)).status).toBe(
      'completed',
    )
    expect(model.next.mock.calls[1][0][0]).toHaveProperty(
      'output',
      expect.stringContaining('数量仍是 0'),
    )
    expect(verifyBrowser).toHaveBeenCalledTimes(4)
  })
  it('exhausts a durable browser failure budget without replacing the prior preview', async () => {
    const { project, runtime, version } = await initialize()
    vi.mocked(verifyBrowser).mockResolvedValue({
      ok: false,
      output: '页面异常',
      completedSteps: 0,
    })
    const task = queueAgent(project.id)
    task.agent!.validationFailures = 1
    checkpointAgent(task)
    const model = scripted(turn([call('build')]), turn([call('build')]))
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('failed')
    expect(result.agent?.validationFailures).toBe(3)
    expect(result.error).toContain('浏览器验证已达到三次失败')
    expect(getProject(project.id).project.currentVersionId).toBe(version.id)
    expect(
      previewAsset(version.artifactId, 'index.html').body.length,
    ).toBeGreaterThan(0)
  })
  it('rejects a late browser pass after cancellation', async () => {
    const { project, runtime, version } = await initialize()
    const task = queueAgent(project.id)
    vi.mocked(verifyBrowser).mockImplementationOnce(async () => {
      cancelTask(task.id)
      return { ok: true, output: '迟到通过', completedSteps: 0 }
    })
    const model = scripted(turn([call('build')]))
    expect((await agentRun(task, runtime, model.provider)).status).toBe(
      'cancelled',
    )
    expect(getProject(project.id).project.currentVersionId).toBe(version.id)
    expect(getProject(project.id).versions).toHaveLength(1)
  })
  it('creates todo, then adds filtering while preserving prior source and immutable previews', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const source =
      'export default function App(){ return <main><h1>待办应用</h1><input aria-label="新待办"/><button>添加</button></main> }'
    const first = scripted(
      turn([
        call('list_files'),
        call('read_file', { path: 'src/App.jsx', startLine: 1, endLine: 100 }),
      ]),
      turn([
        call('write_file', { path: 'src/App.jsx', content: source }),
        call('build'),
      ]),
      turn([], '创建完成'),
    )
    const t1 = queueAgent(project.id)
    expect((await agentRun(t1, runtime, first.provider)).status).toBe(
      'completed',
    )
    expect(first.next.mock.calls[1][0][1]).toHaveProperty(
      'output',
      expect.stringContaining('App'),
    )
    expect(runtime.execute).toHaveBeenCalledTimes(1)
    const v1 = getVersion(
      project.id,
      getProject(project.id).project.currentVersionId!,
    )
    expect(v1.source).toBe('agent')
    const second = scripted(
      turn([
        call('read_file', { path: 'src/App.jsx', startLine: 1, endLine: 100 }),
        call('search_files', { query: '待办' }),
      ]),
      turn([
        call('edit_file', {
          path: 'src/App.jsx',
          oldText: '<h1>待办应用</h1>',
          newText:
            '<h1>待办应用</h1><select aria-label="分类筛选"><option>全部</option></select>',
        }),
      ]),
      turn([], '分类筛选完成'),
    )
    const t2 = queueAgent(project.id, '增加分类筛选')
    expect((await agentRun(t2, runtime, second.provider)).status).toBe(
      'completed',
    )
    const v2 = getVersion(
      project.id,
      getProject(project.id).project.currentVersionId!,
    )
    expect(v2.parentVersionId).toBe(v1.id)
    const app = v2.files.find((f) => f.path === 'src/App.jsx')!.content
    expect(app).toContain('分类筛选')
    expect(app).toContain('新待办')
    expect(getVersion(project.id, v1.id).files).toEqual(v1.files)
    expect(
      previewAsset(v1.artifactId, 'index.html').body.length,
    ).toBeGreaterThan(0)
    expect(getTask(t2.id).agent?.steps).toBe(5)
  })
  it('feeds build errors back, repairs and rebuilds after subsequent edits', async () => {
    const { project, runtime } = await initialize()
    vi.mocked(runtime.execute).mockResolvedValueOnce({
      exitCode: 1,
      output: 'App.jsx: Unexpected token',
      timedOut: false,
    })
    const model = scripted(
      turn([
        call('write_file', { path: 'src/App.jsx', content: 'broken' }),
        call('build'),
      ]),
      turn([
        call('read_errors'),
        call('write_file', {
          path: 'src/App.jsx',
          content: 'export default () => <h1>修复</h1>',
        }),
        call('build'),
      ]),
      turn([
        call('edit_file', {
          path: 'src/App.jsx',
          oldText: '修复',
          newText: '完成',
        }),
      ]),
      turn([], '已完成'),
    )
    const task = queueAgent(project.id)
    expect((await agentRun(task, runtime, model.provider)).status).toBe(
      'completed',
    )
    expect(model.next.mock.calls[1][0][1]).toHaveProperty(
      'output',
      expect.stringContaining('Unexpected token'),
    )
    expect(model.next.mock.calls[2][0][0]).toHaveProperty(
      'output',
      expect.stringContaining('Unexpected token'),
    )
    expect(runtime.execute).toHaveBeenCalledTimes(4) // initial + failure + repaired + final edit
    expect(getTask(task.id).agent?.buildFailures).toBe(1)
  })
  it('automatically builds final text and returns automatic build failures for repair', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    vi.mocked(runtime.execute).mockResolvedValueOnce({
      exitCode: 1,
      output: 'syntax error',
      timedOut: false,
    })
    const model = scripted(
      turn([], '完成'),
      turn([
        call('write_file', {
          path: 'src/App.jsx',
          content: 'export default () => <h1>Todo</h1>',
        }),
      ]),
      turn([], '完成'),
    )
    const task = queueAgent(project.id)
    expect((await agentRun(task, runtime, model.provider)).status).toBe(
      'completed',
    )
    expect(model.next.mock.calls[1][0][0]).toMatchObject({ type: 'user' })
    expect(model.next.mock.calls[1][0][0]).toHaveProperty(
      'text',
      expect.stringContaining('syntax error'),
    )
  })
  it('rejects paths, ambiguous edits and arbitrary commands without mutating the candidate', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    const model = scripted(
      turn([
        call('write_file', { path: '../secret', content: 'bad' }),
        call('delete_file', { path: 'src/main.jsx' }),
        call('execute', { command: 'env' }),
        call('edit_file', {
          path: 'src/App.jsx',
          oldText: 'not-present',
          newText: 'bad',
        }),
      ]),
      turn([], '完成'),
    )
    expect((await agentRun(task, runtime, model.provider)).status).toBe(
      'completed',
    )
    expect(
      model.next.mock.calls[1][0].every(
        (input) => input.type === 'tool' && input.output.includes('error'),
      ),
    ).toBe(true)
    expect(getDraft(project.id).files).toEqual(snapshot(files).files)
  })
  it('stops after three build failures and preserves original draft/version plus failed candidate', async () => {
    const { project, runtime, version } = await initialize()
    const original = getDraft(project.id)
    vi.mocked(runtime.execute).mockResolvedValue({
      exitCode: 1,
      output: 'bad JSX',
      timedOut: false,
    })
    const model = scripted(
      turn([
        call('write_file', { path: 'src/App.jsx', content: 'broken' }),
        call('build'),
      ]),
      turn([call('build')]),
      turn([
        call('build'),
        call('write_file', { path: 'src/late.js', content: '' }),
      ]),
    )
    const task = queueAgent(project.id)
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('三次失败')
    expect(
      result.candidateFiles.find((f) => f.path === 'src/App.jsx')?.content,
    ).toBe('broken')
    expect(result.candidateFiles.some((f) => f.path === 'src/late.js')).toBe(
      false,
    )
    expect(getDraft(project.id)).toEqual(original)
    expect(getProject(project.id).project.currentVersionId).toBe(version.id)
  })
  it('cancels during model I/O and rejects late writes/builds', async () => {
    const { project, runtime, version } = await initialize()
    const task = queueAgent(project.id)
    const provider: ModelProvider = {
      createSession: () => ({
        next: async () => {
          cancelTask(task.id)
          return turn([
            call('write_file', { path: 'src/App.jsx', content: 'late' }),
            call('build'),
          ])
        },
      }),
    }
    expect((await agentRun(task, runtime, provider)).status).toBe('cancelled')
    expect(runtime.execute).toHaveBeenCalledTimes(1)
    expect(getProject(project.id).project.currentVersionId).toBe(version.id)
  })
  it('enforces step, output and tool budgets without committing unverified changes', async () => {
    for (const field of [
      'steps',
      'toolCalls',
      'outputTokens',
      'responseBytes',
    ] as const) {
      const project = newProject(),
        runtime = fakeRuntime()
      const task = queueAgent(project.id)
      if (field === 'outputTokens') task.agent!.usage.outputTokens = 48000
      else
        task.agent![field] =
          field === 'steps' ? 24 : field === 'toolCalls' ? 80 : 1024 * 1024
      checkpointAgent(task)
      const model = scripted(
        turn([call('write_file', { path: 'src/App.jsx', content: 'late' })]),
      )
      const result = await agentRun(task, runtime, model.provider)
      expect(result.status).toBe('failed')
      expect(getProject(project.id).versions).toHaveLength(0)
      expect(runtime.execute).not.toHaveBeenCalled()
    }
  })
  it('restarts from candidate checkpoint with counters intact and fences the old attempt', async () => {
    const project = newProject()
    acquireWorker('first')
    const old = queueAgent(project.id)
    old.candidateFiles = old.candidateFiles.map((f) =>
      f.path === 'src/App.jsx'
        ? { ...f, content: 'export default () => <h1>checkpoint</h1>' }
        : f,
    )
    old.agent!.steps = 4
    old.agent!.buildFailures = 1
    checkpointAgent(old, 'first')
    releaseWorker('first')
    acquireWorker('second')
    const next = claimTask('second')!
    expect(next.candidateFiles).toEqual(old.candidateFiles)
    expect(next.agent?.buildFailures).toBe(1)
    expect(() => checkpointAgent(old, 'first')).toThrow('中断')
    const model = scripted(turn([], '完成'))
    await runTask(next, fakeRuntime(), undefined, 'second', model.provider)
    expect(getTask(next.id).status).toBe('completed')
    expect(getTask(next.id).agent?.steps).toBe(7)
    expect(getProject(project.id).versions).toHaveLength(1)
  })
  it('enforces total duration and never starts model work for an expired attempt', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    task.agent!.startedAt = Date.now() - 300001
    checkpointAgent(task)
    const model = scripted()
    expect((await agentRun(task, runtime, model.provider)).status).toBe(
      'failed',
    )
    expect(model.next).not.toHaveBeenCalled()
  })
  it('validates model configuration and baseline at the API boundary', async () => {
    const project = newProject()
    acquireWorker('test')
    const req = (body: unknown) =>
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const input = {
      prompt: '创建待办应用',
      provider: 'gemini',
      expectedRevision: 0,
      expectedVersionId: null,
    }
    try {
      vi.stubEnv('GEMINI_API_KEY', '')
      vi.stubEnv('VERTEX_AI_API_KEY', '')
      expect(
        (await agentPOST(req(input), { params: { id: project.id } })).status,
      ).toBe(400)
      vi.stubEnv('GEMINI_API_KEY', 'fake')
      expect(
        (
          await agentPOST(req({ ...input, expectedRevision: 3 }), {
            params: { id: project.id },
          })
        ).status,
      ).toBe(409)
      expect(
        (
          await agentPOST(req({ ...input, prompt: '' }), {
            params: { id: project.id },
          })
        ).status,
      ).toBe(400)
      const response = await agentPOST(req(input), {
        params: { id: project.id },
      })
      expect(response.status).toBe(202)
      const task = await response.json()
      expect(task.candidateFiles).toBeUndefined()
      expect(task.agent.prompt).toBe(input.prompt)
      expect(task.agent.model).toBeTruthy()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('agent candidate recovery and in-flight budget', () => {
  it('exposes failed candidate on demand without changing the draft and rejects active reads', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    const request = new Request('http://localhost/api?candidate=1')
    expect((await taskGET(request, { params: { id: task.id } })).status).toBe(
      409,
    )
    const model = scripted(
      turn([call('write_file', { path: 'src/App.jsx', content: 'broken' })]),
    )
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('failed')
    const response = await taskGET(request, { params: { id: task.id } })
    expect(
      (await response.json()).files.find(
        (f: SourceFile) => f.path === 'src/App.jsx',
      ).content,
    ).toBe('broken')
    expect(getDraft(project.id).files).toEqual(snapshot(files).files)
  })
  it('preserves output allocation when an in-flight request is interrupted', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    const provider: ModelProvider = {
      createSession: () => ({
        next: async () => {
          throw new Error('network unavailable')
        },
      }),
    }
    await agentRun(task, runtime, provider)
    expect(getTask(task.id).agent?.reservedOutputTokens).toBe(24000)
    expect(getTask(task.id).agent?.usage.outputTokens).toBe(0)
  })
})

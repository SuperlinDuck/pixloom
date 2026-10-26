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
  addEvent,
  agentConversation,
  artifactFor,
  cancelTask,
  claimTask,
  completeBuild,
  createProject,
  db,
  draftBackups,
  enqueueTask,
  finishTask,
  getDraft,
  listProjects,
  getProject,
  getTask,
  getVersion,
  heartbeat,
  previewAsset,
  recoverDraftBackup,
  releaseWorker,
  retryAgentTask,
  setRuntime,
  stageCandidatePreview,
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
import { POST as retryPOST } from '../src/app/api/tasks/[id]/retry/route'
import { checkpointAgent } from '../src/lib/store'
import { codingAgentPrompt } from '../src/lib/ai/context'
import { AGENT_LIMITS } from '../src/lib/ai/agent'
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
    const value = turns.shift()
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
      model: 'gemini-3.8-flash',
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
describe('retrying an agent reply in place', () => {
  const request = (body: unknown) =>
    new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('reuses the original turn, resets exhausted execution state, and completes with a fresh attempt', async () => {
    const project = newProject()
    const original = queueAgent(project.id, '创建番茄钟')
    original.agent!.steps = AGENT_LIMITS.steps
    original.agent!.startedAt = Date.now() - AGENT_LIMITS.durationMs - 1
    original.agent!.reservedOutputTokens = 999999
    original.agent!.contextSummary = '过时的候选进展'
    original.candidateFiles = original.candidateFiles.map((file) =>
      file.path === 'src/App.jsx'
        ? { ...file, content: 'export default () => <h1>失败的候选版本</h1>' }
        : file,
    )
    checkpointAgent(original)
    addEvent(original, '旧执行失败')
    finishTask(original, '预算不足')
    // Later messages stay in their existing positions when an older reply retries.
    const later = queueAgent(project.id, '后续修改')
    finishTask(later, '后续任务失败')
    const draft = edit(project.id)
    acquireWorker('test')
    vi.stubEnv('GEMINI_API_KEY', 'fake')
    try {
      const response = await retryPOST(
        request({
          provider: 'gemini',
          expectedRevision: draft.revision,
          expectedVersionId: null,
        }),
        { params: { id: original.id } },
      )
      expect(response.status).toBe(202)
      expect(await response.json()).toMatchObject({
        id: original.id,
        createdAt: original.createdAt,
        status: 'queued',
        attemptId: null,
        events: [],
        error: null,
        agent: {
          prompt: '创建番茄钟',
          steps: 0,
          startedAt: null,
          reservedOutputTokens: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      })
      expect(getTask(original.id).agent?.contextSummary).toBeUndefined()
      expect(getTask(original.id).candidateFiles).toEqual(draft.files)
      expect(getProject(project.id).tasks.map((task) => task.id)).toEqual([
        later.id,
        original.id,
      ])
      expect(agentConversation(original)).toEqual([])
      const retried = claimTask()!
      expect(retried.id).toBe(original.id)
      expect(retried.attemptId).not.toBe(original.attemptId)
      expect(() => checkpointAgent(original)).toThrow('操作已中断')
      expect(finishTask(original, '迟到的失败')).toBe(false)
      const result = await agentRun(
        retried,
        fakeRuntime(),
        scripted(turn([], '番茄钟已完成')).provider,
      )
      expect(result.status).toBe('completed')
      expect(getProject(project.id).tasks).toHaveLength(2)
      expect(getProject(project.id).versions).toMatchObject([
        { taskId: original.id, number: 1 },
      ])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('rejects stale baselines, active projects, and duplicate retries without changing the failed reply', () => {
    const { id } = newProject()
    const original = queueAgent(id)
    finishTask(original, '失败')
    const failed = getTask(original.id)
    const retry = (revision = 0, version: string | null = null) =>
      retryAgentTask(original.id, revision, version, original.agent!)
    expect(() => retry(1)).toThrow('草稿已更新')
    expect(() => retry(0, randomUUID())).toThrow('当前版本已变化')
    const active = queueAgent(id)
    expect(() => retry()).toThrow('正在执行')
    expect(getTask(original.id)).toEqual(failed)
    cancelTask(active.id)
    retry()
    expect(() => retry()).toThrow('只能重试失败')
    expect(() => retryAgentTask(active.id, 0, null, active.agent!)).toThrow(
      '只能重试失败',
    )
  })
})
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
      model.provider.generateText = vi.fn(async () => turn([], '待办清单'))
      const task = await agentRun(claimTask()!, fakeRuntime(), model.provider)
      expect(task.status).toBe('completed')
      expect(getProject(project.id).project.name).toBe('待办清单')
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
  it('exposes a loaded candidate during behavior checks without changing the draft or version', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const draft = getDraft(project.id)
    const task = queueAgent(project.id)
    let candidateId = ''
    vi.mocked(verifyBrowser).mockImplementationOnce(
      async (id, _assets, steps, _signal, _transport, options) => {
        expect(steps).toHaveLength(2)
        expect(getProject(project.id).tasks[0].candidatePreview).toBeUndefined()
        options?.onLoaded?.()
        candidateId = id
        expect(
          getProject(project.id).tasks[0].candidatePreview?.artifactId,
        ).toBe(id)
        expect(getProject(project.id).versions).toHaveLength(0)
        expect(getDraft(project.id)).toEqual(draft)
        expect(
          artifactFor(project.id, draft.hash, 'sha256:fixed-template'),
        ).toBeUndefined()
        const response = await previewGET(new Request('http://localhost'), {
          params: { artifactId: id },
        })
        expect(response.status).toBe(200)
        const summary = await (
          await taskGET(new Request('http://localhost'), {
            params: { id: task.id },
          })
        ).json()
        expect(summary.candidatePreview.artifactId).toBe(id)
        expect(summary.candidateFiles).toBeUndefined()
        return { ok: false, output: '功能断言未通过', completedSteps: 1 }
      },
    )
    const model = scripted(
      turn([
        call('browser_test', {
          steps: [
            { action: 'click', selector: 'button', value: '' },
            { action: 'assert_text', selector: 'output', value: '完成' },
          ],
        }),
      ]),
      turn([], '完成，功能检查有告警'),
    )
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('completed')
    expect(runtime.execute).toHaveBeenCalledTimes(1)
    expect(verifyBrowser).toHaveBeenCalledTimes(1)
    expect(getVersion(project.id, result.resultVersionId!).artifactId).toBe(
      candidateId,
    )
    expect(getProject(project.id).tasks[0].candidatePreview).toBeUndefined()
    expect(previewAsset(candidateId, 'index.html').body.length).toBeGreaterThan(
      0,
    )
    expect(
      result.events.find((event) => event.type === 'reply')?.message,
    ).toContain('自动测试未通过')
  })

  it('retires a cancelled candidate and rejects a late ready callback', async () => {
    const { project, runtime, version } = await initialize()
    const task = queueAgent(project.id)
    let candidateId = ''
    vi.mocked(verifyBrowser).mockImplementationOnce(
      async (id, _assets, _steps, _signal, _transport, options) => {
        candidateId = id
        options?.onLoaded?.()
        expect(
          getProject(project.id).tasks[0].candidatePreview?.artifactId,
        ).toBe(id)
        cancelTask(task.id)
        expect(getProject(project.id).tasks[0].candidatePreview).toBeUndefined()
        expect(() => options?.onLoaded?.()).toThrow('操作已中断')
        return { ok: true, output: '迟到的通过结果', completedSteps: 0 }
      },
    )
    const model = scripted(turn([call('build')]))
    expect((await agentRun(task, runtime, model.provider)).status).toBe(
      'cancelled',
    )
    expect(() => previewAsset(candidateId, 'index.html')).toThrow()
    expect(getProject(project.id).project.currentVersionId).toBe(version.id)
    expect(
      previewAsset(version.artifactId, 'index.html').body.length,
    ).toBeGreaterThan(0)
  })

  it('cleans replaced and interrupted candidates, and never accepts a stale attempt', () => {
    const project = newProject()
    const task = queueAgent(project.id)
    const first = randomUUID(),
      second = randomUUID()
    expect(stageCandidatePreview(task, 'template', first, asset('first'))).toBe(
      true,
    )
    expect(
      stageCandidatePreview(task, 'template', second, asset('second')),
    ).toBe(true)
    expect(() => previewAsset(first, 'index.html')).toThrow()
    expect(
      Buffer.from(previewAsset(second, 'index.html').body).toString(),
    ).toBe('second')
    expect(acquireWorker('new-worker')).toBe(true)
    expect(() => previewAsset(second, 'index.html')).toThrow()
    const resumed = claimTask('new-worker')!
    expect(resumed.attemptId).not.toBe(task.attemptId)
    expect(stageCandidatePreview(task, 'template', randomUUID(), asset())).toBe(
      false,
    )
    expect(getProject(project.id).tasks[0].candidatePreview).toBeUndefined()
    finishTask(resumed, '停止测试')
  })

  it('defers a schema-only first build until the page is implemented', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const model = scripted(
      turn([
        call('write_file', {
          path: 'src/pixloom-schema.json',
          content: '{"tables":[]}',
        }),
        call('build'),
      ]),
      turn([
        call('delete_file', { path: 'src/pixloom-schema.json' }),
        call('write_file', {
          path: 'src/App.jsx',
          content: 'export default () => <h1>完整页面</h1>',
        }),
        call('browser_test', {
          steps: [{ action: 'assert_text', selector: 'h1', value: '完整页面' }],
        }),
      ]),
      turn([], '完成'),
    )
    const result = await agentRun(
      queueAgent(project.id),
      runtime,
      model.provider,
    )
    const deferred = JSON.parse(
      (model.next.mock.calls[1][0][1] as Extract<AgentInput, { type: 'tool' }>)
        .output,
    )
    expect(deferred).toMatchObject({ deferred: true, ok: false })
    expect(result.status).toBe('completed')
    expect(result.agent?.buildFailures).toBe(0)
    expect(runtime.execute).toHaveBeenCalledTimes(1)
    expect(verifyBrowser).toHaveBeenCalledTimes(1)
  })

  it('reuses successful checks and builds for unchanged source instead of expanding tests', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const test = (text: string) =>
      call('browser_test', {
        steps: [
          { action: 'click', selector: 'button', value: '' },
          { action: 'assert_text', selector: 'output', value: text },
        ],
      })
    const model = scripted(
      turn([test('first')]),
      turn([call('build'), test('extra')]),
      turn([], '完成'),
    )
    expect(
      (await agentRun(queueAgent(project.id), runtime, model.provider)).status,
    ).toBe('completed')
    expect(runtime.execute).toHaveBeenCalledTimes(1)
    expect(verifyBrowser).toHaveBeenCalledTimes(1)
    const skipped = JSON.parse(
      (model.next.mock.calls[2][0][1] as Extract<AgentInput, { type: 'tool' }>)
        .output,
    )
    expect(skipped).toMatchObject({ skipped: true, completedSteps: 0 })
    expect(skipped.output).toContain('本次步骤未执行')
    expect(skipped.testedSteps[1].value).toBe('first')
  })

  it('honors the durable shared verification time budget without blocking version saving', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    task.agent!.validationDurationMs = AGENT_LIMITS.validationDurationMs
    checkpointAgent(task)
    const model = scripted(
      turn([
        call('browser_test', {
          steps: [{ action: 'assert_visible', selector: '#root', value: '' }],
        }),
      ]),
      turn([], '完成'),
    )
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('completed')
    expect(verifyBrowser).not.toHaveBeenCalled()
    expect(getProject(project.id).tasks[0].candidatePreview).toBeUndefined()
    expect(
      result.events.find((event) => event.type === 'reply')?.message,
    ).toContain('自动测试未通过')
    expect(
      JSON.parse(
        (
          model.next.mock.calls[1][0][0] as Extract<
            AgentInput,
            { type: 'tool' }
          >
        ).output,
      ).output,
    ).toContain('90 秒')
  })

  it('compacts completed tool work into a durable summary and resumes in a fresh native session', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id, '创建带分类的待办应用')
    const summary =
      '已修改 src/App.jsx；构建通过，尚未进行功能测试。下一步完成回复。'
    const first = vi.fn(async () =>
      turn([
        call('write_file', {
          path: 'src/App.jsx',
          content: 'export default () => <h1>待办分类</h1>',
        }),
        call('build'),
      ]),
    )
    const summarize = vi.fn(async () => turn([], summary))
    const resumed = vi.fn(async () => turn([], '完成'))
    const provider: ModelProvider = {
      createSession: vi
        .fn()
        .mockReturnValueOnce({
          next: first,
          needsCompaction: (inputs: AgentInput[]) => inputs.length > 0,
        })
        .mockReturnValueOnce({ next: summarize })
        .mockReturnValueOnce({ next: resumed }),
    }
    const result = await agentRun(task, runtime, provider)
    expect(result.status).toBe('completed')
    expect(result.agent).toMatchObject({
      contextSummary: summary,
      steps: 3,
      toolCalls: 2,
      usage: { inputTokens: 30, outputTokens: 60 },
      reservedOutputTokens: 0,
      responseBytes: 300,
    })
    const requests = vi
      .mocked(provider.createSession)
      .mock.calls.map(([request]) => request)
    expect(requests[1]).toMatchObject({ tools: false })
    expect(requests[1].prompt).toContain('创建带分类的待办应用')
    expect(requests[1].prompt).toContain('write_file')
    expect(requests[1].prompt).toContain('validation')
    expect(requests[2].prompt).toContain(summary)
    expect(requests[2].prompt).toContain('创建带分类的待办应用')
    expect(resumed.mock.calls[0]).toEqual([[], 24000])
    expect(summarize.mock.calls[0]).toEqual([[], 2048])
    expect(first).toHaveBeenCalledTimes(1)
    expect(runtime.execute).toHaveBeenCalledTimes(1)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        message: '上下文已自动压缩，保留需求和开发进展后继续生成',
      }),
    )
  })
  it('does not commit an invalid compression summary or claim the task is complete', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    const provider: ModelProvider = {
      createSession: vi
        .fn()
        .mockReturnValueOnce({
          next: async () => turn([call('list_files')]),
          needsCompaction: (inputs: AgentInput[]) => inputs.length > 0,
        })
        .mockReturnValueOnce({ next: async () => turn([], ' ') }),
    }
    const result = await agentRun(task, runtime, provider)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('未返回有效摘要')
    expect(result.agent?.contextSummary).toBeUndefined()
    expect(result.agent?.steps).toBe(2)
    expect(result.agent?.reservedOutputTokens).toBe(0)
    expect(getProject(project.id).versions).toHaveLength(0)
  })
  it('rejects a late compression result after cancellation', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    const provider: ModelProvider = {
      createSession: vi
        .fn()
        .mockReturnValueOnce({
          next: async () => turn([call('list_files')]),
          needsCompaction: (inputs: AgentInput[]) => inputs.length > 0,
        })
        .mockReturnValueOnce({
          next: async () => {
            cancelTask(task.id)
            return turn([], '迟到的摘要')
          },
        }),
    }
    const result = await agentRun(task, runtime, provider)
    expect(result.status).toBe('cancelled')
    expect(result.agent?.contextSummary).toBeUndefined()
    expect(provider.createSession).toHaveBeenCalledTimes(2)
    expect(getProject(project.id).versions).toHaveLength(0)
  })
  it('can finish on the 200th model turn after more than 80 tool calls', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const model = scripted(
      ...Array.from({ length: 199 }, () => turn([call('read_errors')])),
      turn([], '完成'),
    )
    const result = await agentRun(
      queueAgent(project.id),
      runtime,
      model.provider,
    )
    expect(result.status).toBe('completed')
    expect(result.agent?.steps).toBe(200)
    expect(result.agent?.toolCalls).toBe(199)
    expect(model.next).toHaveBeenCalledTimes(200)
  })
  it('keeps the original recipe requirements when continuing after a failed generation', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const original =
      '帮我做一个中文私房食谱本，支持注册登录、每人独立食谱、收藏筛选、分页和云端备忘文件保存读取。'
    const failed = queueAgent(project.id, original)
    const firstModel = scripted(
      turn([
        call('write_file', {
          path: 'src/App.jsx',
          content: 'export default () => <h1>未完成的食谱本</h1>',
        }),
      ]),
    )
    const first = await agentRun(failed, runtime, firstModel.provider)
    expect(first.status).toBe('failed')
    expect(getDraft(project.id).files).toEqual(snapshot(files).files)
    const next = queueAgent(project.id, '继续生成')
    const model = scripted(turn([], '完成'))
    expect((await agentRun(next, runtime, model.provider)).status).toBe(
      'completed',
    )
    const prompt = vi.mocked(model.provider.createSession).mock.calls[0][0]
      .prompt
    expect(prompt).toContain(original)
    expect(prompt).toContain('本轮用户需求："继续生成"')
    expect(prompt).toContain('"status":"failed"')
    expect(prompt).toContain(first.error!)
    expect(prompt).toContain('此前失败或取消任务的候选源码不会自动沿用')
    expect(prompt).not.toContain('未完成的食谱本')
  })
  it('includes successful replies and later user changes in order, without tool logs or other projects', () => {
    const other = newProject()
    const unrelated = queueAgent(other.id, '其他用户项目的私有需求')
    finishTask(unrelated)
    const project = newProject()
    const first = queueAgent(project.id, '私房食谱本，需要评分')
    addEvent(first, '已添加评分', { type: 'reply' })
    addEvent(first, '不能传入模型的测试凭证与工具输出', { type: 'tool' })
    finishTask(first)
    const changed = queueAgent(project.id, '取消评分，增加烘焙分类')
    cancelTask(changed.id)
    const current = queueAgent(project.id, '修复收藏筛选')
    const prompt = codingAgentPrompt(current)
    expect(prompt).toContain('已添加评分')
    expect(prompt).toContain('"status":"completed"')
    expect(prompt).toContain('"status":"cancelled"')
    expect(prompt.indexOf('私房食谱本，需要评分')).toBeLessThan(
      prompt.indexOf('取消评分，增加烘焙分类'),
    )
    expect(prompt.indexOf('取消评分，增加烘焙分类')).toBeLessThan(
      prompt.indexOf('本轮用户需求："修复收藏筛选"'),
    )
    expect(prompt).toContain('用户明确变更的部分以较新的需求为准')
    expect(prompt).not.toContain('其他用户项目的私有需求')
    expect(prompt).not.toContain('不能传入模型的测试凭证与工具输出')
    finishTask(current)
    const future = queueAgent(project.id, '未来的需求')
    expect(codingAgentPrompt(current)).toBe(prompt)
    cancelTask(future.id)
  })
  it('pins the full first request beyond the UI history limit and bounds recent context', () => {
    const project = newProject()
    const original = '完整食谱需求' + '云端私有数据与文件'.repeat(800)
    const first = queueAgent(project.id, original)
    finishTask(first, '首轮失败')
    for (let i = 0; i < 35; i++) {
      const task = queueAgent(
        project.id,
        `修改第${i}轮：${'详细需求'.repeat(1500)}`,
      )
      finishTask(task)
    }
    const current = queueAgent(project.id, '继续生成')
    expect(
      getProject(project.id).tasks.some((task) => task.id === first.id),
    ).toBe(false)
    const prompt = codingAgentPrompt(current)
    expect(prompt).toContain(original)
    expect(prompt).toContain('修改第34轮')
    expect(prompt).not.toContain('修改第0轮')
    expect(prompt).toContain('轮较早对话因上下文预算省略')
    expect(prompt.length).toBeLessThan(original.length + 28000)
    const history = agentConversation(current)
    expect(history[0].id).toBe(first.id)
    expect(history.at(-1)?.prompt).toContain('修改第34轮')
  })
  it('uses only the current request for a first turn, even with another project in history', () => {
    const other = queueAgent(newProject().id, '无关的像素工作室')
    finishTask(other)
    const task = queueAgent(newProject().id, '创建中文食谱本')
    const prompt = codingAgentPrompt(task)
    expect(prompt).toContain('这是该项目的首轮需求')
    expect(prompt).toContain('本轮用户需求："创建中文食谱本"')
    expect(prompt).not.toContain('无关的像素工作室')
    expect(agentConversation(task)).toEqual([])
  })
  it('rebuilds edited source without forcing another behavior test or claiming the old test passed', async () => {
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
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('completed')
    expect(verifyBrowser).toHaveBeenCalledTimes(2) // combined check, then new smoke
    expect(runtime.execute).toHaveBeenCalledTimes(2)
    expect(model.next).toHaveBeenCalledTimes(3)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'reply',
        message: expect.stringContaining('尚未进行功能测试'),
      }),
    )
  })
  it('saves a built version with a visible warning when the browser environment is unavailable', async () => {
    const { project, runtime, version } = await initialize()
    vi.mocked(verifyBrowser).mockRejectedValueOnce(
      new Error('浏览器验证环境不可用'),
    )
    const model = scripted(turn([call('build')]), turn([], '完成'))
    const result = await agentRun(
      queueAgent(project.id),
      runtime,
      model.provider,
    )
    expect(result.status).toBe('completed')
    expect(result.error).toBeNull()
    expect(getProject(project.id).project.currentVersionId).toBe(
      result.resultVersionId,
    )
    expect(
      getVersion(project.id, result.resultVersionId!).parentVersionId,
    ).toBe(version.id)
    expect(model.next.mock.calls[1][0][0]).toHaveProperty(
      'output',
      expect.stringContaining('浏览器验证环境不可用'),
    )
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'reply',
        message: expect.stringContaining('自动测试未通过或未完成'),
      }),
    )
    expect(model.next).toHaveBeenCalledTimes(2)
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
    expect(
      JSON.parse(
        (
          model.next.mock.calls[1][0][0] as Extract<
            AgentInput,
            { type: 'tool' }
          >
        ).output,
      ),
    ).toMatchObject({
      ok: true,
      validation: { ok: false },
    })
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
    vi.mocked(verifyBrowser).mockResolvedValueOnce({
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
    expect(verifyBrowser).toHaveBeenCalledTimes(2)
    expect(getTask(task.id).events).toContainEqual(
      expect.objectContaining({ type: 'reply', message: '完成' }),
    )
    expect(getTask(task.id).events).not.toContainEqual(
      expect.objectContaining({ type: 'model', message: '完成' }),
    )
  })
  it('stops testing after three durable failures and still updates the version and preview', async () => {
    const { project, runtime, version } = await initialize()
    vi.mocked(verifyBrowser).mockResolvedValue({
      ok: false,
      output: '页面异常',
      completedSteps: 0,
    })
    const task = queueAgent(project.id)
    task.agent!.validationFailures = 1
    checkpointAgent(task)
    const test = () =>
      call('browser_test', {
        steps: [{ action: 'assert_visible', selector: '#root', value: '' }],
      })
    const model = scripted(
      turn([call('build')]),
      turn([test()]),
      turn([test()]),
      turn([], '完成'),
    )
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('completed')
    expect(result.agent?.validationFailures).toBe(3)
    expect(result.error).toBeNull()
    expect(verifyBrowser).toHaveBeenCalledTimes(2)
    expect(model.next.mock.calls[3][0][0]).toHaveProperty(
      'output',
      expect.stringContaining('跳过后续浏览器验证'),
    )
    expect(getProject(project.id).project.currentVersionId).toBe(
      result.resultVersionId,
    )
    expect(
      getVersion(project.id, result.resultVersionId!).parentVersionId,
    ).toBe(version.id)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'reply',
        message: expect.stringContaining('自动测试未通过或未完成'),
      }),
    )
    expect(
      previewAsset(version.artifactId, 'index.html').body.length,
    ).toBeGreaterThan(0)
  })
  it('saves immediately after a failed behavior test without claiming tests passed', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    vi.mocked(verifyBrowser).mockResolvedValueOnce({
      ok: false,
      output: 'strict mode violation',
      completedSteps: 2,
    })
    const model = scripted(
      turn([
        call('browser_test', {
          steps: [
            { action: 'assert_text', selector: 'output', value: '已保存' },
          ],
        }),
      ]),
      turn([], '完成'),
    )
    const result = await agentRun(
      queueAgent(project.id),
      runtime,
      model.provider,
    )
    expect(result.status).toBe('completed')
    expect(result.agent?.validationFailures).toBe(1)
    expect(result.agent?.buildFailures).toBe(0)
    expect(runtime.execute).toHaveBeenCalledTimes(1)
    expect(model.next).toHaveBeenCalledTimes(2)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'ready',
        message: expect.stringContaining('自动测试未通过或未完成'),
      }),
    )
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'reply',
        message: expect.stringContaining('自动测试未通过或未完成'),
      }),
    )
    expect(getProject(project.id).project.currentVersionId).toBe(
      result.resultVersionId,
    )
  })
  it('skips browser checks after resuming with an exhausted failure budget', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    task.agent!.validationFailures = 3
    checkpointAgent(task)
    const model = scripted(turn([], '完成'))
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('completed')
    expect(verifyBrowser).not.toHaveBeenCalled()
    expect(runtime.execute).toHaveBeenCalledTimes(1)
    expect(result.agent?.validationFailures).toBe(3)
  })
  it.each(['pass', 'error'])(
    'rejects a late browser %s after cancellation',
    async (outcome) => {
      const { project, runtime, version } = await initialize()
      const task = queueAgent(project.id)
      vi.mocked(verifyBrowser).mockImplementationOnce(async () => {
        cancelTask(task.id)
        if (outcome === 'error') throw new Error('迟到的浏览器异常')
        return { ok: true, output: '迟到通过', completedSteps: 0 }
      })
      const model = scripted(turn([call('build')]))
      expect((await agentRun(task, runtime, model.provider)).status).toBe(
        'cancelled',
      )
      expect(getProject(project.id).project.currentVersionId).toBe(version.id)
      expect(getProject(project.id).versions).toHaveLength(1)
    },
  )
  it('feeds inspection metadata to the model and persists one diagnostic event per call', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    task.candidateFiles = task.candidateFiles.map((file) =>
      file.path === 'src/App.jsx'
        ? {
            ...file,
            content:
              '// ' +
              'x'.repeat(20000) +
              '\nexport default () => <h1>分类</h1>',
          }
        : file,
    )
    checkpointAgent(task)
    const model = scripted(
      turn([
        call('read_file', { path: 'src/App.jsx', startLine: 1, endLine: 100 }),
        call('search_files', { query: '分类' }),
        call('read_file', {
          path: 'src/missing.jsx',
          startLine: 3,
          endLine: 10,
        }),
        call('read_file', { path: 'src/App.jsx', startLine: 0, endLine: 10 }),
      ]),
      turn([], '完成'),
    )
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('completed')
    const outputs = model.next.mock.calls[1][0].map((input) =>
      input.type === 'tool' ? JSON.parse(input.output) : null,
    )
    expect(outputs[0]).toMatchObject({
      truncated: true,
      returnedRange: { endLine: 1 },
      nextRead: { path: 'src/App.jsx', startLine: 1, startColumn: 15998 },
    })
    expect(outputs[1]).toMatchObject({
      totalMatches: 1,
      truncated: false,
      matches: [{ path: 'src/App.jsx', line: 2 }],
    })
    expect(outputs[2]).toHaveProperty('error', '文件不存在')
    expect(outputs[3]).toHaveProperty('error', '工具参数无效，请按定义提供参数')
    const events = result.events.filter((event) => event.type === 'tool')
    expect(events).toHaveLength(4)
    expect(events[0].message).toContain('返回 1:1–1:15997')
    expect(events[0].message).toContain('续读参数')
    expect(events[0].message).not.toContain('x'.repeat(100))
    expect(events[0].output).toContain('1: // ' + 'x'.repeat(100))
    expect(events[0].output).toContain('本次返回内容已截断')
    expect(events[1].message).toContain('"分类" · 命中 1 处')
    expect(events[1].message).toContain('src/App.jsx:2')
    expect(events[1].output).toBe(
      'src/App.jsx:2\nexport default () => <h1>分类</h1>',
    )
    expect(events[2].message).toContain(
      'src/missing.jsx · 请求 3:1–10 行 · 失败：文件不存在',
    )
    expect(events[3].message).toContain('工具参数无效')
    expect(events[2].output).toBe('文件不存在')
    expect(events[3].output).toContain('工具参数无效')
  })
  it('bounds persisted tool output and explicitly marks display truncation', () => {
    const task = queueAgent(newProject().id)
    addEvent(task, '工具 read_file · src/App.jsx', {
      type: 'tool',
      tool: 'read_file',
      output: '🙂'.repeat(15000),
    })
    const output = getTask(task.id).events.at(-1)!.output!
    expect(output.length).toBeLessThanOrEqual(20000)
    expect(output).toContain('已截断展示')
    expect(output).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
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
    expect(getTask(t2.id).agent?.steps).toBe(3)
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
  it('enforces step and tool limits without committing unverified changes', async () => {
    for (const field of ['steps', 'toolCalls'] as const) {
      const project = newProject(),
        runtime = fakeRuntime()
      const task = queueAgent(project.id)
      task.agent![field] = AGENT_LIMITS[field]
      checkpointAgent(task)
      const model = scripted(
        turn([call('write_file', { path: 'src/App.jsx', content: 'late' })]),
      )
      const result = await agentRun(task, runtime, model.provider)
      expect(result.status).toBe('failed')
      if (field === 'steps') {
        expect(result.error).toContain('最大 200 步')
        expect(model.next).not.toHaveBeenCalled()
      }
      expect(getProject(project.id).versions).toHaveLength(0)
      expect(runtime.execute).not.toHaveBeenCalled()
    }
  })
  it('keeps each model request independent of accumulated output, response bytes and old reservations', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    task.agent!.usage.outputTokens = 60000
    task.agent!.reservedOutputTokens = 48000
    task.agent!.responseBytes = 2 * 1024 * 1024
    checkpointAgent(task)
    const model = scripted(turn([call('read_errors')]), turn([], '完成'))
    const result = await agentRun(task, runtime, model.provider)
    expect(result.status).toBe('completed')
    expect(model.next.mock.calls.map(([, allocation]) => allocation)).toEqual([
      24000, 24000,
    ])
    expect(result.agent?.usage.outputTokens).toBe(60040)
    expect(result.agent?.responseBytes).toBe(2 * 1024 * 1024 + 200)
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
    old.agent!.steps = 24
    old.agent!.buildFailures = 1
    old.agent!.contextSummary = '已确定使用分类筛选；待补充云端保存。'
    checkpointAgent(old, 'first')
    releaseWorker('first')
    acquireWorker('second')
    const next = claimTask('second')!
    expect(next.candidateFiles).toEqual(old.candidateFiles)
    expect(next.agent?.buildFailures).toBe(1)
    expect(() => checkpointAgent(old, 'first')).toThrow('中断')
    const model = scripted(turn([], '完成'))
    await runTask(next, fakeRuntime(), undefined, 'second', model.provider)
    const prompt = vi.mocked(model.provider.createSession).mock.calls[0][0]
      .prompt
    expect(prompt).toContain('本轮用户需求："创建待办应用"')
    expect(prompt).toContain('src/App.jsx')
    expect(prompt).toContain('已确定使用分类筛选；待补充云端保存。')
    expect(getTask(next.id).status).toBe('completed')
    expect(getTask(next.id).agent?.steps).toBe(25)
    expect(getProject(project.id).versions).toHaveLength(1)
  })
  it('enforces total duration and never starts model work for an expired attempt', async () => {
    const project = newProject(),
      runtime = fakeRuntime()
    const task = queueAgent(project.id)
    task.agent!.startedAt = Date.now() - AGENT_LIMITS.durationMs - 1
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

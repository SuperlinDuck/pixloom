import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  acquireWorker,
  attemptActive,
  cancelTask,
  claimTask,
  completeBuild,
  createProject,
  db,
  enqueueTask,
  finishTask,
  getProject,
  getRuntime,
  getTask,
  getVersion,
  heartbeat,
  previewAsset,
  taskQueueInformation,
} from '../src/lib/store'
import { WorkerScheduler } from '../src/lib/worker-scheduler'
import { workerConcurrency } from '../src/lib/worker-config'
import { runTask } from '../src/lib/runner'
import {
  prepareEnvironment,
  protectEnvironment,
  reapEnvironments,
} from '../src/lib/runtime/lifecycle'
import { templateFiles } from '../src/lib/runtime/template'
import { snapshot } from '../src/lib/workspace-files'
import type { ProjectRuntime, SourceFile } from '../src/lib/runtime/types'
import type { AgentState, Task } from '../src/lib/types'
import type { ModelProvider } from '../src/lib/ai/provider'
import { openaiProvider } from '../src/lib/ai/provider'
import { withModelBilling } from '../src/lib/ai/billing'
import { modelRequests } from '../src/lib/ai/request-limiter'

let directory: string
let files: SourceFile[]
const owner = 'test-worker'
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve()
}
function user() {
  const id = randomUUID()
  db()
    .prepare(
      "INSERT INTO users (id,subject,name,email,status,creditLimit,createdAt) VALUES (?,?,?,?,'active',1000000000,?)",
    )
    .run(id, id, id, `${id}@example.com`, Date.now())
  return id
}
function queue(userId = user(), kind: 'initialize' | 'agent' = 'initialize') {
  const project = createProject(
    'concurrency',
    [...files, { path: 'src/request.txt', content: userId }],
    userId,
  )
  const agent: AgentState = {
    provider: 'openai',
    model: 'test',
    prompt: project.id,
    steps: 0,
    toolCalls: 0,
    buildFailures: 0,
    responseBytes: 0,
    reservedOutputTokens: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    startedAt: null,
  }
  const task = enqueueTask(
    project.id,
    kind,
    0,
    null,
    undefined,
    undefined,
    kind === 'agent' ? agent : undefined,
  )
  return { project, task, userId }
}
const scheduled = () => claimTask(owner, { excludeProjects: [] })

function runtimeFixture() {
  const states = new Map<string, 'running' | 'stopped'>()
  const loaded = new Map<string, SourceFile[]>()
  let peakContainers = 0,
    builds = 0,
    peakBuilds = 0
  const runtime = {
    managedProjects: async () => Array.from(states.keys()),
    state: vi.fn(async (id: string) => states.get(id) || 'absent'),
    create: vi.fn(async (id: string) => {
      await Promise.resolve()
      states.set(id, 'running')
      peakContainers = Math.max(peakContainers, states.size)
    }),
    start: vi.fn(async (id: string) => {
      states.set(id, 'running')
    }),
    stop: vi.fn(async (id: string) => {
      if (states.has(id)) states.set(id, 'stopped')
    }),
    remove: vi.fn(async (id: string) => {
      states.delete(id)
    }),
    templateId: async () => 'fixed-template',
    replaceFiles: async (id: string, next: SourceFile[]) => {
      loaded.set(id, next)
    },
    execute: vi.fn(async () => {
      builds++
      peakBuilds = Math.max(peakBuilds, builds)
      await new Promise((resolve) => setImmediate(resolve))
      builds--
      return { exitCode: 0, timedOut: false, output: 'ok' }
    }),
    exportBuild: async (id: string) => [
      {
        path: 'index.html',
        contentType: 'text/html',
        body: Buffer.from(JSON.stringify(loaded.get(id))).toString('base64'),
      },
    ],
  } as unknown as ProjectRuntime
  return {
    runtime,
    states,
    peaks: () => ({ containers: peakContainers, builds: peakBuilds }),
  }
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-worker-'))
  vi.stubEnv('PIXLOOM_DATA_DIR', directory)
  vi.stubEnv('PIXLOOM_WORKER_CONCURRENCY', '3')
  vi.stubEnv('PIXLOOM_MAX_RUNTIME_CONTAINERS', '3')
  vi.stubEnv('PIXLOOM_BUILD_CONCURRENCY', '1')
  vi.stubEnv('PIXLOOM_BROWSER_CONCURRENCY', '1')
  vi.stubEnv('OPENAI_CONTEXT_WINDOW_TOKENS', '128000')
  files = await templateFiles()
  acquireWorker(owner)
})
afterEach(async () => {
  modelRequests.cooldowns.clear()
  vi.unstubAllGlobals()
  db().close()
  delete (globalThis as { pixloomDb?: unknown }).pixloomDb
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('concurrent single Worker scheduling', () => {
  it('reserves model credits only after obtaining a slot and keeps simultaneous billing contexts isolated', async () => {
    vi.stubEnv('PIXLOOM_MODEL_CONCURRENCY', '1')
    vi.stubEnv('OPENAI_API_KEY', 'fake')
    const jobs = [
      queue(undefined, 'agent'),
      queue(undefined, 'agent'),
      queue(undefined, 'agent'),
    ]
    const tasks = jobs.map(() => scheduled()!)
    const held = deferred()
    const fetcher = vi.fn(async () => {
      await held.promise
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      )
    })
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const call = (task: Task, signal = new AbortController().signal) =>
      withModelBilling(task, () =>
        openaiProvider
          .createSession({ model: 'test', prompt: task.id, signal })
          .next([], 100),
      )
    const first = call(tasks[0])
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const cancelled = call(tasks[1], controller.signal)
    const rejected = expect(cancelled).rejects.toThrow('cancelled')
    const third = call(tasks[2])
    await flush()
    expect(db().prepare('SELECT taskId FROM usage_ledger').all()).toEqual([
      { taskId: tasks[0].id },
    ])
    controller.abort(new Error('cancelled'))
    await rejected
    held.resolve()
    await Promise.all([first, third])
    expect(fetcher).toHaveBeenCalledTimes(2)
    const ledger = db()
      .prepare(
        'SELECT taskId,userId,status,credits FROM usage_ledger ORDER BY rowid',
      )
      .all()
    expect(ledger).toEqual(
      [0, 2].map((index) => ({
        taskId: tasks[index].id,
        userId: jobs[index].userId,
        status: 'settled',
        credits: 30,
      })),
    )
  })

  it('cancels a task waiting for the build slot without executing or committing it', async () => {
    const first = queue(),
      second = queue()
    const { runtime } = runtimeFixture()
    const building = deferred()
    vi.mocked(runtime.execute).mockImplementation(async () => {
      await building.promise
      return { exitCode: 0, timedOut: false, output: 'ok' }
    })
    const scheduler = new WorkerScheduler(
      owner,
      (task) => runTask(task, runtime, undefined, owner),
      () => {},
    )
    scheduler.dispatch()
    await vi.waitFor(() =>
      expect(
        getTask(second.task.id).events.some(
          (event) => event.message === '等待构建资源',
        ),
      ).toBe(true),
    )
    cancelTask(second.task.id)
    await vi.waitFor(() =>
      expect(runtime.stop).toHaveBeenCalledWith(second.project.id),
    )
    expect(runtime.execute).toHaveBeenCalledTimes(1)
    expect(getProject(second.project.id).versions).toHaveLength(0)
    building.resolve()
    await scheduler.drain()
    expect(getTask(first.task.id).status).toBe('completed')
    expect(getTask(second.task.id).status).toBe('cancelled')
    expect(runtime.stop).not.toHaveBeenCalledWith(first.project.id)
  })

  it('starts three different users, queues the fourth and drains cleanup before freeing a slot', async () => {
    const jobs = [queue(), queue(), queue(), queue()]
    const gates = jobs.map(() => deferred())
    const started: string[] = []
    const scheduler = new WorkerScheduler(
      owner,
      async (task) => {
        started.push(task.id)
        await gates[jobs.findIndex((job) => job.task.id === task.id)].promise
        finishTask(task)
      },
      () => {},
    )
    scheduler.dispatch()
    await flush()
    expect(started).toEqual(jobs.slice(0, 3).map(({ task }) => task.id))
    expect(getTask(jobs[3].task.id).status).toBe('queued')
    gates[0].resolve()
    await flush()
    scheduler.dispatch()
    await flush()
    expect(started).toHaveLength(4)
    gates.forEach((gate) => gate.resolve())
    await scheduler.drain()
    expect(jobs.map(({ task }) => getTask(task.id).status)).toEqual(
      Array(4).fill('completed'),
    )
  })

  it('skips a busy user and persists fair turns across dispatches and Worker restarts', () => {
    vi.stubEnv('PIXLOOM_WORKER_CONCURRENCY', '1')
    const a = user(),
      b = user()
    const a1 = queue(a),
      a2 = queue(a),
      b1 = queue(b),
      b2 = queue(b)
    const first = scheduled()!
    expect(first.id).toBe(a1.task.id)
    expect(taskQueueInformation().get(a2.task.id)?.waitingForUser).toBe(true)
    finishTask(first)
    const second = scheduled()!
    expect(second.id).toBe(b1.task.id)
    finishTask(second)
    expect(scheduled()!.id).toBe(a2.task.id)
    db().prepare('UPDATE worker SET heartbeat=0').run()
    expect(acquireWorker('replacement')).toBe(true)
    const third = claimTask('replacement', { excludeProjects: [] })!
    // B's older dispatch turn precedes A's just interrupted attempt.
    expect(third.id).toBe(b2.task.id)
    expect(getTask(a2.task.id).status).toBe('queued')
  })

  it('runs only one task per user even with free global slots and reports aggregate queue counts', () => {
    const a = user()
    const a1 = queue(a),
      a2 = queue(a),
      b = queue(),
      c = queue()
    expect(scheduled()!.id).toBe(a1.task.id)
    const info = getProject(a2.project.id).tasks[0].queue
    expect(info).toEqual({ ahead: 2, waitingForUser: true })
    expect(scheduled()!.id).toBe(b.task.id)
    expect(scheduled()!.id).toBe(c.task.id)
    expect(scheduled()).toBeUndefined()
    finishTask(getTask(a1.task.id))
    expect(scheduled()!.id).toBe(a2.task.id)
    expect(() => enqueueTask(a2.project.id, 'initialize', 0, null)).toThrow()
  })

  it('does not start a cancelled project or its user again until old cleanup finishes', async () => {
    const a = user()
    const first = queue(a)
    const cleanup = deferred()
    const started: Task[] = []
    const scheduler = new WorkerScheduler(
      owner,
      async (task) => {
        started.push(task)
        if (task.id === first.task.id) await cleanup.promise
        else finishTask(task)
      },
      () => {},
    )
    scheduler.dispatch()
    await flush()
    cancelTask(first.task.id)
    const next = enqueueTask(first.project.id, 'initialize', 0, null)
    const otherProject = queue(a)
    const otherUser = queue()
    scheduler.dispatch()
    await flush()
    expect(started.map((task) => task.id)).toEqual([
      first.task.id,
      otherUser.task.id,
    ])
    cleanup.resolve()
    await scheduler.drain()
    scheduler.dispatch()
    await scheduler.drain()
    expect(getTask(next.id).status).toBe('completed')
    scheduler.dispatch()
    await scheduler.drain()
    expect(getTask(otherProject.task.id).status).toBe('completed')
  })

  it('caps task concurrency by container capacity and refuses stale Worker claims', () => {
    vi.stubEnv('PIXLOOM_MAX_RUNTIME_CONTAINERS', '1')
    queue()
    queue()
    expect(workerConcurrency()).toBe(1)
    expect(scheduled()).toBeDefined()
    expect(scheduled()).toBeUndefined()
    expect(claimTask('stale', { excludeProjects: [] })).toBeUndefined()
  })

  it('generates three applications concurrently with isolated versions and serial build/browser work', async () => {
    const jobs = [
      queue(undefined, 'agent'),
      queue(undefined, 'agent'),
      queue(undefined, 'agent'),
      queue(undefined, 'agent'),
    ]
    const generation = deferred()
    const generating: string[] = []
    const provider: ModelProvider = {
      createSession: ({ prompt }) => ({
        next: async () => {
          generating.push(prompt)
          await generation.promise
          return {
            text: '完成',
            calls: [],
            usage: { inputTokens: 1, outputTokens: 1 },
            responseBytes: 10,
          }
        },
      }),
    }
    const { runtime, peaks } = runtimeFixture()
    let browsers = 0,
      peakBrowsers = 0
    const verifier = vi.fn(async () => {
      browsers++
      peakBrowsers = Math.max(peakBrowsers, browsers)
      await new Promise((resolve) => setImmediate(resolve))
      browsers--
      return { ok: true, output: 'ok', completedSteps: 1 }
    })
    const errors: unknown[] = []
    const scheduler = new WorkerScheduler(
      owner,
      (task) => runTask(task, runtime, undefined, owner, provider, verifier),
      (error) => errors.push(error),
    )
    scheduler.dispatch()
    await vi.waitFor(() => expect(generating).toHaveLength(3))
    expect(getTask(jobs[3].task.id).status).toBe('queued')
    generation.resolve()
    await scheduler.drain()
    scheduler.dispatch()
    await scheduler.drain()
    expect(errors).toEqual([])
    expect(peaks()).toEqual({ containers: 3, builds: 1 })
    expect(peakBrowsers).toBe(1)
    expect(verifier).toHaveBeenCalledTimes(4)
    for (const { project, task, userId } of jobs) {
      expect(getTask(task.id).status).toBe('completed')
      const version = getVersion(project.id, getTask(task.id).resultVersionId!)
      expect(version.taskId).toBe(task.id)
      expect(
        JSON.parse(
          Buffer.from(
            previewAsset(version.artifactId, 'index.html').body,
          ).toString(),
        ),
      ).toEqual(version.files)
      expect(
        version.files.find((file) => file.path === 'src/request.txt')?.content,
      ).toBe(userId)
    }
    expect(
      new Set(jobs.map(({ task }) => getTask(task.id).resultVersionId)).size,
    ).toBe(4)
  })

  it('serializes capacity allocation, protects cancelled cleanup from reaping and fences old attempts on restart', async () => {
    vi.stubEnv('PIXLOOM_MAX_RUNTIME_CONTAINERS', '1')
    vi.stubEnv('PIXLOOM_RUNTIME_IDLE_SECONDS', '0')
    const first = queue(),
      second = queue()
    const one = claimTask()!,
      two = claimTask()!
    const { runtime, states } = runtimeFixture()
    const signal = new AbortController().signal
    const unprotect = protectEnvironment(one.projectId)
    const hash = snapshot(files).hash
    const outcomes = await Promise.allSettled([
      prepareEnvironment(runtime, one, files, hash, signal, () => {}, owner),
      prepareEnvironment(runtime, two, files, hash, signal, () => {}, owner),
    ])
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'rejected',
    ])
    expect(states.size).toBe(1)
    cancelTask(one.id)
    await reapEnvironments(runtime, owner, true)
    expect(states.has(first.project.id)).toBe(true)
    unprotect()
    await reapEnvironments(runtime, owner, true)
    expect(states.size).toBe(0)
    db().prepare('UPDATE worker SET heartbeat=0').run()
    acquireWorker('replacement')
    const recovered = claimTask('replacement')!
    expect(recovered.id).toBe(second.task.id)
    expect(recovered.attemptId).not.toBe(two.attemptId)
    expect(attemptActive(two, owner)).toBe(false)
    expect(
      completeBuild(
        two,
        'fixed-template',
        randomUUID(),
        [
          {
            path: 'index.html',
            contentType: 'text/html',
            body: Buffer.from('stale').toString('base64'),
          },
        ],
        owner,
      ),
    ).toBeNull()
    expect(getRuntime(first.project.id)?.state).toBe('absent')
    expect(heartbeat(owner)).toBe(false)
  })
})

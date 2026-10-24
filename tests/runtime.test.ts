import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  createFileTools,
  validateFiles,
  validateSourcePath,
} from '../sandbox/file-tools.cjs'
import {
  DockerRuntime,
  containerName,
  type DockerCommand,
} from '../src/lib/runtime/docker'
import { runtimePreviewHeaders } from '../src/lib/runtime/preview'
import { templateFiles } from '../src/lib/runtime/template'
import {
  RuntimeError,
  type ProjectRuntime,
  type SourceFile,
} from '../src/lib/runtime/types'
import {
  acquireWorker,
  createProject,
  db,
  releaseWorker,
} from '../src/lib/store'
import {
  cancelRuntimeJob,
  claimRuntimeJob,
  enqueueRuntimeJob,
  getRuntime,
  runtimeByToken,
  runtimeJob,
} from '../src/lib/runtime/store'
import { runRuntimeJob } from '../src/lib/runtime/runner'

let directory: string
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pixloom-runtime-'))
  process.env.PIXLOOM_DATA_DIR = directory
})
beforeEach(() => {
  db().exec(
    'DELETE FROM versions; DELETE FROM tasks; DELETE FROM projects; DELETE FROM worker;',
  )
  vi.restoreAllMocks()
})
afterAll(async () => {
  db().close()
  delete (globalThis as { pixloomDb?: unknown }).pixloomDb
  delete process.env.PIXLOOM_DATA_DIR
  await rm(directory, { recursive: true, force: true })
})

describe('preview origin boundary', () => {
  it('uses the actual loopback Host for CSP when Next normalizes the URL', () => {
    const headers = runtimePreviewHeaders(
      new Request('http://localhost:3000/api/runtime-preview/token', {
        headers: { host: '127.0.0.1:3000' },
      }),
      'text/html',
    )
    expect(headers['Content-Security-Policy']).toContain(
      'script-src http://127.0.0.1:3000',
    )
    expect(headers['Content-Security-Policy']).toContain(
      'sandbox allow-scripts',
    )
    expect(headers['Content-Security-Policy']).not.toContain(
      'allow-same-origin',
    )
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
    expect(() =>
      runtimePreviewHeaders(
        new Request('http://localhost/api', {
          headers: { host: 'evil.example' },
        }),
        'text/html',
      ),
    ).toThrow('本机 Host')
  })
})

describe('source file boundary', () => {
  it('rejects traversal, hidden/config/dependency files and oversize source sets', () => {
    for (const name of [
      '../.env',
      '/etc/passwd',
      'src/../App.jsx',
      'src\\App.jsx',
      'src/.env',
      'package.json',
      'vite.config.mjs',
      'src//App.jsx',
      'src/node.cjs',
    ])
      expect(() => validateSourcePath(name)).toThrow()
    expect(validateSourcePath('src/components/Hello.jsx')).toBe(
      'src/components/Hello.jsx',
    )
    expect(() =>
      validateFiles([{ path: 'src/App.jsx', content: 'x'.repeat(131073) }]),
    ).toThrow('128 KiB')
    expect(() =>
      validateFiles([
        { path: 'index.html', content: '' },
        { path: 'index.html', content: '' },
      ]),
    ).toThrow('重复')
    expect(() =>
      validateFiles(
        Array.from({ length: 9 }, (_, i) => ({
          path: `src/f${i}.txt`,
          content: 'x'.repeat(131072),
        })),
      ),
    ).toThrow('1 MiB')
  })
  it('reads, writes and snapshots source without following symlinks', async () => {
    const root = await mkdtemp(path.join(directory, 'files-'))
    const tools = createFileTools(root)
    await tools.write('index.html', '<html></html>')
    await tools.write('src/App.jsx', 'export default 1')
    expect(await tools.read('src/App.jsx')).toBe('export default 1')
    expect((await tools.snapshot()).map((f) => f.path)).toEqual([
      'index.html',
      'src/App.jsx',
    ])
    const outside = await mkdtemp(path.join(directory, 'outside-'))
    await symlink(outside, path.join(root, 'src', 'escape'))
    await expect(tools.write('src/escape/leak.txt', 'bad')).rejects.toThrow(
      '符号链接',
    )
    await expect(tools.snapshot()).rejects.toThrow('符号链接')
  })
  it('rejects final-component symlinks and invalid workspace roots', async () => {
    const root = await mkdtemp(path.join(directory, 'symlink-'))
    await mkdir(path.join(root, 'src'))
    await symlink(
      path.join(root, 'index.html'),
      path.join(root, 'src/alias.txt'),
    )
    await expect(
      createFileTools(root).write('src/alias.txt', 'bad'),
    ).rejects.toThrow('符号链接')
    await symlink(root, path.join(directory, 'alias-root'))
    await expect(
      createFileTools(path.join(directory, 'alias-root')).write(
        'index.html',
        'bad',
      ),
    ).rejects.toThrow('根目录')
  })
})
function fakeDocker() {
  let created = false,
    running = false
  const calls: { args: string[]; input?: string }[] = []
  const command: DockerCommand = vi.fn(async (args, options = {}) => {
    calls.push({ args, input: options.input })
    if (args[0] === 'version')
      return { code: 0, stdout: 'test-engine', stderr: '' }
    if (args[0] === 'image') return { code: 0, stdout: '[]', stderr: '' }
    if (args[0] === 'container')
      return created
        ? {
            code: 0,
            stdout: JSON.stringify([
              {
                State: { Running: running },
                Config: {
                  Labels: {
                    'dev.pixloom.runtime': 'true',
                    'dev.pixloom.project': args[2].slice('pixloom-'.length),
                  },
                },
              },
            ]),
            stderr: '',
          }
        : { code: 1, stdout: '', stderr: 'Error: No such container' }
    if (args[0] === 'create') created = true
    if (args[0] === 'start') running = true
    if (['stop', 'kill'].includes(args[0])) running = false
    if (args[0] === 'rm') created = false
    if (args[0] === 'exec')
      return {
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          result: {
            ok: true,
            exitCode: 0,
            output: 'built',
            timedOut: false,
            content: 'source',
          },
        }),
        stderr: '',
      }
    return { code: 0, stdout: '', stderr: '' }
  })
  return { command, calls }
}
describe('Docker adapter contract', () => {
  it('creates a non-root bounded container without network, host mounts or model credentials', async () => {
    const { command, calls } = fakeDocker(),
      id = randomUUID(),
      token = randomUUID()
    const runtime = new DockerRuntime(command)
    await runtime.create(id, token, await templateFiles())
    const args = calls.find((c) => c.args[0] === 'create')!.args
    expect(args).toContain('--read-only')
    expect(
      args.slice(args.indexOf('--user'), args.indexOf('--user') + 2),
    ).toEqual(['--user', '1000:1000'])
    expect(
      args.slice(args.indexOf('--network'), args.indexOf('--network') + 2),
    ).toEqual(['--network', 'none'])
    expect(args).toContain('512m')
    expect(args).toContain('--pids-limit')
    expect(args).not.toContain('--volume')
    expect(args).not.toContain('--publish')
    expect(args.join(' ')).not.toMatch(
      /GEMINI_API_KEY|OPENAI_API_KEY|VERTEX_AI_API_KEY|docker\.sock/,
    )
    expect(calls.find((c) => c.args[0] === 'exec')!.input).toContain(
      'src/App.jsx',
    )
    await runtime.stop(id)
    expect(await runtime.state(id)).toBe('stopped')
    await runtime.remove(id)
    expect(await runtime.state(id)).toBe('absent')
  })
  it('does not overwrite live source on a duplicate start, and restricts paths and commands', async () => {
    const { command, calls } = fakeDocker(),
      id = randomUUID()
    const runtime = new DockerRuntime(command),
      files = await templateFiles()
    await runtime.create(id, randomUUID(), files)
    const before = calls.length
    await runtime.start(id, files)
    expect(calls.slice(before).some((c) => c.args[0] === 'exec')).toBe(false)
    await expect(runtime.readFile(id, '../.env')).rejects.toThrow('路径')
    await expect(runtime.execute(id, 'rm -rf /' as 'build')).rejects.toThrow(
      '固定',
    )
    expect(() => containerName('--privileged')).toThrow('项目 ID')
  })
  it('refuses containers without both ownership labels', async () => {
    const command: DockerCommand = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify([
        { Config: { Labels: {} }, State: { Running: true } },
      ]),
      stderr: '',
    }))
    await expect(
      new DockerRuntime(command).remove(randomUUID()),
    ).rejects.toThrow('不属于')
    expect(command).toHaveBeenCalledTimes(1)
  })
  it('distinguishes a lost Docker daemon from an absent container', async () => {
    const command: DockerCommand = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon',
    }))
    await expect(
      new DockerRuntime(command).state(randomUUID()),
    ).rejects.toThrow('Engine')
    expect((await new DockerRuntime(command).health()).available).toBe(false)
  })
  it('kills the container when docker exec is interrupted', async () => {
    const id = randomUUID(),
      controller = new AbortController()
    const { command, calls } = fakeDocker()
    const wrapped: DockerCommand = async (args, options) => {
      if (args[0] === 'exec' && options?.input?.includes('"op":"build"')) {
        controller.abort()
        throw new RuntimeError('aborted', 499)
      }
      return command(args, options)
    }
    const runtime = new DockerRuntime(wrapped)
    await runtime.create(id, randomUUID(), await templateFiles())
    await expect(
      runtime.execute(id, 'build', controller.signal),
    ).rejects.toThrow('aborted')
    expect(calls.some((c) => c.args[0] === 'kill')).toBe(true)
  })
})
function fakeRuntime(): ProjectRuntime {
  let state: 'absent' | 'running' | 'stopped' = 'absent'
  return {
    health: vi.fn(async () => ({
      available: true,
      imageReady: true,
      reason: null,
    })),
    prepare: vi.fn(async () => {}),
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
    readFile: vi.fn(async () => 'source'),
    listFiles: vi.fn(async () => []),
    searchFiles: vi.fn(async () => []),
    writeFile: vi.fn(async () => {}),
    execute: vi.fn(async () => ({
      exitCode: 0,
      output: 'vite build success',
      timedOut: false,
    })),
    logs: vi.fn(async () => 'preview ready'),
    preview: vi.fn(async () => ({
      status: 200,
      body: '',
      contentType: 'text/html',
    })),
  }
}
describe('persistent runtime jobs', () => {
  it('runs create, build, source save, restart and remove while preserving snapshots', async () => {
    const id = createProject('Runtime').id,
      files = await templateFiles(),
      runtime = fakeRuntime()
    enqueueRuntimeJob(id, 'create', files)
    await runRuntimeJob(claimRuntimeJob()!, runtime)
    expect(getRuntime(id).workspace?.state).toBe('running')
    enqueueRuntimeJob(id, 'build', [])
    await runRuntimeJob(claimRuntimeJob()!, runtime)
    expect(getRuntime(id).workspace?.built).toBe(true)
    enqueueRuntimeJob(id, 'write', [], {
      path: 'src/App.jsx',
      content: 'changed',
    })
    await runRuntimeJob(claimRuntimeJob()!, runtime)
    expect(getRuntime(id).workspace?.built).toBe(false)
    expect(
      getRuntime(id).workspace?.files.find((f) => f.path === 'src/App.jsx')
        ?.content,
    ).toBe('changed')
    enqueueRuntimeJob(id, 'stop', [])
    await runRuntimeJob(claimRuntimeJob()!, runtime)
    enqueueRuntimeJob(id, 'start', [])
    await runRuntimeJob(claimRuntimeJob()!, runtime)
    expect(runtime.start).toHaveBeenCalledWith(
      id,
      expect.arrayContaining([{ path: 'src/App.jsx', content: 'changed' }]),
      expect.any(AbortSignal),
    )
    enqueueRuntimeJob(id, 'remove', [])
    await runRuntimeJob(claimRuntimeJob()!, runtime)
    expect(getRuntime(id).workspace?.state).toBe('absent')
    expect(getRuntime(id).workspace?.files).toHaveLength(4)
  })
  it('prevents concurrent jobs, rejects illegal source writes and limits environments', async () => {
    const files = await templateFiles(),
      id = createProject('One').id
    enqueueRuntimeJob(id, 'create', files)
    expect(() => enqueueRuntimeJob(id, 'build', [])).toThrow('已有')
    cancelRuntimeJob(id)
    expect(claimRuntimeJob()).toBeUndefined()
    expect(() =>
      enqueueRuntimeJob(id, 'write', [], { path: '../.env', content: 'bad' }),
    ).toThrow('路径')
    enqueueRuntimeJob(id, 'create', files)
    enqueueRuntimeJob(createProject('Two').id, 'create', files)
    enqueueRuntimeJob(createProject('Three').id, 'create', files)
    expect(() =>
      enqueueRuntimeJob(createProject('Four').id, 'create', files),
    ).toThrow('3 个')
  })
  it('records build errors and never marks failed/cancelled output ready', async () => {
    const id = createProject('Failure').id,
      runtime = fakeRuntime()
    enqueueRuntimeJob(id, 'create', await templateFiles())
    await runRuntimeJob(claimRuntimeJob()!, runtime)
    runtime.execute = vi.fn(async () => ({
      exitCode: 1,
      output: 'JSX error at App.jsx',
      timedOut: false,
    }))
    enqueueRuntimeJob(id, 'build', [])
    const job = claimRuntimeJob()!
    await runRuntimeJob(job, runtime)
    expect(runtimeJob(job.id).status).toBe('failed')
    expect(getRuntime(id).workspace?.built).toBe(false)
    expect(
      runtimeJob(job.id).events.some((e) => e.message.includes('JSX error')),
    ).toBe(true)
    runtime.execute = vi.fn(async () => {
      cancelRuntimeJob(id)
      return { exitCode: 0, output: 'late success', timedOut: false }
    })
    enqueueRuntimeJob(id, 'build', [])
    const cancelled = claimRuntimeJob()!
    await runRuntimeJob(cancelled, runtime)
    expect(runtimeJob(cancelled.id).status).toBe('cancelled')
    expect(getRuntime(id).workspace?.built).toBe(false)
    expect(runtime.stop).toHaveBeenCalled()
  })
  it('does not persist a source write that finishes after cancellation', async () => {
    const id = createProject('Cancelled write').id
    const files = await templateFiles()
    const runtime = fakeRuntime()
    enqueueRuntimeJob(id, 'create', files)
    await runRuntimeJob(claimRuntimeJob()!, runtime)
    runtime.writeFile = vi.fn(async () => {
      cancelRuntimeJob(id)
    })
    enqueueRuntimeJob(id, 'write', [], {
      path: 'src/App.jsx',
      content: 'late cancelled source',
    })
    const job = claimRuntimeJob()!
    await runRuntimeJob(job, runtime)
    expect(runtimeJob(job.id).status).toBe('cancelled')
    expect(
      getRuntime(id).workspace!.files.find(
        (file) => file.path === 'src/App.jsx',
      )!.content,
    ).toBe(files.find((file) => file.path === 'src/App.jsx')!.content)
  })

  it('recovers interrupted jobs on a new Worker lease and keeps tokens project-specific', async () => {
    const one = createProject('One').id,
      two = createProject('Two').id
    enqueueRuntimeJob(one, 'create', await templateFiles())
    const job = claimRuntimeJob()!
    enqueueRuntimeJob(two, 'create', await templateFiles())
    expect(acquireWorker('owner')).toBe(true)
    expect(runtimeJob(job.id).status).toBe('queued')
    releaseWorker('owner')
    const token = getRuntime(one).workspace!.token
    expect(runtimeByToken(token)?.projectId).toBe(one)
    expect(token).not.toBe(getRuntime(two).workspace!.token)
    expect(runtimeByToken('missing')).toBeNull()
  })
})

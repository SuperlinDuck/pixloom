import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { validateFiles, validateSourcePath } from './files'
import {
  RuntimeError,
  type CommandResult,
  type DockerHealth,
  type PreviewAsset,
  type ProjectRuntime,
  type SourceFile,
} from './types'

export const RUNTIME_IMAGE = 'pixloom-runtime:react-v1'
const MANAGED_LABEL = 'dev.pixloom.runtime'
const OWNER_LABEL = 'dev.pixloom.project'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export function containerName(projectId: string) {
  if (!UUID.test(projectId)) throw new RuntimeError('项目 ID 无效')
  return `pixloom-${projectId}`
}
export function dockerBinary() {
  if (process.env.PIXLOOM_DOCKER_BIN) return process.env.PIXLOOM_DOCKER_BIN
  return (
    [
      path.join(homedir(), '.docker/bin/docker'),
      '/usr/local/bin/docker',
      '/opt/homebrew/bin/docker',
      '/Applications/Docker.app/Contents/Resources/bin/docker',
    ].find(existsSync) || 'docker'
  )
}
export type CliResult = { code: number; stdout: string; stderr: string }
export type DockerCommand = (
  args: string[],
  options?: {
    input?: string
    timeout?: number
    signal?: AbortSignal
    maxOutput?: number
  },
) => Promise<CliResult>
export const dockerCommand: DockerCommand = (args, options = {}) =>
  new Promise((resolve, reject) => {
    // No shell, and no model credentials in the Docker CLI environment or container flags.
    const allowed = [
      'PATH',
      'HOME',
      'USER',
      'TMPDIR',
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'DOCKER_CONFIG',
      'DOCKER_CERT_PATH',
      'DOCKER_TLS_VERIFY',
      'XDG_RUNTIME_DIR',
      'SSH_AUTH_SOCK',
    ]
    const env: NodeJS.ProcessEnv = {
      ...Object.fromEntries(
        allowed.flatMap((key) =>
          process.env[key] ? [[key, process.env[key]!]] : [],
        ),
      ),
      NODE_ENV: 'production',
    }
    const binary = dockerBinary()
    if (path.isAbsolute(binary)) {
      const helperDirectory = path.dirname(realpathSync(binary))
      env.PATH = helperDirectory + path.delimiter + (env.PATH || '')
    }
    const child = spawn(binary, args, {
      shell: false,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = '',
      stderr = '',
      settled = false
    const finishError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      child.kill('SIGKILL')
      reject(error)
    }
    const abort = () => finishError(new RuntimeError('Docker 操作已中断', 499))
    const timer = setTimeout(
      () => finishError(new RuntimeError('Docker 操作超时', 504)),
      options.timeout || 15000,
    )
    function cleanup() {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
    const append = (channel: 'stdout' | 'stderr', chunk: string) => {
      if (channel === 'stdout') stdout += chunk.toString()
      else stderr += chunk.toString()
      if (
        Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >
        (options.maxOutput || 4 * 1024 * 1024)
      )
        finishError(new RuntimeError('Docker 输出超过限制', 413))
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => append('stdout', chunk))
    child.stderr.on('data', (chunk) => append('stderr', chunk))
    child.stdin.on('error', () => {})
    child.once('error', (error) =>
      finishError(
        new RuntimeError(
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? '未找到 Docker，请安装并启动 Docker Desktop'
            : '无法启动 Docker CLI',
          503,
        ),
      ),
    )
    child.once('close', (code) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ code: code ?? 1, stdout, stderr })
    })
    if (options.signal?.aborted) {
      abort()
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdin.end(options.input || '')
  })
function check(result: CliResult, message: string) {
  if (result.code !== 0)
    throw new RuntimeError(
      `${message}：${result.stderr.trim().slice(-1500) || 'Docker 命令失败'}`,
      503,
    )
  return result.stdout
}
export class DockerRuntime implements ProjectRuntime {
  constructor(private command: DockerCommand = dockerCommand) {}
  async health(): Promise<DockerHealth> {
    try {
      const result = await this.command(
        ['version', '--format', '{{.Server.Version}}'],
        { timeout: 5000 },
      )
      if (result.code !== 0 || !result.stdout.trim())
        return {
          available: false,
          imageReady: false,
          reason: 'Docker Engine 未连接，请启动 Docker Desktop',
        }
      const image = await this.command(['image', 'inspect', RUNTIME_IMAGE], {
        timeout: 5000,
      })
      return {
        available: true,
        imageReady: image.code === 0,
        reason: image.code
          ? '请先运行 pnpm sandbox:prepare 构建固定模板镜像'
          : null,
        serverVersion: result.stdout.trim(),
      }
    } catch (error) {
      return {
        available: false,
        imageReady: false,
        reason: (error as Error).message,
      }
    }
  }
  async prepare(signal?: AbortSignal) {
    check(
      await this.command(
        [
          'build',
          '--label',
          `${MANAGED_LABEL}=true`,
          '--tag',
          RUNTIME_IMAGE,
          path.join(process.cwd(), 'sandbox'),
        ],
        { timeout: 300000, signal },
      ),
      '镜像构建失败',
    )
  }
  private async inspect(projectId: string) {
    const name = containerName(projectId)
    const result = await this.command(['container', 'inspect', name])
    if (result.code !== 0) {
      // Only a confirmed missing-container error is absence. A lost daemon is an error.
      if (/No such (object|container)/i.test(result.stderr)) return null
      throw new RuntimeError('无法读取容器状态，请检查 Docker Engine', 503)
    }
    const info = JSON.parse(result.stdout)[0]
    if (
      info?.Config?.Labels?.[MANAGED_LABEL] !== 'true' ||
      info?.Config?.Labels?.[OWNER_LABEL] !== projectId
    )
      throw new RuntimeError('拒绝操作不属于 Pixloom 项目的容器', 409)
    return info
  }
  async state(projectId: string) {
    const info = await this.inspect(projectId)
    return !info
      ? ('absent' as const)
      : info.State.Running
        ? ('running' as const)
        : ('stopped' as const)
  }
  private async control<T>(
    projectId: string,
    payload: unknown,
    signal?: AbortSignal,
    timeout = 15000,
  ): Promise<T> {
    if ((await this.state(projectId)) !== 'running')
      throw new RuntimeError('容器未运行，请先启动环境', 409)
    try {
      const result = await this.command(
        [
          'exec',
          '--interactive',
          '--user',
          '1000:1000',
          containerName(projectId),
          'node',
          '/opt/pixloom/control.cjs',
        ],
        { input: JSON.stringify(payload), timeout, signal },
      )
      let parsed
      try {
        parsed = JSON.parse(result.stdout)
      } catch {
        throw new RuntimeError('容器返回了无效的操作结果', 502)
      }
      if (!parsed.ok || result.code)
        throw new RuntimeError(parsed.error || '容器操作失败')
      return parsed.result as T
    } catch (error) {
      // Killing docker exec alone leaves its child alive. Stop the container on interruption.
      if (
        signal?.aborted ||
        (error instanceof RuntimeError && error.status === 504)
      ) {
        await this.command(['kill', containerName(projectId)], {
          timeout: 5000,
        }).catch(() => {})
      }
      throw error
    }
  }
  async create(
    projectId: string,
    token: string,
    files: SourceFile[],
    signal?: AbortSignal,
  ) {
    validateFiles(files)
    if (!UUID.test(token)) throw new RuntimeError('预览令牌无效')
    const state = await this.state(projectId)
    if (state !== 'absent')
      throw new RuntimeError('环境已存在，请启动现有环境或先移除', 409)
    const health = await this.health()
    if (!health.available || !health.imageReady)
      throw new RuntimeError(health.reason || 'Docker 不可用', 503)
    const args = [
      'create',
      '--name',
      containerName(projectId),
      '--label',
      `${MANAGED_LABEL}=true`,
      '--label',
      `${OWNER_LABEL}=${projectId}`,
      '--user',
      '1000:1000',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--network',
      'none',
      '--cpus',
      '1',
      '--memory',
      '512m',
      '--memory-swap',
      '512m',
      '--pids-limit',
      '128',
      '--init',
      '--restart',
      'no',
      '--log-driver',
      'local',
      '--log-opt',
      'max-size=1m',
      '--log-opt',
      'max-file=2',
      '--tmpfs',
      '/workspace:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000',
      '--env',
      `PIXLOOM_PREVIEW_BASE=/api/runtime-preview/${token}/`,
    ]
    for (const key of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
      'no_proxy',
    ])
      args.push('--env', `${key}=`)
    args.push(RUNTIME_IMAGE)
    check(await this.command(args, { signal }), '创建容器失败')
    try {
      await this.start(projectId, files, signal)
    } catch (error) {
      await this.remove(projectId).catch(() => {})
      throw error
    }
  }
  async start(projectId: string, files: SourceFile[], signal?: AbortSignal) {
    validateFiles(files)
    const state = await this.state(projectId)
    if (state === 'absent') throw new RuntimeError('环境不存在，请先创建', 404)
    if (state === 'running') return // Never overwrite live files on a duplicate start.
    check(
      await this.command(['start', containerName(projectId)], { signal }),
      '启动容器失败',
    )
    await this.control(projectId, { op: 'init', files }, signal)
  }
  async stop(projectId: string) {
    if ((await this.state(projectId)) !== 'absent')
      check(
        await this.command(['stop', '--time', '2', containerName(projectId)]),
        '停止容器失败',
      )
  }
  async remove(projectId: string) {
    if ((await this.state(projectId)) !== 'absent')
      check(
        await this.command(['rm', '--force', containerName(projectId)]),
        '移除容器失败',
      )
  }
  async listFiles(projectId: string) {
    return this.control<{ path: string; size: number }[]>(projectId, {
      op: 'list',
    })
  }
  async searchFiles(projectId: string, query: string) {
    if (!query || query.length > 120)
      throw new RuntimeError('搜索词长度必须在 1 到 120 字之间')
    return this.control<{ path: string; line: number; text: string }[]>(
      projectId,
      { op: 'search', query },
    )
  }
  async readFile(projectId: string, file: string, signal?: AbortSignal) {
    validateSourcePath(file)
    return (
      await this.control<{ content: string }>(
        projectId,
        { op: 'read', path: file },
        signal,
      )
    ).content
  }
  async writeFile(
    projectId: string,
    file: string,
    content: string,
    signal?: AbortSignal,
  ) {
    validateFiles([{ path: file, content }])
    await this.control(projectId, { op: 'write', path: file, content }, signal)
  }
  async execute(
    projectId: string,
    command: 'build',
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    if (command !== 'build')
      throw new RuntimeError('仅允许固定的 Vite 构建命令')
    return this.control(projectId, { op: 'build' }, signal, 100000)
  }
  async logs(projectId: string) {
    if ((await this.state(projectId)) === 'absent') return ''
    const result = await this.command(
      ['logs', '--tail', '80', containerName(projectId)],
      { maxOutput: 256 * 1024 },
    )
    check(result, '读取日志失败')
    return (result.stdout + result.stderr).slice(-16000)
  }
  async preview(projectId: string, file: string) {
    if (
      !/^[a-zA-Z0-9_./-]*$/.test(file) ||
      file.split('/').some((s) => s === '..' || s.startsWith('.'))
    )
      throw new RuntimeError('预览路径无效')
    return this.control<PreviewAsset>(projectId, { op: 'preview', path: file })
  }
}

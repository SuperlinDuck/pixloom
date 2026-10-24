import { runCodingAgent, AGENT_LIMITS } from './ai/agent'
import { providerFor, type ModelProvider } from './ai/provider'
import { randomUUID } from 'node:crypto'
import {
  addEvent,
  artifactFor,
  attemptActive,
  checkpointAgent,
  completeBuild,
  finishTask,
  db,
  getTask,
  getVersion,
  ownsWorker,
  setRuntimeForTask,
} from './store'
import { snapshot } from './workspace-files'
import { DockerRuntime } from './runtime/docker'
import type { ProjectRuntime } from './runtime/types'
import type { Task } from './types'
import { verifyBrowser, type BrowserVerifier } from './browser'

export async function runTask(
  task: Task,
  runtime: ProjectRuntime = new DockerRuntime(),
  shutdown?: AbortSignal,
  owner?: string,
  modelProvider?: ModelProvider,
  browserVerifier: BrowserVerifier = verifyBrowser,
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  shutdown?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    abort,
    task.kind === 'agent'
      ? Math.max(
          1,
          AGENT_LIMITS.durationMs -
            (task.agent?.startedAt ? Date.now() - task.agent.startedAt : 0),
        )
      : 150000,
  )
  const poll = setInterval(() => {
    if (!attemptActive(task, owner)) abort()
  }, 300)
  const active = () => !controller.signal.aborted && attemptActive(task, owner)
  let touched = false
  try {
    if (shutdown?.aborted || !active()) throw new Error('操作已中断')
    if (task.kind === 'agent') {
      if (!task.agent) throw new Error('缺少模型任务配置')
      task.agent.startedAt ??= Date.now()
      checkpointAgent(task, owner)
      if (Date.now() - task.agent.startedAt >= AGENT_LIMITS.durationMs)
        throw new Error('Coding Agent 超过 5 分钟总时限')
    }
    const id = task.projectId
    if (task.kind === 'stop' || task.kind === 'remove') {
      touched = true
      await runtime[task.kind](id)
      if (!active()) throw new Error('操作已中断')
      setRuntimeForTask(task, task.kind === 'stop' ? 'stopped' : 'absent')
      finishTask(task)
      return
    }
    const value = snapshot(task.candidateFiles)
    const target = task.targetVersionId
      ? getVersion(id, task.targetVersionId)
      : null
    // A restore can reuse its exact previously validated artifact even while Docker is offline.
    const templateId =
      task.kind === 'restore' && target
        ? target.templateId
        : await runtime.templateId()
    if (task.kind === 'preview' && target && target.templateId !== templateId)
      throw new Error('此历史版本的模板镜像已变化，不能使用不同模板重建预览')
    if (!active()) throw new Error('操作已中断')
    const existing = artifactFor(id, value.hash, templateId)
    if (existing && !['start', 'preview', 'agent'].includes(task.kind)) {
      addEvent(task, '复用已验证的同模板构建产物')
      completeBuild(task, templateId, existing, undefined, owner)
      return
    }
    addEvent(task, '完整装载候选文件，当前可用版本和预览保持可访问')
    const state = await runtime.state(id)
    touched = true
    // Always reconcile a container left by an interrupted operation before loading source.
    if (state === 'absent') {
      const count = db()
        .prepare(
          "SELECT COUNT(*) AS n FROM runtime_workspaces WHERE state IN ('running','stopped') AND projectId!=?",
        )
        .get(id) as { n: number }
      if (count.n >= 3)
        throw new Error('本地最多保留 3 个容器环境，请先移除其他环境')
      await runtime.create(id, randomUUID(), value.files, controller.signal)
    } else {
      if (state === 'running') await runtime.stop(id)
      await runtime.start(id, value.files, controller.signal)
    }
    if (!active()) throw new Error('操作已中断')
    await runtime.replaceFiles(id, value.files, controller.signal)
    if (!active()) throw new Error('操作已中断')
    setRuntimeForTask(task, 'running', value.hash)
    if (task.kind === 'start') {
      finishTask(task)
      return
    }
    if (task.kind === 'agent') {
      const result = await runCodingAgent(task, {
        provider: modelProvider || providerFor(task.agent!.provider),
        signal: controller.signal,
        active,
        owner,
        verify: (result, steps) => {
          if (!result.assets) throw new Error('候选构建产物缺失')
          return browserVerifier(
            result.artifactId,
            result.assets,
            steps,
            controller.signal,
          )
        },
        build: async () => {
          if (!active()) throw new Error('操作已中断')
          await runtime.replaceFiles(id, task.candidateFiles, controller.signal)
          if (!active()) throw new Error('操作已中断')
          setRuntimeForTask(task, 'running', snapshot(task.candidateFiles).hash)
          const artifactId = randomUUID()
          const result = await runtime.execute(
            id,
            'build',
            controller.signal,
            artifactId,
          )
          if (!active()) throw new Error('操作已中断')
          if (result.timedOut) throw new Error('构建超过时限，已终止')
          return {
            artifactId,
            ok: result.exitCode === 0,
            output: result.output,
            assets:
              result.exitCode === 0
                ? await runtime.exportBuild(id, controller.signal)
                : undefined,
          }
        },
      })
      if (!active()) throw new Error('操作已中断')
      completeBuild(task, templateId, result.artifactId, result.assets, owner)
      return
    }
    const artifactId = randomUUID()
    addEvent(task, '运行固定 Vite 构建')
    const result = await runtime.execute(
      id,
      'build',
      controller.signal,
      artifactId,
    )
    addEvent(task, result.output || '构建没有输出')
    if (result.exitCode !== 0)
      throw new Error(
        result.timedOut
          ? '构建超过时限，已终止'
          : `构建失败（退出码 ${result.exitCode}），请查看日志并修改草稿`,
      )
    if (!active()) throw new Error('操作已中断')
    const assets = await runtime.exportBuild(id, controller.signal)
    if (!active()) throw new Error('操作已中断')
    completeBuild(task, templateId, artifactId, assets, owner)
  } catch (error) {
    // A serial Worker awaits cleanup before claiming another operation. A stale owner
    // must never stop a container that may now belong to the replacement Worker.
    if (
      touched &&
      (!owner ||
        attemptActive(task, owner) ||
        (getTask(task.id).status === 'cancelled' &&
          !shutdown?.aborted &&
          (!owner || ownsWorker(owner))))
    ) {
      await runtime.stop(task.projectId).catch(() => {})
      setRuntimeForTask(task, 'stopped')
    }
    if (!shutdown?.aborted && attemptActive(task, owner)) {
      const message = controller.signal.aborted
        ? '操作超时或已中断，保留草稿和上一可用版本'
        : (error as Error).message
      addEvent(task, message)
      finishTask(task, message)
    }
  } finally {
    clearTimeout(timeout)
    clearInterval(poll)
    shutdown?.removeEventListener('abort', abort)
  }
}

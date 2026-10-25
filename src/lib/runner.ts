import {
  prepareEnvironment,
  protectEnvironment,
  withRuntimeLifecycle,
} from './runtime/lifecycle'
import { buildSlots, browserSlots } from './worker-resources'
import { ownerOf, assertActive, userById } from './tenancy'
import { CloudDefinitionError } from './cloud/errors'
import { cleanupTestAccount } from './cloud/test-account'
import { prepareCandidate, runCloudOperation } from './cloud/backend'
import { runCodingAgent, AGENT_LIMITS } from './ai/agent'
import { generateProjectTitle } from './ai/title'
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
  stageCandidatePreview,
} from './store'
import { snapshot } from './workspace-files'
import { DockerRuntime } from './runtime/docker'
import type { ProjectRuntime } from './runtime/types'
import type { Task } from './types'
import { verifyBrowser, type BrowserVerifier } from './browser'
import { runPublication, type PublicationRuntime } from './publication/runner'

export async function runTask(
  task: Task,
  runtime: ProjectRuntime = new DockerRuntime(),
  shutdown?: AbortSignal,
  owner?: string,
  modelProvider?: ModelProvider,
  browserVerifier: BrowserVerifier = verifyBrowser,
  publicationRuntime?: PublicationRuntime,
) {
  const unprotect = protectEnvironment(task.projectId)
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
  const check = () => {
    if (!active()) throw new Error('操作已中断')
  }
  const verify: BrowserVerifier = (...args) => {
    const timeoutMs = args[5]?.timeoutMs
    const signal =
      timeoutMs === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])
    args[3] = signal
    if (browserSlots.busy)
      addEvent(task, '等待页面验证资源', { type: 'validation' })
    return browserSlots
      .run(signal, () => {
        check()
        return browserVerifier(...args)
      })
      .catch((error) => {
        if (!controller.signal.aborted && signal.aborted)
          throw new Error(
            '自动测试已达到剩余时间预算，停止本轮检查；不阻塞版本保存。',
          )
        throw error
      })
  }
  const executeBuild = (artifactId: string) => {
    if (buildSlots.busy) addEvent(task, '等待构建资源', { type: 'build' })
    return buildSlots.run(controller.signal, () => {
      check()
      return runtime.execute(
        task.projectId,
        'build',
        controller.signal,
        artifactId,
      )
    })
  }
  let touched = false
  let titleGeneration: Promise<void> | undefined
  try {
    const userId = ownerOf(task.projectId)
    if (userId && !['stop', 'remove', 'unpublish'].includes(task.kind))
      assertActive(userById(userId))
    if (shutdown?.aborted || !active()) throw new Error('操作已中断')
    if (task.kind === 'publish' || task.kind === 'unpublish') {
      await runPublication(task, {
        signal: controller.signal,
        active,
        owner,
        verify,
        runtime: publicationRuntime,
      })
      return
    }
    if (task.kind === 'cloud_setup') {
      await runCloudOperation(task, {
        signal: controller.signal,
        check: () => {
          if (!active()) throw new Error('操作已中断')
        },
      })
      if (active()) finishTask(task)
      return
    }
    if (task.kind === 'agent') {
      if (!task.agent) throw new Error('缺少模型任务配置')
      task.agent.startedAt ??= Date.now()
      checkpointAgent(task, owner)
      if (Date.now() - task.agent.startedAt >= AGENT_LIMITS.durationMs)
        throw new Error('Coding Agent 超过 20 分钟总时限')
      titleGeneration = generateProjectTitle(
        task,
        modelProvider || providerFor(task.agent.provider),
        controller.signal,
        owner,
      ).catch(() => {})
    }
    const id = task.projectId
    if (task.kind === 'stop' || task.kind === 'remove') {
      touched = true
      const kind = task.kind
      await withRuntimeLifecycle(async () => {
        check()
        await runtime[kind](id)
      }, controller.signal)
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
    touched = true
    await prepareEnvironment(
      runtime,
      task,
      value.files,
      value.hash,
      controller.signal,
      check,
      owner,
    )
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
        ready: (result) => {
          check()
          if (!result.assets) throw new Error('候选构建产物缺失')
          if (
            !stageCandidatePreview(
              task,
              templateId,
              result.artifactId,
              result.assets,
              owner,
            )
          )
            throw new Error('操作已中断')
        },
        verify: (result, steps, onLoaded, timeoutMs) => {
          if (!result.assets) throw new Error('候选构建产物缺失')
          return verify(
            result.artifactId,
            result.assets,
            steps,
            controller.signal,
            undefined,
            { onLoaded, timeoutMs },
          )
        },
        build: async () => {
          if (!active()) throw new Error('操作已中断')
          await runtime.replaceFiles(id, task.candidateFiles, controller.signal)
          if (!active()) throw new Error('操作已中断')
          setRuntimeForTask(task, 'running', snapshot(task.candidateFiles).hash)
          const artifactId = randomUUID()
          const result = await executeBuild(artifactId)
          if (!active()) throw new Error('操作已中断')
          if (result.timedOut) throw new Error('构建超过时限，已终止')
          let assets
          if (result.exitCode === 0) {
            try {
              assets = await prepareCandidate(
                task,
                await runtime.exportBuild(id, controller.signal),
                {
                  signal: controller.signal,
                  check: () => {
                    if (!active()) throw new Error('操作已中断')
                  },
                },
              )
            } catch (error) {
              if (error instanceof CloudDefinitionError)
                return { artifactId, ok: false, output: error.message }
              throw error
            }
          }
          return {
            artifactId,
            ok: result.exitCode === 0,
            output: result.output,
            assets,
          }
        },
      })
      await titleGeneration
      if (!active()) throw new Error('操作已中断')
      completeBuild(task, templateId, result.artifactId, result.assets, owner)
      return
    }
    const artifactId = randomUUID()
    addEvent(task, '运行固定 Vite 构建')
    const result = await executeBuild(artifactId)
    addEvent(task, result.output || '构建没有输出')
    if (result.exitCode !== 0)
      throw new Error(
        result.timedOut
          ? '构建超过时限，已终止'
          : `构建失败（退出码 ${result.exitCode}），请查看日志并修改草稿`,
      )
    if (!active()) throw new Error('操作已中断')
    const assets = await prepareCandidate(
      task,
      await runtime.exportBuild(id, controller.signal),
      {
        signal: controller.signal,
        check: () => {
          if (!active()) throw new Error('操作已中断')
        },
      },
    )
    if (!active()) throw new Error('操作已中断')
    completeBuild(task, templateId, artifactId, assets, owner)
  } catch (error) {
    // Keep this project reserved until cleanup finishes; a stale owner must
    // never stop a container belonging to a replacement Worker or attempt.
    const canClean = () =>
      touched &&
      (!owner ||
        attemptActive(task, owner) ||
        (getTask(task.id).status === 'cancelled' &&
          !shutdown?.aborted &&
          (!owner || ownsWorker(owner)) &&
          !db()
            .prepare(
              "SELECT 1 FROM tasks WHERE projectId=? AND id!=? AND status='running'",
            )
            .get(task.projectId, task.id)))
    if (canClean())
      await withRuntimeLifecycle(async () => {
        if (!canClean()) return
        await runtime.stop(task.projectId).catch(() => {})
        setRuntimeForTask(task, 'stopped')
      })
    if (!shutdown?.aborted && attemptActive(task, owner)) {
      const message = controller.signal.aborted
        ? '操作超时或已中断，保留草稿和上一可用版本'
        : (error as Error).message
      addEvent(task, message)
      finishTask(task, message)
    }
  } finally {
    controller.abort()
    await titleGeneration
    clearTimeout(timeout)
    clearInterval(poll)
    shutdown?.removeEventListener('abort', abort)
    try {
      await cleanupTestAccount(task.id)
    } finally {
      unprotect()
    }
  }
}
